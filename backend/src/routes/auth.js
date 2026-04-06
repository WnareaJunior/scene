const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function createAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
}

function createRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

function formatUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    bio: row.bio,
    gender: row.gender,
    interests: row.interests || [],
    profilePicture: row.profile_picture,
    followerCount: parseInt(row.follower_count) || 0,
    followingCount: parseInt(row.following_count) || 0,
    createdAt: row.created_at,
  };
}

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'email, password, and username are required' });
    }
    if (password.length < 8) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' });
    }
    if (username.length < 2 || username.length > 30) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'Username must be 2–30 characters' });
    }

    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'CONFLICT', message: 'Email or username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, bio, gender, interests, profile_picture, created_at`,
      [username, email.toLowerCase(), passwordHash]
    );
    const user = result.rows[0];

    const accessToken = createAccessToken(user.id);
    const refreshToken = createRefreshToken(user.id);

    const decoded = jwt.decode(refreshToken);
    await db.query(
      'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, to_timestamp($3))',
      [refreshToken, user.id, decoded.exp]
    );

    res.status(201).json({
      accessToken,
      refreshToken,
      user: formatUser({ ...user, follower_count: 0, following_count: 0 }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'email and password are required' });
    }

    const result = await db.query(
      `SELECT u.*,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following_count
       FROM users u WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const accessToken = createAccessToken(user.id);
    const refreshToken = createRefreshToken(user.id);

    const decoded = jwt.decode(refreshToken);
    await db.query(
      'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, to_timestamp($3))',
      [refreshToken, user.id, decoded.exp]
    );

    res.json({
      accessToken,
      refreshToken,
      user: formatUser(user),
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'refreshToken is required' });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired refresh token' });
    }

    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid token type' });
    }

    const stored = await db.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );
    if (stored.rows.length === 0) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Refresh token has been revoked' });
    }

    const accessToken = createAccessToken(payload.sub);
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
