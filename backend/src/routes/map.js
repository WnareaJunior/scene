const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

// GET /map/events
router.get('/events', requireAuth, async (req, res, next) => {
  try {
    const { swLat, swLng, neLat, neLng, hashtags } = req.query;

    if (!swLat || !swLng || !neLat || !neLng) {
      return res.status(400).json({ error: 'swLat, swLng, neLat, neLng are required' });
    }

    const params = [swLng, swLat, neLng, neLat];
    let hashtagFilter = '';
    if (hashtags) {
      const tags = hashtags.split(',').map(t => t.trim());
      params.push(tags);
      hashtagFilter = `AND hashtags && $5`;
    }

    const { rows } = await db.query(
      `SELECT id, title, latitude, longitude, hashtags,
              start_time,
              (SELECT count(*) FROM rsvps WHERE event_id = events.id AND status = 'going') AS going_count
       FROM events
       WHERE status = 'active'
         AND is_private = false
         AND start_time >= now()
         AND ST_Within(location::geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
         ${hashtagFilter}
       ORDER BY start_time ASC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
