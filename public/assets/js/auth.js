// public/assets/js/auth.js
(() => {
  const isLoginPage = () => location.pathname.replace(/\/+$/, '') === '/login';
  const gotoLogin   = () => location.replace('/login/');
  const gotoMembers = () => location.replace('/members/');
  const q = new URLSearchParams(location.search);

  const flashEl = () => document.getElementById('flash');
  const setFlash = (msg, type = '') => {
    const el = flashEl();
    if (!el) return;
    el.textContent = msg || '';
    el.className = `flash ${type}`;
    el.style.display = msg ? 'block' : 'none';
  };

  const hasActiveRole = (user) => {
    try {
      const roles = (user?.app_metadata?.roles) || [];
      return roles.includes('active') || roles.includes('admin');
    } catch { return false; }
  };
  window.__auth_hasActiveRole = hasActiveRole;

  const genSID = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  async function bindSessionOnLogin(user) {
    try {
      const sid = genSID();
      localStorage.setItem('session_token', sid);
      await user?.update?.({ data: { session: sid, session_set_at: Date.now() } });
    } catch {}
  }
  window.__auth_bindSessionOnLogin = bindSessionOnLogin;

  async function checkSessionDrift() {
    const user = (typeof netlifyIdentity !== 'undefined') ? netlifyIdentity.currentUser() : null;
    if (!user) return;
    try {
      if (document.visibilityState === 'visible') {
        try { await user.jwt?.(true); } catch {}
      }
      const remote = user?.user_metadata?.session;
      const local  = localStorage.getItem('session_token');
      if (remote && local && remote !== local) {
        await user.logout();
        gotoLogin();
      }
    } catch {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkSessionDrift();
  });
  setInterval(checkSessionDrift, 60000);

  document.addEventListener('DOMContentLoaded', () => {
    // Jeżeli widget zablokowany (CSP/adblock) — pokaż komunikat
    if (typeof netlifyIdentity === 'undefined') {
      setFlash('Nie udało się załadować modułu logowania. Sprawdź blokery lub skontaktuj się z administratorem.', 'warn');
      // Dezaktywuj przycisk jeżeli istnieje
      const btn = document.getElementById('login-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'not-allowed'; }
      return;
    }

    try { netlifyIdentity.init(); } catch {}

    // ===== Handlery UI (bez inline) ========================================
    // LOGIN: otwarcie modala
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try { netlifyIdentity.open('login'); } catch {}
      });
    }

    // LOGOUT: przycisk w members/
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await netlifyIdentity.currentUser()?.logout(); } catch {}
        gotoLogin();
      });
    }

    // ===== Zdarzenia Identity ==============================================
    netlifyIdentity.on('init', (user) => {
      if (isLoginPage()) {
        if (user) {
          if (hasActiveRole(user)) {
            gotoMembers();
          } else {
            setFlash('Konto nieaktywne – poproś administratora o aktywację konta.', 'warn');
          }
        } else if (q.get('reason') === 'other_session') {
          setFlash('Zostałeś wylogowany, ponieważ zalogowano się na innym urządzeniu.', 'warn');
        }
      }
    });

    netlifyIdentity.on('login', async (user) => {
      if (hasActiveRole(user)) {
        await bindSessionOnLogin(user);
        try { netlifyIdentity.close(); } catch {}
        gotoMembers();
      } else {
        setFlash('Konto nieaktywne – poproś administratora o aktywację konta.', 'warn');
      }
    });

    netlifyIdentity.on('logout', () => gotoLogin());
  });
})();
