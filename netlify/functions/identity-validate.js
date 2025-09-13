// netlify/functions/identity-validate.js
exports.handler = async () => {
  return {
    statusCode: 401,
    body: JSON.stringify({ error: "Rejestracja wyłączona. Użyj zaproszenia od administratora." })
  };
};
