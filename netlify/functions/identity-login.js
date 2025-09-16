// Enforce role-based login and rotate a per-login session identifier to support single active session.

const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}');
    const user = payload && payload.user ? payload.user : {};
    const appMeta = user.app_metadata || {};
    const roles = Array.isArray(appMeta.roles) ? appMeta.roles : [];

    const blocked = roles.includes('blocked') || roles.includes('inactive');

    // Generate a new session id for this login (forces other devices out on next refresh).
    const sessionId = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');

    const normalizedRoles = blocked
      ? roles
      : Array.from(new Set([...roles, 'member']));

    // Merge new app_metadata back. Netlify Identity will persist these fields.
    return {
      statusCode: 200,
      body: JSON.stringify({
        app_metadata: {
          ...appMeta,
          roles: normalizedRoles,
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
