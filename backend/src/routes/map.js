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
    const swLatF = parseFloat(swLat), swLngF = parseFloat(swLng);
    const neLatF = parseFloat(neLat), neLngF = parseFloat(neLng);
    if (!Number.isFinite(swLatF) || !Number.isFinite(swLngF) || !Number.isFinite(neLatF) || !Number.isFinite(neLngF)) {
      return res.status(400).json({ error: 'swLat, swLng, neLat, neLng must be finite numbers' });
    }

    const params = [swLngF, swLatF, neLngF, neLatF];
    let hashtagFilter = '';
    if (hashtags) {
      const tags = hashtags.split(',').map(t => t.trim());
      params.push(tags);
      hashtagFilter = `AND hashtags && $5`;
    }

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.latitude, e.longitude, e.hashtags,
              e.start_time, e.end_time,
              COUNT(r.id) FILTER (WHERE r.status = 'going') AS going_count
       FROM events e
       LEFT JOIN rsvps r ON r.event_id = e.id
       WHERE e.status = 'active'
         AND e.is_private = false
         -- keep live parties on the map: a party without an end time counts as
         -- live for 4 hours after it starts (matches the client's getState)
         AND COALESCE(e.end_time, e.start_time + interval '4 hours') > now()
         AND ST_Within(e.location::geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
         ${hashtagFilter}
       GROUP BY e.id
       ORDER BY e.start_time ASC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
