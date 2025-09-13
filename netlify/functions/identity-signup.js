// netlify/functions/identity-signup.js
exports.handler = async (event) => {
  const { user } = JSON.parse(event.body || "{}");
  const roles = (user?.app_metadata?.roles) || [];
  // Jeśli rola nie została nadana ręcznie, ustaw "pending"
  if (!roles.includes('active') && !roles.includes('admin')) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        app_metadata: {
          ...(user?.app_metadata || {}),
          roles: ['pending']
        }
      })
    };
  }
  return { statusCode: 200, body: JSON.stringify({}) };
};
