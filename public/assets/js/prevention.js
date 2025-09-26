(function () {
  const REDIRECT_TO = "/";

  // --- 1) Ochrona: nie uruchamiaj na urządzeniach mobilnych / dotykowych ---
  const ua = navigator.userAgent || "";
  const isTouch = navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const isProbablyMobile = isTouch || isMobileUA;

  if (isProbablyMobile) return; // wyjście: nie wykrywamy DevTools na mobile

  // --- 2) Funkcja przekierowania (raz) ---
  let redirected = false;
  function redirectOnce() {
    if (redirected) return;
    redirected = true;
    location.assign(REDIRECT_TO);
  }

  // --- 3) Detekcja różnicy okna (panel DevTools) z histerezą ---
  const GAP_THRESHOLD = 160;      // typowa szer./wys. panelu DevTools
  const CHECK_MS = 600;           // co ile sprawdzać
  const NEED_CONSECUTIVE = 2;     // ile razy z rzędu potwierdzić
  let consecutiveHits = 0;

  function panelLikelyOpen() {
    const wGap = window.outerWidth - window.innerWidth;
    const hGap = window.outerHeight - window.innerHeight;
    return wGap > GAP_THRESHOLD || hGap > GAP_THRESHOLD;
  }

  const intervalId = setInterval(() => {
    if (panelLikelyOpen()) {
      consecutiveHits++;
      if (consecutiveHits >= NEED_CONSECUTIVE) {
        clearInterval(intervalId);
        redirectOnce();
      }
    } else {
      consecutiveHits = 0;
    }
  }, CHECK_MS);

  // --- 4) Dodatkowa “przynęta” w konsoli: zadziała tylko gdy konsola jest otwarta ---
  // W wielu przeglądarkach logowanie elementu z getterem odpala getter przy renderze w konsoli.
  const bait = new Image();
  Object.defineProperty(bait, "id", {
    get() {
      // Konsola otwarta i próbuje wyrenderować obiekt
      redirectOnce();
      return "";
    }
  });

  // Od czasu do czasu logujemy "przynętę"; gdy konsola jest zamknięta, nic się nie dzieje.
  const baitTimer = setInterval(() => {
    if (redirected) {
      clearInterval(baitTimer);
      return;
    }
    try {
      console.log(bait);
    } catch (e) { /* ignore */ }
  }, 1500);

  // Sprzątanie przy nawigacji
  window.addEventListener("beforeunload", () => {
    clearInterval(intervalId);
    clearInterval(baitTimer);
  });
})();