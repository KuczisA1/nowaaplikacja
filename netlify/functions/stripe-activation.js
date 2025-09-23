const Stripe = require('stripe');
const { findUserByEmail, updateUser, calculateTimeLeft } = require('./_utils/identity');
const { getPlan, ensurePlan, listPlans } = require('./_utils/plans');

const ACTIVE_STATUS_VALUES = new Set(['active', 'aktywny', 'approved', 'enabled', 'admin']);
const stripeSecret = process.env.STRIPE_SECRET_KEY;

const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2023-10-16' }) : null;


exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: corsHeaders()
      };
    }

    if (event.httpMethod !== 'POST') {
      return json({ error: 'Use POST' }, 405);
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (err) {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const action = String(payload.action || '').trim().toLowerCase();

    switch (action) {
      case 'status':
        return await handleStatus(payload);
      case 'checkout':
        return await handleCheckout(payload);
      default:
        return json({ error: 'Unknown action', details: 'Use action=status or action=checkout' }, 400);
    }
  } catch (err) {
    console.error('stripe-activation error', err);
    return json({ error: 'Internal server error', details: err.message || String(err) }, 500);
  }
};

async function handleStatus(payload) {
  let email;
  try {
    email = validateEmail(payload.email);
  } catch (err) {
    return json({ error: err.message || 'Podaj prawidłowy adres e-mail.' }, 400);
  }
  const user = await findUserByEmail(email);
  if (!user) {
    return json({
      found: false,
      email,
      status: 'missing',
      active: false,
      message: 'Nie znaleziono konta o podanym adresie e-mail.'
    }, 404);
  }

  const subscription = (user.user_metadata && user.user_metadata.subscription) || {};
  const expiresAt = subscription.expires_at || null;
  const statusRaw = pickStatus(user);
  const timeLeft = calculateTimeLeft(expiresAt);
  const isActive = determineActive(statusRaw, timeLeft);

  if (timeLeft && timeLeft.expired && statusRaw) {
    await deactivateUser(user, { reason: 'expired' });
  }

  const response = normalizeStatusResponse({
    user,
    email,
    subscription,
    expiresAt,
    timeLeft,
    isActive
  });

  return json(response);
}

async function handleCheckout(payload) {
  if (!stripe) {
    return json({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' }, 500);
  }

  let email;
  try {
    email = validateEmail(payload.email);
  } catch (err) {
    return json({ error: err.message || 'Podaj prawidłowy adres e-mail.' }, 400);
  }
  const planKey = String(payload.plan || '').trim().toLowerCase();
  let plan;
  try {
    plan = ensurePlan(planKey);
  } catch (err) {
    const statusCode = /identyfikatora ceny/i.test(err.message || '') ? 500 : 400;
    return json({ error: err.message }, statusCode);
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return json({
      error: 'Brak konta',
      code: 'ACCOUNT_MISSING',
      message: 'Nie znaleziono konta o podanym adresie e-mail. Skontaktuj się z administratorem.'
    }, 404);
  }

  const subscription = (user.user_metadata && user.user_metadata.subscription) || {};
  const expiresAt = subscription.expires_at || null;
  const statusRaw = pickStatus(user);
  const timeLeft = calculateTimeLeft(expiresAt);
  const isActive = determineActive(statusRaw, timeLeft);

  if (isActive && timeLeft && !timeLeft.expired) {
    const response = normalizeStatusResponse({
      user,
      email,
      subscription,
      expiresAt,
      timeLeft,
      isActive
    });
    return json({
      error: 'Konto jest już aktywne.',
      code: 'ACCOUNT_ACTIVE',
      status: response
    }, 409);
  }

  const baseUrl = resolveActivationBaseUrl();
  const successParam = payload.successPath || '/activation/?success=1&session_id={CHECKOUT_SESSION_ID}';
  const cancelParam = payload.cancelPath || '/activation/?cancelled=1';
  const successUrl = joinUrl(baseUrl, successParam);
  const cancelUrl = joinUrl(baseUrl, cancelParam);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    client_reference_id: user.id,
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        price: plan.priceId,
        quantity: 1
      }
    ],
    metadata: {
      email,
      plan_key: plan.key
    }
  });

  return json({
    checkoutUrl: session.url,
    sessionId: session.id
  });
}

