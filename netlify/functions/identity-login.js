// Enforce role-based login and rotate a per-login session identifier to support single active session.

const crypto = require('crypto');

const TIMED_ROLE_DURATIONS_MS = Object.freeze({
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  halfyear: 182 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000
});

const isTimedRole = (role) => typeof role === 'string' && Object.prototype.hasOwnProperty.call(TIMED_ROLE_DURATIONS_MS, role);

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

const uniqueStrings = (values) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

const parseTimestamp = (input) => {
  if (!input && input !== 0) return 0;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'string') return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTimestamp = (ms) => {
  if (!ms || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const value = date.getTime();
  if (!Number.isFinite(value)) return null;
  return date.toISOString();
};

const parseTimedAccess = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return { role: '', assignedAt: 0, expiresAt: 0, injectedActive: false };
  }
  const role = typeof raw.role === 'string' ? raw.role.trim() : '';
  return {
    role,
    assignedAt: parseTimestamp(raw.assigned_at),
    expiresAt: parseTimestamp(raw.expires_at),
    injectedActive: Boolean(raw.injected_active)
  };
};

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}');
    const user = payload && payload.user ? payload.user : {};
    const appMeta = user.app_metadata || {};
    const roles = uniqueStrings(appMeta.roles);

    const statusRaw = pickStatus(user);
    const statusNormalized = normalizeStatus(statusRaw);
    const isAdmin = roles.includes('admin');
    const statusActive = isAdmin || ACTIVE_STATUS_VALUES.has(statusNormalized);

    const existingTimed = parseTimedAccess(appMeta.timed_access);
    const timedRoles = roles.filter((role) => isTimedRole(role));
    const hasActiveRole = roles.includes('active');
    const manualActiveBefore = hasActiveRole && (!existingTimed.injectedActive || timedRoles.length === 0);
    let selectedTimedRole = '';
    if (timedRoles.length) {
      selectedTimedRole = timedRoles.reduce((current, role) => {
        if (!current) return role;
        const currentDuration = TIMED_ROLE_DURATIONS_MS[current];
        const candidateDuration = TIMED_ROLE_DURATIONS_MS[role];
        return candidateDuration >= currentDuration ? role : current;
      }, '');
    }

    const now = Date.now();
    let assignedAtMs = existingTimed.assignedAt;
    let expiresAtMs = existingTimed.expiresAt;

    if (selectedTimedRole) {
      const duration = TIMED_ROLE_DURATIONS_MS[selectedTimedRole];
      const sameRole = existingTimed.role === selectedTimedRole;
      const hasValidWindow = sameRole && assignedAtMs && expiresAtMs && expiresAtMs > now;
      if (!hasValidWindow) {
        assignedAtMs = now;
        expiresAtMs = now + duration;
      }
    } else {
      assignedAtMs = 0;
      expiresAtMs = 0;
    }

    const timedActive = Boolean(selectedTimedRole && expiresAtMs && expiresAtMs > now);

    let nextRoles = roles.filter((role) => !isTimedRole(role) && role !== 'active');
    if (timedActive && selectedTimedRole) {
      nextRoles.push(selectedTimedRole);
    }

    const activeInjectedNow = timedActive && !isAdmin && !statusActive && !manualActiveBefore;
    const shouldHaveActive = isAdmin || statusActive || manualActiveBefore || timedActive;
    if (shouldHaveActive) {
      nextRoles.push('active');
    }

    nextRoles = uniqueStrings(nextRoles);

    const sessionId = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');

    const responseMeta = {
      ...appMeta,
      status: statusRaw || appMeta.status || '',
      roles: nextRoles,
      session_id: sessionId
    };

    if (selectedTimedRole) {
      responseMeta.timed_access = {
        role: selectedTimedRole,
        assigned_at: formatTimestamp(assignedAtMs),
        expires_at: formatTimestamp(expiresAtMs),
        active: timedActive,
        injected_active: activeInjectedNow
      };
    } else if (appMeta.timed_access) {
      responseMeta.timed_access = null;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        app_metadata: responseMeta
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Błąd logowania.' })
    };
  }
};
