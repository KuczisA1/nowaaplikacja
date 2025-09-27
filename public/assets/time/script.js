    (function () {
      const TIMED_ROLES = new Set(['hour', 'day', 'week', 'month', 'halfyear', 'year']);
      const ROLE_LABELS = {
        hour: 'Dostęp na godzinę',
        day: 'Dostęp na 1 dzień',
        week: 'Dostęp na 7 dni',
        month: 'Dostęp na 1 miesiąc',
        halfyear: 'Dostęp na 6 miesięcy',
        year: 'Dostęp na 12 miesięcy'
      };
      const ACTIVE_STATUS_VALUES = ['active', 'aktywny', 'approved', 'enabled', 'admin'];

      const parseTimestamp = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim()) {
          const parsed = Date.parse(value);
          if (Number.isFinite(parsed)) return parsed;
        }
        return 0;
      };

      const statusValue = (user) => {
        if (!user) return '';
        const appMeta = user.app_metadata;
        const userMeta = user.user_metadata;
        const raw = (appMeta && typeof appMeta.status === 'string' && appMeta.status)
          || (userMeta && typeof userMeta.status === 'string' && userMeta.status)
          || '';
        return raw.trim().toLowerCase();
      };

      const timedAccessState = (user) => {
        const meta = user && user.app_metadata ? user.app_metadata.timed_access : undefined;
        const rawRole = meta && typeof meta.role === 'string' ? meta.role.trim() : '';
        const role = rawRole && TIMED_ROLES.has(rawRole) ? rawRole : '';
        return {
          role,
          assignedAt: meta ? parseTimestamp(meta.assigned_at) : 0,
          expiresAt: meta ? parseTimestamp(meta.expires_at) : 0
        };
      };

      const formatUnit = (value, forms) => {
        const abs = Math.abs(value) % 100;
        const mod10 = abs % 10;
        if (abs === 1) return forms[0];
        if (abs >= 12 && abs <= 14) return forms[2];
        if (mod10 >= 2 && mod10 <= 4) return forms[1];
        return forms[2];
      };

      const formatDuration = (ms) => {
        if (ms <= 0) return '0 sekund';
        let secondsTotal = Math.floor(ms / 1000);
        const days = Math.floor(secondsTotal / 86400);
        secondsTotal -= days * 86400;
        const hours = Math.floor(secondsTotal / 3600);
        secondsTotal -= hours * 3600;
        const minutes = Math.floor(secondsTotal / 60);
        secondsTotal -= minutes * 60;
        const seconds = secondsTotal;
        const units = [
          { value: days, forms: ['dzień', 'dni', 'dni'], optional: true },
          { value: hours, forms: ['godzina', 'godziny', 'godzin'], optional: true },
          { value: minutes, forms: ['minuta', 'minuty', 'minut'], optional: true },
          { value: seconds, forms: ['sekunda', 'sekundy', 'sekund'], optional: false }
        ];
        const parts = [];
        for (const { value, forms, optional } of units) {
          if (optional && value === 0) continue;
          if (!optional && value === 0 && parts.length === 0) {
            return '0 sekund';
          }
          parts.push(`${value} ${formatUnit(value, forms)}`);
        }
        return parts.join(' ');
      };

      const fetchFreshUser = async (user) => {
        if (!user) return null;
        try {
          const token = await user.jwt();
          const res = await fetch('/.netlify/identity/user', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store'
          });
          if (!res.ok) throw new Error('user fetch failed');
          return await res.json();
        } catch (err) {
          return user;
        }
      };

      document.addEventListener('DOMContentLoaded', () => {
        const statusEl = document.getElementById('status');
        const detailsEl = document.getElementById('details');
        const roleEl = document.getElementById('role');
        const countdownEl = document.getElementById('countdown-value');
        const expiresEl = document.getElementById('expires');
        let countdownTimer = null;

        const stopTimer = () => {
          if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
          }
        };

        const showStatus = (message) => {
          statusEl.textContent = message;
        };

        const showResult = (user) => {
          stopTimer();
          if (!user) {
            detailsEl.hidden = true;
            showStatus('Zaloguj się, aby sprawdzić czas dostępu.');
            return;
          }

          fetchFreshUser(user).then((fresh) => {
            const current = fresh || user;
            const roles = (current.app_metadata && current.app_metadata.roles) || [];
            const timed = timedAccessState(current);
            const now = Date.now();

            if (!timed.role) {
              detailsEl.hidden = true;
              if (roles.includes('admin') || roles.includes('active') || ACTIVE_STATUS_VALUES.includes(statusValue(current))) {
                showStatus('Twoje konto ma stały dostęp.');
              } else {
                showStatus('Brak aktywnej roli czasowej dla tego konta.');
              }
              return;
            }

            if (!roles.includes(timed.role)) {
              detailsEl.hidden = true;
              showStatus('Brak aktywnej roli czasowej dla tego konta.');
              return;
            }

            const expiresAt = timed.expiresAt;
            const label = ROLE_LABELS[timed.role] || timed.role;
            roleEl.textContent = `Rola czasowa: ${label}`;
            expiresEl.textContent = '';

            const updateCountdown = () => {
              const remaining = expiresAt - Date.now();
              if (remaining <= 0) {
                stopTimer();
                detailsEl.hidden = true;
                const elapsed = Date.now() - expiresAt;
                const suffix = elapsed > 0 ? ` (${formatDuration(elapsed)} temu)` : '';
                showStatus(`Dostęp wygasł${suffix}.`);
                return;
              }
              detailsEl.hidden = false;
              countdownEl.textContent = formatDuration(remaining);
              expiresEl.textContent = `Wygasa: ${new Date(expiresAt).toLocaleString('pl-PL')}`;
              showStatus('Twoje konto ma aktywny dostęp czasowy.');
            };

            if (!expiresAt || expiresAt <= now) {
              updateCountdown();
              return;
            }

            updateCountdown();
            countdownTimer = window.setInterval(updateCountdown, 1000);
          });
        };

        if (typeof netlifyIdentity === 'undefined') {
          showStatus('Brak modułu Netlify Identity. Spróbuj odświeżyć stronę.');
          return;
        }

        netlifyIdentity.on('init', (user) => showResult(user));
        netlifyIdentity.on('login', (user) => showResult(user));
        netlifyIdentity.on('logout', () => {
          stopTimer();
          detailsEl.hidden = true;
          showStatus('Zaloguj się, aby sprawdzić czas dostępu.');
        });

        try {
          netlifyIdentity.init();
        } catch (err) {
          console.error('Identity init failed', err);
          showResult(null);
        }
      });
    })();