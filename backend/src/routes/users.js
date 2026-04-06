const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

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

function formatUserSummary(row) {
  return {
    id: row.id,
    username: row.username,
    profilePicture: row.profile_picture,
  };
}

function formatEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    address: row.address,
    startTime: row.start_time,
    endTime: row.end_time,
    capacity: row.capacity,
    goingCount: parseInt(row.going_count) || 0,
    interestedCount: parseInt(row.interested_count) || 0,
    hashtags: row.hashtags || [],
    isPrivate: row.is_private,
    showAttendees: row.show_attendees,
    host: {
      id: row.host_id,
      username: row.host_username,
      profilePicture: row.host_profile_picture,
    },
    createdAt: row.created_at,
  };
}

const USER_WITH_COUNTS = `
  SELECT u.*,
    (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS follower_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id   = u.id) AS following_count
  FROM users u
`;

const EVENT_WITH_COUNTS = `
  SELECT e.*,
    u.username AS host_username,
    u.profile_picture AS host_profile_picture,
    COUNT(r.id) FILTER (WHERE r.status = 'going')       AS going_count,
    COUNT(r.id) FILTER (WHERE r.status = 'interested')  AS interested_count
  FROM events e
  JOIN users u ON u.id = e.host_id
  LEFT JOIN rsvps r ON r.event_id = e.id
`;

// GET /users/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(`${USER_WITH_COUNTS} WHERE u.id = $1`, [req.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found' });
    res.json(formatUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /users/me
router.patch('/me', authenticate, async (req, res, next) => {
  try {
    const { bio, gender, interests, profilePicture } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;

    if (bio !== undefined)            { fields.push(`bio = $${idx++}`);             values.push(bio); }
    if (gender !== undefined)         { fields.push(`gender = $${idx++}`);           values.push(gender); }
    if (interests !== undefined)      { fields.push(`interests = $${idx++}`);        values.push(interests); }
    if (profilePicture !== undefined) { fields.push(`profile_picture = $${idx++}`);  values.push(profilePicture); }

    if (fields.length === 0) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'No fields to update' });
    }

    values.push(req.userId);
    const result = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const counts = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM follows WHERE following_id = $1) AS follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id   = $1) AS following_count`,
      [req.userId]
    );

    res.json(formatUser({ ...result.rows[0], ...counts.rows[0] }));
  } catch (err) {
    next(err);
  }
});

// GET /users/me/hosted-events
router.get('/me/hosted-events', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = ['e.host_id = $1', 'e.cancelled = false'];
    const values = [req.userId];
    let idx = 2;

    if (status === 'upcoming') { conditions.push(`e.start_time >= NOW()`); }
    if (status === 'past')     { conditions.push(`e.start_time < NOW()`); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await db.query(
      `SELECT COUNT(*) FROM events e ${where}`,
      values
    );

    values.push(parseInt(limit), offset);
    const result = await db.query(
      `${EVENT_WITH_COUNTS} ${where} GROUP BY e.id, u.id ORDER BY e.start_time DESC LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    const total = parseInt(countRes.rows[0].count);
    res.json({
      data: result.rows.map(formatEvent),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /users/me/rsvps
router.get('/me/rsvps', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = ['rsvp.user_id = $1', 'e.cancelled = false'];
    const values = [req.userId];
    let idx = 2;

    if (status === 'going' || status === 'interested') {
      conditions.push(`rsvp.status = $${idx++}`);
      values.push(status);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await db.query(
      `SELECT COUNT(*) FROM rsvps rsvp JOIN events e ON e.id = rsvp.event_id ${where}`,
      values
    );

    values.push(parseInt(limit), offset);
    const result = await db.query(
      `SELECT e.*,
         u.username AS host_username,
         u.profile_picture AS host_profile_picture,
         COUNT(r.id) FILTER (WHERE r.status = 'going')      AS going_count,
         COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count
       FROM rsvps rsvp
       JOIN events e ON e.id = rsvp.event_id
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       ${where}
       GROUP BY e.id, u.id
       ORDER BY e.start_time DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    const total = parseInt(countRes.rows[0].count);
    res.json({
      data: result.rows.map(formatEvent),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /users/:userId
router.get('/:userId', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(`${USER_WITH_COUNTS} WHERE u.id = $1`, [req.params.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found' });
    res.json(formatUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /users/:userId/follow
router.post('/:userId/follow', authenticate, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (userId === req.userId) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Cannot follow yourself' });
    }
    try {
      await db.query(
        'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)',
        [req.userId, userId]
      );
      res.status(204).send();
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'CONFLICT', message: 'Already following' });
      if (err.code === '23503') return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found' });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// DELETE /users/:userId/follow
router.delete('/:userId/follow', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.userId, req.params.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Not following this user' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /users/:userId/followers
router.get('/:userId/followers', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const countRes = await db.query(
      'SELECT COUNT(*) FROM follows WHERE following_id = $1',
      [req.params.userId]
    );
    const result = await db.query(
      `SELECT u.id, u.username, u.profile_picture
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.userId, parseInt(limit), offset]
    );

    const total = parseInt(countRes.rows[0].count);
    res.json({
      data: result.rows.map(formatUserSummary),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /users/:userId/following
router.get('/:userId/following', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const countRes = await db.query(
      'SELECT COUNT(*) FROM follows WHERE follower_id = $1',
      [req.params.userId]
    );
    const result = await db.query(
      `SELECT u.id, u.username, u.profile_picture
       FROM follows f JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.userId, parseInt(limit), offset]
    );

    const total = parseInt(countRes.rows[0].count);
    res.json({
      data: result.rows.map(formatUserSummary),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
