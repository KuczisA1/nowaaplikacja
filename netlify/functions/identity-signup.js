// Pass-through for signup. To disable open signups, set Identity to "Invite only"
// in the Netlify dashboard. This keeps invited users working.

exports.handler = async () => {
  return { statusCode: 200, body: JSON.stringify({}) };
};
