https://kuczis.netlify.app/members/module/bitpaper

https://kuczis.netlify.app/members/module/chat/?prompt=test.json

https://kuczis.netlify.app/members/module/forms/?id=1YmTr2X0Fx-0T5a8CHpH0sBBz9rTzmIELo2bLnlsdd3M

https://kuczis.netlify.app/members/module/kalkulator

https://kuczis.netlify.app/members/module/pdf/?id=1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF&type=1

https://kuczis.netlify.app/members/module/contact/?internal=wiadomosc

https://kuczis.netlify.app/members/module/slides/index.html?id=1q27sAFuVxw-ILceGOdVPcaBz2nD_sC2B&type=


    
https://kuczis.netlify.app/members/module/whiteboard

https://kuczis.netlify.app/members/module/film/?id=CH50zuS8DD0&type=1

## Konfiguracja Stripe

1. Ustaw zmienne środowiskowe w panelu Netlify (Production i Deploy Previews):

   * `STRIPE_SECRET_KEY` – klucz prywatny (skopiuj z Stripe dashboard).
   * `STRIPE_WEBHOOK_SECRET` – sekret webhooka dla endpointu `/.netlify/functions/stripe-webhook`.
   * `STRIPE_PRICE_1DAY`, `STRIPE_PRICE_1MONTH`, `STRIPE_PRICE_6MONTHS`, `STRIPE_PRICE_1YEAR` – identyfikatory cen z Stripe (Price ID).
   * `IDENTITY_ADMIN_TOKEN` – token administratora Netlify Identity (GoTrue admin API).
   * `ACTIVATION_BASE_URL` – pełny adres witryny (np. `https://twojadomena.netlify.app`).

2. W Stripe dodaj webhook kierujący na `https://twojadomena.netlify.app/.netlify/functions/stripe-webhook` i wybierz zdarzenia `checkout.session.completed`, `checkout.session.async_payment_succeeded` oraz `checkout.session.expired`.

3. Po udanym zakupie status użytkownika w Netlify Identity zostanie ustawiony na `active`, a po wygaśnięciu subskrypcji strona aktywacyjna automatycznie zdezaktywuje konto przy kolejnym sprawdzeniu statusu.

4. Aby przetestować lokalnie, uruchom `netlify dev` i ustaw zmienne w pliku `.env` lub użyj `netlify env:import`.

