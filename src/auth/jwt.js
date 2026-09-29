const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      jina: user.jina,
      jukumu: user.jukumu,
      // BR-26: which till this session is. Claimed at login and carried in the
      // token rather than sent per request, so a client cannot name a different
      // device and have two tills share an order-number sequence.
      kifaa_id: user.kifaa_id ?? null,
      kifaa_alama: user.kifaa_alama ?? null,
    },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };