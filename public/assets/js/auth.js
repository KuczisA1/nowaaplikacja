// public/assets/js/auth.js
(() => {
  // ===== Helpers ============================================================
  const isLoginPage = () => location.pathname.replace(/\/+$/, '') === '/login';
  const gotoLogin   = () => location.replace('/login/');
  const gotoMembers = () => location.replace('/members/');
  const q = new URLSearchParams(location.search);

  // Prosty flash (zadziała, jeśli strona ma #flash)
  const flash = (msg, type = '') => {
    const el = document.getElementById('flash');
    if (!el) return;
    el.textContent = msg || '';
    el.className = `flash ${type}`;
  };

  // Sprawdzenie ról (aktywny dostęp)
  const hasActiveRole = (user) => {
    try {
      const roles = (user?.app_metadata?.roles) || [];
      return roles.includes('active') || roles.includes('admin');
    } catch { return false; }
  };
  // wystaw do użytku w innych skryptach (np. identity-login.html)
  window.__auth_hasActiveRole = hasActiveRole;

  // Generowanie ID sesji (dla miękkiego single-login)
  const genSID = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  // Zapisz "ostatnią sesję" w user_metadata i w localStorage
  async function bindSessionOnLogin(user) {
    try {
      const sid = genSID();
      localStorage.setItem('session_token', sid);
      await user?.update?.({ data: { session: sid, session_set_at: Date.now() } });
    } catch {}
  }
  window.__auth_bindSessionOnLogin = bindSessionOnLogin;

  // Weryfikacja spójności sesji – jeśli user_metadata.session != localStorage → wyloguj
  async function checkSessionDrift() {
    const user = netlifyIdentity.currentUser();
    if (!user) return;
    try {
      // Odśwież JWT możliwie oszczędnie (tylko gdy dokument widoczny)
      if (document.visibilityState === 'visible') {
        try { await user.jwt?.(true); } catch {}
      }
      const remote = user?.user_metadata?.session;
      const local  = localStorage.getItem('session_token');
      if (remote && local && remote !== local) {
        await user.logout();
        // Przekaż powód na /login/
        gotoLogin();
      }
    } catch {}
  }

  // Delikatny scheduler: sprawdzaj po powrocie karty i co ~60s
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkSessionDrift();
  });
  setInterval(checkSessionDrift, 60000);

  // ===== Identity init + zdarzenia =========================================
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof netlifyIdentity === 'undefined') return;

    try { netlifyIdentity.init(); } catch {}

    // Na stronach z przyciskiem #logout-link — własny handler
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await netlifyIdentity.currentUser()?.logout(); } catch {}
        gotoLogin();
      });
    }

    // Po inicjalizacji (odświeżenie strony etc.)
    netlifyIdentity.on('init', (user) => {
      // Jeśli ktoś jest na /login i już zalogowany
      if (isLoginPage()) {
        if (user) {
          if (hasActiveRole(user)) {
            gotoMembers();
          } else {
            flash('Konto nieaktywne – poproś administratora o aktywację konta.', 'warn');
          }
        } else {
          // Komunikat z query (?reason=other_session)
          if (q.get('reason') === 'other_session') {
            flash('Zostałeś wylogowany, ponieważ zalogowano się na innym urządzeniu.', 'warn');
          }
        }
      }
    });

    // Po zalogowaniu
    netlifyIdentity.on('login', async (user) => {
      if (hasActiveRole(user)) {
        await bindSessionOnLogin(user); // miękkie single-login
        gotoMembers();
      } else {
        flash('Konto nieaktywne – poproś administratora o aktywację konta.', 'warn');
      }
    });

    // Po wylogowaniu zawsze do /login/ — bez zbędnych odświeżeń
    netlifyIdentity.on('logout', () => gotoLogin());
  });
})();
