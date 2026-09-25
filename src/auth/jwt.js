const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      jina: user.jina,
      jukumu: user.jukumu,
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