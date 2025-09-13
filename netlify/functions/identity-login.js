// netlify/functions/identity-login.js
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const user = body.user || {};
    const roles = (user.app_metadata && user.app_metadata.roles) || [];

    // NIE blokujemy logowania — pokazujesz komunikat na /login/ (auth.js + RBAC na CDN)
    // Jeśli jednak chcesz twardo zablokować logowanie dla nieaktywnych kont,
    // odkomentuj blok poniżej:
    /*
    const allowed = roles.includes('active') || roles.includes('admin');
    if (!allowed) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Konto nieaktywne. Poproś administratora o aktywację." })
      };
    }
    */

    // Nadaj nowy identyfikator sesji — poprzednie urządzenia zostaną "zdetronizowane"
    const sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        user_metadata: {
          ...(user.user_metadata || {}),
          session: sid,
          session_set_at: Date.now()
        }
      })
    };
  } catch (e) {
    // w razie czego nie blokuj logowania
    return { statusCode: 200, body: JSON.stringify({}) };
  }
};
