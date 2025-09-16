// Pass-through for signup. To disable open signups, set Identity to "Invite only"
// in the Netlify dashboard. This keeps invited users working.

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}');
    const user = payload && payload.user ? payload.user : {};
    const appMeta = user.app_metadata || {};
    const existingRoles = Array.isArray(appMeta.roles) ? appMeta.roles : [];
    const roles = Array.from(new Set([...existingRoles, 'member']));

    return {
      statusCode: 200,
      body: JSON.stringify({
        app_metadata: {
          ...appMeta,
          roles
        }
      })
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({}) };
  }
};
