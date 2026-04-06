const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /map/events
// Returns lightweight EventPin objects for visible map viewport
router.get('/events', authenticate, async (req, res, next) => {
  try {
    const { swLat, swLng, neLat, neLng, hashtags } = req.query;

    if (!swLat || !swLng || !neLat || !neLng) {
      return res.status(422).json({
        error: 'VALIDATION_ERROR',
        message: 'swLat, swLng, neLat, neLng are required',
      });
    }

    const conditions = [
      `ST_Within(e.location::geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`,
      `e.cancelled = false`,
      `e.is_private = false`,
    ];
    // ST_MakeEnvelope(minX, minY, maxX, maxY) → (minX=swLng, minY=swLat, maxX=neLng, maxY=neLat)
    const values = [parseFloat(swLng), parseFloat(swLat), parseFloat(neLng), parseFloat(neLat)];
    let idx = 5;

    if (hashtags) {
      const tags = hashtags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        conditions.push(`e.hashtags && $${idx++}`);
        values.push(tags);
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = await db.query(
      `SELECT
         e.id, e.latitude, e.longitude, e.title, e.hashtags, e.start_time,
         COUNT(r.id) FILTER (WHERE r.status = 'going') AS going_count
       FROM events e
       LEFT JOIN rsvps r ON r.event_id = e.id
       ${where}
       GROUP BY e.id
       ORDER BY e.start_time ASC`,
      values
    );

    res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        latitude: parseFloat(row.latitude),
        longitude: parseFloat(row.longitude),
        title: row.title,
        hashtags: row.hashtags || [],
        goingCount: parseInt(row.going_count) || 0,
        startTime: row.start_time,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
