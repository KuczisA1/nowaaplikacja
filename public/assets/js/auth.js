/*
  Unified auth/session helper for Netlify Identity.
  - Rejestracja dostępna dla każdego, ale dostęp do `/members/*` wymaga roli `active` lub `admin`.
  - Rotates a per-login session_id in identity-login function to enforce a single active session.
  - When a user logs in elsewhere, old sessions are logged out on refresh/visibility change.
  - Sets the `nf_jwt` cookie after login to enable role-based redirects.
  - Disables caching for members area via netlify.toml headers; client also avoids stale state.
*/

(function () {
  if (typeof window === 'undefined') return;

  const NF_JWT_COOKIE = 'nf_jwt';
  const LOCAL_SESSION_KEY = 'chem_session_id';
  const MEMBERS_PATH = '/members/';
  const LOGIN_PATH = '/login/';

  const parseHashParams = () => {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return {};
    return hash.split('&').reduce((acc, piece) => {
      if (!piece) return acc;
      const [key, value = ''] = piece.split('=');
      const k = decodeURIComponent(key || '');
      if (!k) return acc;
      acc[k] = decodeURIComponent(value || '');
      return acc;
    }, {});
  };

  const decodeEmailFromToken = (token) => {
    if (!token || token.indexOf('.') === -1) return '';
    try {
      const base = token.split('.')[1];
      if (!base) return '';
      const normalized = base.replace(/-/g, '+').replace(/_/g, '/');
      const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
      const json = atob(normalized + padding);
      const payload = JSON.parse(json);
      const email = payload.email || payload.email_new || payload.new_email || payload.sub;
      return typeof email === 'string' ? email : '';
    } catch (e) {
      return '';
    }
  };

  const detectIdentityFlowFromHash = () => {
    const hashParams = parseHashParams();
    const typeParam = (hashParams.type || '').toLowerCase();
    const error = hashParams.error || '';
    const errorDescription = hashParams.error_description || '';

    const pickToken = (keys) => {
      for (const key of keys) {
        if (hashParams[key]) return hashParams[key];
      }
      return '';
    };

    let flow = '';
    if (hashParams.invite_token || (hashParams.token && typeParam === 'invite')) flow = 'invite';
    else if (hashParams.recovery_token || typeParam === 'recovery') flow = 'recovery';
    else if (hashParams.email_change_token || typeParam === 'email_change' || typeParam === 'email_change_confirm') flow = 'email-change';
    else if (hashParams.confirmation_token || typeParam === 'confirmation' || typeParam === 'signup') flow = 'confirm';

    let token = '';
    if (flow === 'invite') token = pickToken(['invite_token', 'token']);
    else if (flow === 'recovery') token = pickToken(['recovery_token', 'token']);
    else if (flow === 'email-change') token = pickToken(['email_change_token', 'token']);
    else if (flow === 'confirm') token = pickToken(['confirmation_token', 'token']);
    else if (!flow) token = pickToken(['token']);

    const email = hashParams.email || hashParams.new_email || hashParams.email_new || decodeEmailFromToken(token);

    return { type: flow, token, email, rawType: typeParam, error, errorDescription };
  };

  const redirectIdentityHashToLogin = () => {
    if (!location.hash) return;
    const flow = detectIdentityFlowFromHash();
    if (!flow.type && !flow.token && !flow.error && !flow.errorDescription) return;
    const target = new URL(LOGIN_PATH, location.origin);
    try {
      const currentParams = new URLSearchParams(location.search || '');
      currentParams.forEach((value, key) => {
        target.searchParams.set(key, value);
      });
    } catch {}
    if (flow.type) target.searchParams.set('flow', flow.type);
    if (flow.token) target.searchParams.set('token', flow.token);
    if (flow.email) target.searchParams.set('email', flow.email);
    if (flow.rawType) target.searchParams.set('type', flow.rawType);
    if (flow.error) target.searchParams.set('error', flow.error);
    if (flow.errorDescription) target.searchParams.set('error_description', flow.errorDescription);

    const onLoginPage = location.pathname.startsWith(LOGIN_PATH);
    if (onLoginPage) {
      try {
        history.replaceState({}, document.title, target.pathname + target.search);
      } catch (e) {
        location.replace(target.toString());
      }
    } else {
      location.replace(target.toString());
    }
  };

  redirectIdentityHashToLogin();

  const ID = window.netlifyIdentity;
  if (!ID) return;

  const isMembersPage = () => {
    try {
      // Prefer explicit marker when URL gets cleaned to '/'
      if (document.querySelector('meta[name="x-members"][content="1"]')) return true;
    } catch {}
    return location.pathname.startsWith(MEMBERS_PATH);
  };
  const isLoginPage = () => location.pathname.startsWith(LOGIN_PATH);

  const TIMED_ROLE_NAMES = ['hour', 'day', 'week', 'halfyear', 'year'];
  const TIMED_ROLES = new Set(TIMED_ROLE_NAMES);

  const parseTimestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };

  const timedAccessState = (source) => {
    const meta = source && source.app_metadata ? source.app_metadata.timed_access : undefined;
    const rawRole = meta && typeof meta.role === 'string' ? meta.role.trim() : '';
    const role = rawRole && TIMED_ROLES.has(rawRole) ? rawRole : '';
    const assignedAt = meta ? parseTimestamp(meta.assigned_at) : 0;
    const expiresAt = meta ? parseTimestamp(meta.expires_at) : 0;
    return {
      role,
      assignedAt,
      expiresAt,
      injectedActive: Boolean(meta && meta.injected_active)
    };
  };

  const timedAccessIsActive = (user, now = Date.now()) => {
    if (!user) return false;
    const state = timedAccessState(user);
    if (!state.role) return false;
    const roles = getRoles(user);
    if (!Array.isArray(roles) || !roles.includes(state.role)) return false;
    return state.expiresAt > now;
  };

  const timedAccessEqual = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    const keys = ['role', 'assigned_at', 'expires_at', 'active', 'injected_active'];
    for (const key of keys) {
      const va = Object.prototype.hasOwnProperty.call(a, key) ? a[key] : null;
      const vb = Object.prototype.hasOwnProperty.call(b, key) ? b[key] : null;
      if (va !== vb) return false;
    }
    return true;
  };

  const getUser = () => {
    try { return ID.currentUser(); } catch { return null; }
  };

  const getRoles = (user) => {
    const roles = (user && user.app_metadata && Array.isArray(user.app_metadata.roles))
      ? user.app_metadata.roles
      : [];
    return roles;
  };

  const hasActiveRole = (roles) => Array.isArray(roles) && (roles.includes('active') || roles.includes('admin'));

  const isActiveUser = (user) => {
    if (!user) return false;
    const roles = getRoles(user);
    if (Array.isArray(roles) && roles.includes('admin')) return true;
    if (isStatusActive(statusValue(user))) return true;
    const now = Date.now();
    const timedState = timedAccessState(user);
    if (timedState.role && timedState.expiresAt > now && Array.isArray(roles) && roles.includes(timedState.role)) {
      return true;
    }
    if (Array.isArray(roles) && roles.includes('active') && !timedState.injectedActive) {
      return true;
    }
    return false;
  };

  const rolesEqual = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return false;
    }
    return true;
  };

  const sessionIdFrom = (source) => {
    if (!source || !source.app_metadata) return '';
    const sid = source.app_metadata.session_id;
    return typeof sid === 'string' && sid ? sid : '';
  };

  const normalizeStatus = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  };

  const rawStatusValue = (source) => {
    if (!source) return '';
    const appMeta = source.app_metadata;
    const userMeta = source.user_metadata;
    if (appMeta && typeof appMeta.status === 'string' && appMeta.status.trim()) return appMeta.status;
    if (userMeta && typeof userMeta.status === 'string' && userMeta.status.trim()) return userMeta.status;
    return '';
  };

  const statusValue = (source) => normalizeStatus(rawStatusValue(source));

  const ACTIVE_STATUS_VALUES = ['active', 'aktywny', 'approved', 'enabled', 'admin'];

  const isStatusActive = (status) => ACTIVE_STATUS_VALUES.includes(status);

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const setCookie = (name, value, opts = {}) => {
    const p = [
      `${name}=${value}`,
      'Path=/'
    ];
    if (opts.maxAge) p.push(`Max-Age=${opts.maxAge}`);
    if (opts.sameSite) p.push(`SameSite=${opts.sameSite}`); else p.push('SameSite=Lax');
    if (location.protocol === 'https:') p.push('Secure');
    document.cookie = p.join('; ');
  };

  const clearCookie = (name) => {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax` + (location.protocol === 'https:' ? '; Secure' : '');
  };

  const setNFJwtCookie = async (user) => {
    try {
      if (!user || !isActiveUser(user)) {
        clearNFJwtCookie();
        return;
      }
      const token = await user.jwt();
      if (token) setCookie(NF_JWT_COOKIE, token, { sameSite: 'Lax' });
    } catch {}
  };

  const clearNFJwtCookie = () => clearCookie(NF_JWT_COOKIE);

  const localSessionId = () => {
    try { return localStorage.getItem(LOCAL_SESSION_KEY) || ''; } catch { return ''; }
  };
  const saveLocalSessionId = (sid) => {
    try { if (sid) localStorage.setItem(LOCAL_SESSION_KEY, sid); } catch {}
  };
  const clearLocalSessionId = () => { try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch {} };

  const redirectToLoginWithParam = (key) => {
    try {
      const target = new URL(LOGIN_PATH, location.origin);
      if (key) target.searchParams.set(key, '1');
      location.replace(target.pathname + target.search);
    } catch {
      const fallback = key ? `${LOGIN_PATH}?${key}=1` : LOGIN_PATH;
      location.replace(fallback);
    }
  };

  const logoutAsInactive = async () => {
    try { await ID.logout(); } catch {}
    clearNFJwtCookie();
    clearLocalSessionId();
    redirectToLoginWithParam('inactive');
  };

  const fetchServerUser = async (user) => {
    try {
      const token = await user.jwt();
      const res = await fetch('/.netlify/identity/user', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('user fetch failed');
      return await res.json();
    } catch (e) {
      return null;
    }
  };

  const ensureFreshUserState = async (user, { enforceLogout = false } = {}) => {
    if (!user) return { active: false, user: null, serverUser: null, serverRoles: [] };
    const serverUser = await fetchServerUser(user);
    const serverRoles = serverUser ? getRoles(serverUser) : null;

    if (serverRoles && !rolesEqual(serverRoles, getRoles(user))) {
      const appMeta = Object.assign({}, user.app_metadata || {});
      appMeta.roles = serverRoles;
      user.app_metadata = appMeta;
    }

    const serverStatusRaw = rawStatusValue(serverUser);
    if (serverStatusRaw) {
      const appMeta = Object.assign({}, user.app_metadata || {});
      if (appMeta.status !== serverStatusRaw) {
        appMeta.status = serverStatusRaw;
        user.app_metadata = appMeta;
      }
    }

    const hasTimedField = serverUser && serverUser.app_metadata && Object.prototype.hasOwnProperty.call(serverUser.app_metadata, 'timed_access');
    if (hasTimedField) {
      const serverTimedMeta = serverUser.app_metadata.timed_access;
      const appMeta = Object.assign({}, user.app_metadata || {});
      const currentTimedMeta = appMeta.timed_access;
      if (!timedAccessEqual(currentTimedMeta, serverTimedMeta)) {
        if (serverTimedMeta === null || typeof serverTimedMeta === 'undefined') {
          if (Object.prototype.hasOwnProperty.call(appMeta, 'timed_access')) delete appMeta.timed_access;
        } else {
          appMeta.timed_access = serverTimedMeta;
        }
        user.app_metadata = appMeta;
      }
    }

    if (!hasTimedField && user && user.app_metadata && Object.prototype.hasOwnProperty.call(user.app_metadata, 'timed_access')) {
      const appMeta = Object.assign({}, user.app_metadata);
      delete appMeta.timed_access;
      user.app_metadata = appMeta;
    }

    const serverTimedState = timedAccessState(serverUser);
    const serverTimedActive = Boolean(
      serverTimedState.role &&
      serverTimedState.expiresAt > Date.now() &&
      Array.isArray(serverRoles) &&
      serverRoles.includes(serverTimedState.role)
    );

    const active = serverRoles
      ? (hasActiveRole(serverRoles) || serverTimedActive || isStatusActive(normalizeStatus(serverStatusRaw)))
      : isActiveUser(user);
    if (!active) {
      if (enforceLogout) await logoutAsInactive();
      return { active: false, user: null, serverUser, serverRoles: serverRoles || [] };
    }

    return { active: true, user, serverUser, serverRoles: serverRoles || getRoles(user) };
  };

  const handleSessionMismatch = async () => {
    try { await ID.logout(); } catch {}
    clearNFJwtCookie();
    clearLocalSessionId();
    await delay(50);
    redirectToLoginWithParam('loggedout');
  };

  const ensureAuthenticatedOrRedirect = async () => {
    let user = getUser();
    if (!user) {
      redirectToLoginWithParam();
      return false;
    }

    const state = await ensureFreshUserState(user, { enforceLogout: true });
    if (!state.active) return false;

    const serverUser = state.serverUser;
    const serverSid = sessionIdFrom(serverUser);
    const localSid = localSessionId();

    if (serverSid && localSid && serverSid !== localSid) {
      await handleSessionMismatch();
      return false;
    }

    user = getUser() || user;

    if (serverSid && !localSid) {
      saveLocalSessionId(serverSid);
    } else if (!serverSid) {
      const sid = sessionIdFrom(user);
      if (sid && !localSid) saveLocalSessionId(sid);
    }

    await setNFJwtCookie(user);
    return true;
  };

  const checkSingleSessionOrLogout = async () => {
    const user = getUser();
    if (!user) return { ok: false, reason: 'no_user' };
    try {
      const state = await ensureFreshUserState(user, { enforceLogout: true });
      if (!state.active) return { ok: false, reason: 'inactive' };
      const serverUser = state.serverUser;
      if (!serverUser) return { ok: true };
      const serverSid = sessionIdFrom(serverUser);
      const localSid = localSessionId();
      if (serverSid && localSid && serverSid !== localSid) {
        await handleSessionMismatch();
        return { ok: false, reason: 'session_mismatch' };
      }
      if (serverSid && !localSid) saveLocalSessionId(serverSid);
    } catch {}
    return { ok: true };
  };

  const onMembersPageInit = async () => {
    const ok = await ensureAuthenticatedOrRedirect();
    if (!ok) return;
    // First check immediately
    await checkSingleSessionOrLogout();
    // Then on page visibility change / focus / coming online
    const rescan = () => { checkSingleSessionOrLogout(); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rescan(); });
    window.addEventListener('focus', rescan);
    window.addEventListener('online', rescan);
    // And periodically (lightweight) as a backup
    setInterval(rescan, 30000);
  };

  const onLoginPageInit = async () => {
    let identityFlowInQuery = false;
    try {
      const qp = new URLSearchParams(location.search || '');
      if (qp.get('flow')) identityFlowInQuery = true;
      if (qp.has('token') || qp.has('error') || qp.has('error_description')) identityFlowInQuery = true;
    } catch {}

    // If already logged and active, jump to members (unless handling a special flow)
    const user = getUser();
    if (!identityFlowInQuery && user) {
      const state = await ensureFreshUserState(user, { enforceLogout: true });
      if (state.active) {
        let current = getUser() || user;
        const serverSid = sessionIdFrom(state.serverUser);
        if (serverSid) {
          saveLocalSessionId(serverSid);
        } else {
          const sid = sessionIdFrom(current);
          if (sid) saveLocalSessionId(sid);
        }
        await setNFJwtCookie(current);
        location.replace(MEMBERS_PATH);
      } else {
        return;
      }
    }

    // Show informational messages based on query params
    try {
      const p = new URLSearchParams(location.search);
      const flashBox = document.getElementById('flash');
      if (flashBox) {
        if (p.has('inactive')) {
          flashBox.textContent = 'Konto nieaktywne – poproś administratora o aktywację.';
          flashBox.className = 'flash warn';
        }
        if (p.has('loggedout')) {
          flashBox.textContent = 'Zostałeś wylogowany. Zaloguj się ponownie.';
          flashBox.className = 'flash';
        }
      }
    } catch {}
  };

  // Wire identity events to keep cookie/session in sync
  const wireIdentityEvents = () => {
    // Keep nf_jwt fresh whenever Identity initializes or refreshes
    try {
      ID.on('init', async (user) => {
        if (!user) return;
        const state = await ensureFreshUserState(user, { enforceLogout: true });
        if (!state.active) return;
        let current = getUser() || user;
        const serverSid = sessionIdFrom(state.serverUser);
        const localSid = localSessionId();
        if (serverSid && !localSid) {
          saveLocalSessionId(serverSid);
        } else if (!serverSid) {
          const sid = sessionIdFrom(current);
          if (sid && !localSid) saveLocalSessionId(sid);
        }
        await setNFJwtCookie(current);
      });
    } catch {}
    try {
      ID.on('login', async (user) => {
        const state = await ensureFreshUserState(user, { enforceLogout: true });
        if (!state.active) return;
        let current = getUser() || user;
        const serverSid = sessionIdFrom(state.serverUser);
        if (serverSid) {
          saveLocalSessionId(serverSid);
        } else {
          const sid = sessionIdFrom(current);
          if (sid) saveLocalSessionId(sid);
        }
        await setNFJwtCookie(current);
      });
    } catch {}
    try {
      ID.on('logout', () => {
        clearNFJwtCookie();
        clearLocalSessionId();
        // Let pages decide where to redirect. Members page also has inline handler.
      });
    } catch {}
    try {
      ID.on('tokenExpired', async () => {
        // Refresh token & cookie when possible
        const user = getUser();
        if (user) {
          try { await ID.refresh(); } catch {}
          try { await setNFJwtCookie(getUser()); } catch {}
        }
      });
    } catch {}
  };

  document.addEventListener('DOMContentLoaded', async () => {
    try { ID.init(); } catch {}
    wireIdentityEvents();
    if (isMembersPage()) {
      onMembersPageInit();
    } else if (isLoginPage()) {
      onLoginPageInit();
    } else {
      const user = getUser();
      if (user) {
        const state = await ensureFreshUserState(user, { enforceLogout: true });
        if (!state.active) return;
        const serverUser = state.serverUser;
        let current = getUser() || user;
        const serverSid = sessionIdFrom(serverUser);
        const localSid = localSessionId();
        if (serverSid && localSid && serverSid !== localSid) {
          await handleSessionMismatch();
          return;
        }
        if (serverSid && !localSid) {
          saveLocalSessionId(serverSid);
        } else if (!serverSid) {
          const sid = sessionIdFrom(current);
          if (sid && !localSid) saveLocalSessionId(sid);
        }
        current = getUser() || current;
        await setNFJwtCookie(current);
      }
    }
  });
})();
