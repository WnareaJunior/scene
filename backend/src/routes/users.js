const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

// GET /users/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, username, bio, gender, interests, profile_picture, created_at,
              (SELECT count(*) FROM follows WHERE followed_id = users.id) AS followers_count,
              (SELECT count(*) FROM follows WHERE follower_id = users.id) AS following_count
       FROM users WHERE id = $1`,
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /users/me
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { bio, gender, interests, profilePicture } = req.body;
    const { rows } = await db.query(
      `UPDATE users SET
         bio = COALESCE($1, bio),
         gender = COALESCE($2, gender),
         interests = COALESCE($3, interests),
         profile_picture = COALESCE($4, profile_picture),
         updated_at = now()
       WHERE id = $5
       RETURNING id, email, username, bio, gender, interests, profile_picture, created_at`,
      [bio, gender, interests, profilePicture, req.user.sub]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /users/me/hosted-events
router.get('/me/hosted-events', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.query;
    let filter = '';
    if (status === 'upcoming') filter = `AND start_time >= now()`;
    else if (status === 'past') filter = `AND start_time < now()`;

    const { rows } = await db.query(
      `SELECT id, title, description, latitude, longitude, address, start_time, end_time,
              capacity, hashtags, is_private, show_attendees, status, created_at
       FROM events
       WHERE host_id = $1 AND status != 'cancelled' ${filter}
       ORDER BY start_time DESC`,
      [req.user.sub]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /users/me/rsvps
router.get('/me/rsvps', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.query;
    const params = [req.user.sub];
    let rsvpFilter = '';
    if (status === 'going' || status === 'interested') {
      rsvpFilter = `AND r.status = $2`;
      params.push(status);
    }

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags, r.status AS rsvp_status
       FROM rsvps r
       JOIN events e ON e.id = r.event_id
       WHERE r.user_id = $1 ${rsvpFilter}
       ORDER BY e.start_time DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /users/:userId
router.get('/:userId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, username, bio, gender, interests, profile_picture, created_at,
              (SELECT count(*) FROM follows WHERE followed_id = users.id) AS followers_count,
              (SELECT count(*) FROM follows WHERE follower_id = users.id) AS following_count
       FROM users WHERE id = $1`,
      [req.params.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /users/:userId/follow
router.post('/:userId/follow', requireAuth, async (req, res, next) => {
  try {
    if (req.params.userId === req.user.sub) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    await db.query(
      `INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.sub, req.params.userId]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DELETE /users/:userId/follow
router.delete('/:userId/follow', requireAuth, async (req, res, next) => {
  try {
    await db.query(
      `DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2`,
      [req.user.sub, req.params.userId]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /users/:userId/followers
router.get('/:userId/followers', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.profile_picture
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.followed_id = $1
       ORDER BY f.created_at DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /users/:userId/following
router.get('/:userId/following', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.profile_picture
       FROM follows f
       JOIN users u ON u.id = f.followed_id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
