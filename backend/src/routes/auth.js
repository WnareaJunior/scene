const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAuth = require('../middleware/auth');

// NOTE: The `token` column in refresh_tokens should be VARCHAR(64) or CHAR(64)
// to store SHA-256 hex digests (64 chars) rather than full JWT strings.
// Migration required: ALTER TABLE refresh_tokens ALTER COLUMN token TYPE VARCHAR(64);
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
const JWT_OPTS = { algorithm: 'HS256', issuer: 'scene-api', audience: 'scene-app' };

function signAccess(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, {
    ...JWT_OPTS,
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
}

function signRefresh(userId) {
  return jwt.sign({ sub: userId, jti: uuidv4() }, process.env.JWT_REFRESH_SECRET, {
    ...JWT_OPTS,
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'email, password, and username are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!/^\w+$/.test(username)) {
      return res.status(400).json({ error: 'Username must contain only alphanumeric characters and underscores' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, username)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, bio, gender, interests, profile_picture, created_at`,
      [email.toLowerCase(), hash, username]
    );
    const user = rows[0];

    const accessToken = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    const decoded = jwt.decode(refreshToken);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, to_timestamp($3))`,
      [user.id, hashToken(refreshToken), decoded.exp]
    );

    res.status(201).json({ accessToken, refreshToken, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email or username already taken' });
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const { rows } = await db.query(
      `SELECT id, email, username, password_hash, bio, gender, interests, profile_picture, created_at
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    const decoded = jwt.decode(refreshToken);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, to_timestamp($3))`,
      [user.id, hashToken(refreshToken), decoded.exp]
    );

    const { password_hash, ...safeUser } = user;
    res.json({ accessToken, refreshToken, user: safeUser });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
        algorithms: ['HS256'],
        issuer: 'scene-api',
        audience: 'scene-app',
      });
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const { rows } = await db.query(
      `SELECT id FROM refresh_tokens WHERE token = $1 AND expires_at > now()`,
      [hashToken(refreshToken)]
    );
    if (!rows.length) return res.status(401).json({ error: 'Token revoked or expired' });

    const accessToken = signAccess(payload.sub);
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await db.query(
        `DELETE FROM refresh_tokens WHERE token = $1 AND user_id = $2`,
        [hashToken(refreshToken), req.user.id]
      );
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
