const jwt = require('jsonwebtoken');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'scene-api',
      audience: 'scene-app',
    });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
