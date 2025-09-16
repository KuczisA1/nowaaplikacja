/*
  Unified auth/session helper for Netlify Identity.
  - Obsługuje logowanie oraz rejestrację (nowi użytkownicy dostają domyślną rolę `member`).
  - Dowolny uwierzytelniony użytkownik z rolą `member`, `active` lub `admin` ma dostęp do `/members/*`.
  - Rotates a per-login session_id in identity-login function to enforce a single active session.
  - When a user logs in elsewhere, old sessions are logged out on refresh/visibility change.
  - Sets the `nf_jwt` cookie after login to enable role-based redirects.
  - Disables caching for members area via netlify.toml headers; client also avoids stale state.
*/

(function () {
  if (typeof window === 'undefined') return;
  const ID = window.netlifyIdentity;
  if (!ID) return;

  const NF_JWT_COOKIE = 'nf_jwt';
  const LOCAL_SESSION_KEY = 'chem_session_id';
  const MEMBERS_PATH = '/members/';
  const LOGIN_PATH = '/login/';

  const isMembersPage = () => {
    try {
      // Prefer explicit marker when URL gets cleaned to '/'
      if (document.querySelector('meta[name="x-members"][content="1"]')) return true;
    } catch {}
    return location.pathname.startsWith(MEMBERS_PATH);
  };
  const isLoginPage = () => location.pathname.startsWith(LOGIN_PATH);

  const getUser = () => {
    try { return ID.currentUser(); } catch { return null; }
  };

  const getRoles = (user) => {
    const roles = (user && user.app_metadata && Array.isArray(user.app_metadata.roles))
      ? user.app_metadata.roles
      : [];
    return roles;
  };

  const isActiveUser = (user) => {
    if (!user) return false;
    const roles = getRoles(user);
    if (!roles.length) return true;
    if (roles.includes('blocked') || roles.includes('inactive')) return false;
    return roles.includes('member') || roles.includes('active') || roles.includes('admin');
  };

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
      if (!user) return;
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

  const ensureAuthenticatedOrRedirect = async () => {
    const user = getUser();
    if (!user) {
      // Not logged in → go to login
      location.replace(LOGIN_PATH);
      return false;
    }
    // Keep nf_jwt aligned on each page load
    await setNFJwtCookie(user);

    // Update local session id from current user if present (after fresh login)
    const sid = user.app_metadata && user.app_metadata.session_id;
    if (sid) saveLocalSessionId(sid);

    if (!isActiveUser(user)) {
      try { await ID.logout(); } catch {}
      clearNFJwtCookie();
      clearLocalSessionId();
      location.replace(LOGIN_PATH + '?unauthorized=1');
      return false;
    }
    return true;
  };

  const checkSingleSessionOrLogout = async () => {
    const user = getUser();
    if (!user) return { ok: false, reason: 'no_user' };
    try {
      const serverUser = await fetchServerUser(user);
      if (!serverUser) return { ok: true };
      const serverSid = serverUser.app_metadata && serverUser.app_metadata.session_id;
      const localSid = localSessionId();
      if (serverSid && localSid && serverSid !== localSid) {
        // Session moved elsewhere → sign out here.
        try { await ID.logout(); } catch {}
        clearNFJwtCookie();
        clearLocalSessionId();
        await delay(50);
        location.replace(LOGIN_PATH);
        return { ok: false, reason: 'session_mismatch' };
      }
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
    // If already logged and active, jump to members
    const user = getUser();
    if (user && isActiveUser(user)) {
      await setNFJwtCookie(user);
      const sid = user.app_metadata && user.app_metadata.session_id;
      if (sid) saveLocalSessionId(sid);
      location.replace(MEMBERS_PATH);
    }

    // Show informational messages based on query params
    try {
      const p = new URLSearchParams(location.search);
      const flashBox = document.getElementById('flash');
      if (flashBox) {
        if (p.has('unauthorized')) {
          flashBox.textContent = 'Twoje konto nie ma dostępu do tej sekcji.';
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
        if (user) {
          await setNFJwtCookie(user);
          const sid = user.app_metadata && user.app_metadata.session_id;
          if (sid) saveLocalSessionId(sid);
        }
      });
    } catch {}
    try {
      ID.on('login', async (user) => {
        await setNFJwtCookie(user);
        const sid = user.app_metadata && user.app_metadata.session_id;
        if (sid) saveLocalSessionId(sid);
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
      // On public pages, keep nf_jwt aligned if user is logged in
      const user = getUser();
      if (user) await setNFJwtCookie(user);
    }
  });
})();
