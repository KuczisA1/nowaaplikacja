// Enforce role-based login and rotate a per-login session identifier to support single active session.

const crypto = require('crypto');

const normalizeStatus = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const pickStatus = (user) => {
  if (!user) return '';
  const appMeta = user.app_metadata || {};
  const userMeta = user.user_metadata || {};
  const statusSources = [userMeta.status, appMeta.status];
  for (const candidate of statusSources) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
};

const ACTIVE_STATUS_VALUES = new Set(['active', 'aktywny', 'approved', 'enabled', 'admin']);

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}');
    const user = payload && payload.user ? payload.user : {};
    const appMeta = user.app_metadata || {};
    const roles = Array.isArray(appMeta.roles) ? appMeta.roles : [];

    const statusRaw = pickStatus(user);
    const statusNormalized = normalizeStatus(statusRaw);

    // Update the role list so only accounts with active status (or admin) keep the "active" role.
    const normalizedRoles = roles
      .filter((role) => typeof role === 'string')
      .map((role) => role.trim())
      .filter(Boolean);
    const updatedRoles = Array.from(new Set(normalizedRoles));
    const isAdmin = updatedRoles.includes('admin');
    const isActiveByStatus = isAdmin || ACTIVE_STATUS_VALUES.has(statusNormalized);
    const activeIndex = updatedRoles.indexOf('active');
    if (isActiveByStatus) {
      if (!updatedRoles.includes('active')) updatedRoles.push('active');
    } else if (activeIndex !== -1) {
      updatedRoles.splice(activeIndex, 1);
    }

    // Generate a new session id for this login (forces other devices out on next refresh).
    const sessionId = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');

    return {
      statusCode: 200,
      body: JSON.stringify({
        app_metadata: {
          ...appMeta,
          status: statusRaw || appMeta.status || '',
          roles: updatedRoles,
          session_id: sessionId
        }
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Błąd logowania.' })
    };
  }
};
