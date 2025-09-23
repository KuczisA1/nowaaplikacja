const Stripe = require('stripe');
const { findUserByEmail, updateUser } = require('./_utils/identity');
const { ensurePlan, calculateExpiryFromPlan } = require('./_utils/plans');

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2023-10-16' }) : null;

exports.handler = async (event) => {
  if (!stripe) {
    console.error('Stripe secret key not configured.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Stripe not configured' })
    };
  }
  if (!webhookSecret) {
    console.error('Stripe webhook secret not configured.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Webhook secret missing' })
    };
  }

  const signature = event.headers['stripe-signature'];
  if (!signature) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing stripe-signature header' })
    };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Webhook signature verification failed: ${err.message}` })
    };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(stripeEvent.data.object);
        break;
      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutSessionCompleted(stripeEvent.data.object);
        break;
      case 'checkout.session.expired':
        await handleCheckoutSessionExpired(stripeEvent.data.object);
        break;
      default:
        console.log(`Unhandled Stripe event type ${stripeEvent.type}`);
    }
  } catch (err) {
    console.error('Stripe webhook handling failed', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Internal error processing webhook' })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};

async function handleCheckoutSessionCompleted(session) {
  const email = extractEmail(session);
  const planKey = session.metadata && session.metadata.plan_key;
  if (!email || !planKey) {
    console.warn('Checkout session missing email or plan metadata', { email, planKey, sessionId: session.id });
    return;
  }

  let plan;
  try {
    plan = ensurePlan(planKey);
  } catch (err) {
    console.error('Plan configuration error', err.message);
    throw err;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.warn('Webhook: user not found for email', email);
    return;
  }

  const now = new Date();
  const userMeta = { ...(user.user_metadata || {}) };
  const subscription = { ...(userMeta.subscription || {}) };

  const existingExpiry = subscription.expires_at ? new Date(subscription.expires_at) : null;
  const baseDate = existingExpiry && existingExpiry > now ? existingExpiry : now;
  const newExpiryDate = calculateExpiryFromPlan(plan.key, baseDate);

  subscription.status = 'active';
  subscription.plan_key = plan.key;
  subscription.expires_at = newExpiryDate.toISOString();
  subscription.activated_at = now.toISOString();
  subscription.last_session_id = session.id;
  subscription.last_payment_intent = session.payment_intent || null;

  userMeta.subscription = subscription;
  userMeta.status = 'active';

  const appMeta = { ...(user.app_metadata || {}) };
  const rolesSet = new Set(Array.isArray(appMeta.roles) ? appMeta.roles.filter((role) => typeof role === 'string' && role) : []);
  rolesSet.add('active');
  appMeta.roles = Array.from(rolesSet);
  appMeta.status = 'active';

  await updateUser(user.id, {
    user_metadata: userMeta,
    app_metadata: appMeta
  });

  console.log(`Activated subscription for ${email} until ${subscription.expires_at}`);
}

async function handleCheckoutSessionExpired(session) {
  const email = extractEmail(session);
  if (!email) return;
  const user = await findUserByEmail(email);
  if (!user) return;
  const userMeta = { ...(user.user_metadata || {}) };
  const subscription = { ...(userMeta.subscription || {}) };
  if (subscription.last_session_id !== session.id) return;
  subscription.status = 'inactive';
  userMeta.subscription = subscription;
  userMeta.status = userMeta.status === 'active' ? 'inactive' : userMeta.status;
  const appMeta = { ...(user.app_metadata || {}) };
  if (Array.isArray(appMeta.roles)) {
    appMeta.roles = appMeta.roles.filter((role) => role !== 'active');
  }
  if (appMeta.status === 'active') {
    appMeta.status = 'inactive';
  }
  await updateUser(user.id, {
    user_metadata: userMeta,
    app_metadata: appMeta
  });
}

function extractEmail(session) {
  if (!session) return null;
  if (session.metadata && session.metadata.email) return String(session.metadata.email).toLowerCase();
  if (session.customer_details && session.customer_details.email) return String(session.customer_details.email).toLowerCase();
  if (session.customer_email) return String(session.customer_email).toLowerCase();
  return null;
}
