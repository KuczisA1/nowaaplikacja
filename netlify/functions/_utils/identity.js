// Helper functions for working with Netlify Identity Admin API.

const ADMIN_TOKEN_ENV_KEYS = [
  'IDENTITY_ADMIN_TOKEN',
  'NETLIFY_IDENTITY_ADMIN_TOKEN',
  'GOTRUE_ADMIN_API_TOKEN',
  'GOTRUE_ADMIN_KEY'
];

function resolveIdentityUrl() {
  const raw = process.env.NETLIFY_IDENTITY_URL || process.env.IDENTITY_URL || process.env.GOTRUE_ENDPOINT || '';
  if (!raw) {
    throw new Error('Missing NETLIFY_IDENTITY_URL (or IDENTITY_URL/GOTRUE_ENDPOINT) environment variable.');
  }
  return raw.replace(/\/$/, '');
}

function resolveAdminToken() {
  for (const key of ADMIN_TOKEN_ENV_KEYS) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error('Missing Identity admin token env variable. Set one of: IDENTITY_ADMIN_TOKEN, NETLIFY_IDENTITY_ADMIN_TOKEN, GOTRUE_ADMIN_API_TOKEN, GOTRUE_ADMIN_KEY.');
}

function requireEmail(email) {
  if (typeof email !== 'string' || !email.trim()) {
    throw new Error('Email adres jest wymagany.');
  }
  return email.trim().toLowerCase();
}

async function identityRequest(path, options = {}) {
  const baseUrl = resolveIdentityUrl();
  const adminToken = resolveAdminToken();
  const url = path.startsWith('/') ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
  const { method = 'GET', body } = options;
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    Accept: 'application/json'
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await safeText(res);
    const error = new Error(`Identity request failed (${res.status} ${res.statusText}): ${text}`);
    error.status = res.status;
    error.body = text;
    throw error;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const error = new Error('Failed to parse Identity response JSON');
    error.cause = err;
    error.responseText = text;
    throw error;
  }
}

async function findUserByEmail(email) {
  const normalized = requireEmail(email);
  const data = await identityRequest(`/admin/users?email=${encodeURIComponent(normalized)}`);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

async function updateUser(userId, payload) {
  if (!userId) throw new Error('User ID is required');
  const body = payload || {};
  return identityRequest(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body
  });
}

function calculateTimeLeft(expiresAt) {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return null;
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  if (diffMs <= 0) {
    return { expired: true, milliseconds: diffMs };
  }
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return {
    expired: false,
    milliseconds: diffMs,
    seconds,
    minutes,
    hours,
    days
  };
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (err) {
    return '';
  }
}

module.exports = {
  findUserByEmail,
  updateUser,
  calculateTimeLeft
};