function determineActive(statusRaw, timeLeft) {
  const status = String(statusRaw || '').trim().toLowerCase();
  const statusIsActive = status && ACTIVE_STATUS_VALUES.has(status);
  if (!statusIsActive) return false;
  if (!timeLeft) return true;
  return !timeLeft.expired;
}

function pickStatus(user) {
  if (!user) return '';
  const sequences = [user.user_metadata, user.app_metadata];
  for (const source of sequences) {
    if (!source) continue;
    if (typeof source.status === 'string' && source.status.trim()) {
      return source.status.trim();
    }
  }
  return '';
}

function normalizeStatusResponse({ user, email, subscription, expiresAt, timeLeft, isActive }) {
  const roles = Array.isArray(user.app_metadata && user.app_metadata.roles)
    ? user.app_metadata.roles.filter((role) => typeof role === 'string')
    : [];
  const planInfo = subscription.plan_key ? getPlan(subscription.plan_key) : null;

  return {
    found: true,
    email,
    status: isActive ? 'active' : 'inactive',
    expiresAt,
    plan: subscription.plan_key || null,
    planLabel: planInfo ? planInfo.label : null,
    secondsRemaining: timeLeft && !timeLeft.expired ? timeLeft.seconds : 0,
    daysRemaining: timeLeft && !timeLeft.expired ? timeLeft.days : 0,
    roles,
    lastSession: subscription.last_session_id || null,
    message: buildStatusMessage({ isActive, timeLeft }),
    availablePlans: listPlans().map((plan) => ({ key: plan.key, label: plan.label }))
  };
}

function buildStatusMessage({ isActive, timeLeft }) {
  if (!isActive) {
    if (timeLeft && timeLeft.expired) {
      return 'Subskrypcja wygasła.';
    }
    return 'Konto nie jest aktywne.';
  }
  if (!timeLeft) {
    return 'Konto aktywne.';
  }
  if (timeLeft.days >= 1) {
    return `Pozostało ${timeLeft.days} dni aktywnej subskrypcji.`;
  }
  if (timeLeft.hours >= 1) {
    return `Pozostało ${timeLeft.hours} godzin aktywnej subskrypcji.`;
  }
  return `Pozostało ${timeLeft.minutes} minut aktywnej subskrypcji.`;
}

async function deactivateUser(user, { reason = 'expired' } = {}) {
  const userMeta = { ...(user.user_metadata || {}) };
  const subscription = { ...(userMeta.subscription || {}) };
  subscription.status = 'inactive';
  if (reason) {
    subscription.last_inactive_reason = reason;
  }
  userMeta.subscription = subscription;
  userMeta.status = 'inactive';

  const appMeta = { ...(user.app_metadata || {}) };
  const roles = Array.isArray(appMeta.roles) ? appMeta.roles.filter((role) => role !== 'active') : [];
  appMeta.roles = roles;
  appMeta.status = 'inactive';

  await updateUser(user.id, {
    user_metadata: userMeta,
    app_metadata: appMeta
  });
}

function validateEmail(email) {
  if (typeof email !== 'string') throw new Error('Email musi być stringiem.');
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    throw new Error('Podaj prawidłowy adres e-mail.');
  }
  return normalized;
}

function resolveActivationBaseUrl() {
  const raw = process.env.ACTIVATION_BASE_URL || process.env.SITE_URL || process.env.URL || '';
  if (!raw) {
    throw new Error('Skonfiguruj ACTIVATION_BASE_URL (albo SITE_URL/URL) dla prawidłowego przekierowania po płatności.');
  }
  return raw.replace(/\/$/, '');
}

function joinUrl(base, path) {
  if (!path) return base;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return `${base}${trimmed}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
    body: JSON.stringify(obj)
  };
}
