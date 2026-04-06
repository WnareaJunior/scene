const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function formatEvent(row) {
  const event = {
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
  if (row.distance_meters !== undefined && row.distance_meters !== null) {
    event.distanceMeters = parseFloat(row.distance_meters);
  }
  return event;
}

const EVENT_BASE = `
  SELECT e.*,
    u.username AS host_username,
    u.profile_picture AS host_profile_picture,
    COUNT(r.id) FILTER (WHERE r.status = 'going')      AS going_count,
    COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count
  FROM events e
  JOIN users u ON u.id = e.host_id
  LEFT JOIN rsvps r ON r.event_id = e.id
`;

// POST /events
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { title, description, latitude, longitude, address, startTime, endTime, capacity, hashtags, isPrivate, showAttendees } = req.body;

    if (!title || latitude == null || longitude == null || !startTime || !capacity) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'title, latitude, longitude, startTime, and capacity are required' });
    }
    if (capacity < 1) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'capacity must be at least 1' });
    }

    const result = await db.query(
      `INSERT INTO events (host_id, title, description, latitude, longitude,
         location, address, start_time, end_time, capacity, hashtags, is_private, show_attendees)
       VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($5::float,$4::float),4326),$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.userId, title, description ?? null, latitude, longitude,
        address ?? null, startTime, endTime ?? null, capacity,
        hashtags ?? [], isPrivate ?? false, showAttendees ?? true,
      ]
    );

    // Re-fetch with host info
    const full = await db.query(
      `${EVENT_BASE} WHERE e.id = $1 GROUP BY e.id, u.id`,
      [result.rows[0].id]
    );
    res.status(201).json(formatEvent(full.rows[0]));
  } catch (err) {
    next(err);
  }
});

// GET /events/feed  — must be before /:eventId
router.get('/feed', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const countRes = await db.query(
      `SELECT COUNT(DISTINCT e.id)
       FROM events e
       JOIN follows f ON f.following_id = e.host_id
       WHERE f.follower_id = $1 AND e.cancelled = false`,
      [req.userId]
    );

    const result = await db.query(
      `SELECT e.*,
         u.username AS host_username,
         u.profile_picture AS host_profile_picture,
         COUNT(r.id) FILTER (WHERE r.status = 'going')      AS going_count,
         COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count
       FROM events e
       JOIN users u ON u.id = e.host_id
       JOIN follows f ON f.following_id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       WHERE f.follower_id = $1 AND e.cancelled = false
       GROUP BY e.id, u.id
       ORDER BY e.start_time ASC
       LIMIT $2 OFFSET $3`,
      [req.userId, parseInt(limit), offset]
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

// GET /events/random  — must be before /:eventId
router.get('/random', authenticate, async (req, res, next) => {
  try {
    const { lat, lng, radius = 10000, hashtags, excludeAttended = false } = req.query;

    if (!lat || !lng) {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'lat and lng are required' });
    }

    const conditions = [
      `ST_DWithin(e.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
      `e.cancelled = false`,
      `e.is_private = false`,
    ];
    const values = [parseFloat(lng), parseFloat(lat), parseInt(radius)];
    let idx = 4;

    // Exclude events at capacity
    conditions.push(`(SELECT COUNT(*) FROM rsvps WHERE event_id = e.id AND status = 'going') < e.capacity`);

    if (hashtags) {
      const tags = hashtags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        conditions.push(`e.hashtags && $${idx++}`);
        values.push(tags);
      }
    }

    if (excludeAttended === 'true' || excludeAttended === true) {
      conditions.push(`NOT EXISTS (SELECT 1 FROM rsvps WHERE event_id = e.id AND user_id = $${idx++})`);
      values.push(req.userId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = await db.query(
      `SELECT e.*,
         u.username AS host_username,
         u.profile_picture AS host_profile_picture,
         COUNT(r.id) FILTER (WHERE r.status = 'going')      AS going_count,
         COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count
       FROM events e
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       ${where}
       GROUP BY e.id, u.id
       ORDER BY RANDOM()
       LIMIT 1`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No events found matching the given filters' });
    }
    res.json(formatEvent(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// GET /events  — discover / search
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { lat, lng, radius = 5000, swLat, swLng, neLat, neLng, hashtags, startAfter, startBefore, page = 1, limit = 20 } = req.query;
    const lim = Math.min(parseInt(limit), 100);
    const offset = (parseInt(page) - 1) * lim;

    const conditions = [`e.cancelled = false`, `e.is_private = false`];
    const values = [];
    let idx = 1;
    let distanceExpr = 'NULL';

    if (swLat && swLng && neLat && neLng) {
      // Bounding box mode
      conditions.push(`ST_Within(e.location::geometry, ST_MakeEnvelope($${idx++}, $${idx++}, $${idx++}, $${idx++}, 4326))`);
      values.push(parseFloat(swLng), parseFloat(swLat), parseFloat(neLng), parseFloat(neLat));
    } else if (lat && lng) {
      // Radius mode — also compute distance
      conditions.push(`ST_DWithin(e.location::geography, ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 4326)::geography, $${idx++})`);
      values.push(parseFloat(lng), parseFloat(lat), parseInt(radius));
      distanceExpr = `ST_Distance(e.location::geography, ST_SetSRID(ST_MakePoint(${parseFloat(lng)}, ${parseFloat(lat)}), 4326)::geography)`;
    }

    if (hashtags) {
      const tags = hashtags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        conditions.push(`e.hashtags && $${idx++}`);
        values.push(tags);
      }
    }
    if (startAfter)  { conditions.push(`e.start_time > $${idx++}`);  values.push(startAfter); }
    if (startBefore) { conditions.push(`e.start_time < $${idx++}`);  values.push(startBefore); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countRes = await db.query(
      `SELECT COUNT(DISTINCT e.id) FROM events e ${where}`,
      values
    );

    values.push(lim, offset);
    const result = await db.query(
      `SELECT e.*,
         u.username AS host_username,
         u.profile_picture AS host_profile_picture,
         COUNT(r.id) FILTER (WHERE r.status = 'going')      AS going_count,
         COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count,
         ${distanceExpr} AS distance_meters
       FROM events e
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       ${where}
       GROUP BY e.id, u.id
       ORDER BY e.start_time ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    const total = parseInt(countRes.rows[0].count);
    res.json({
      data: result.rows.map(formatEvent),
      pagination: { page: parseInt(page), limit: lim, total, totalPages: Math.ceil(total / lim) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /events/:eventId
router.get('/:eventId', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      `${EVENT_BASE} WHERE e.id = $1 AND e.cancelled = false GROUP BY e.id, u.id`,
      [req.params.eventId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    res.json(formatEvent(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /events/:eventId
router.patch('/:eventId', authenticate, async (req, res, next) => {
  try {
    const eventRes = await db.query('SELECT * FROM events WHERE id = $1 AND cancelled = false', [req.params.eventId]);
    if (!eventRes.rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    if (eventRes.rows[0].host_id !== req.userId) return res.status(403).json({ error: 'FORBIDDEN', message: 'Not the host' });

    const allowed = ['title', 'description', 'start_time', 'end_time', 'capacity', 'hashtags', 'is_private', 'show_attendees'];
    const fieldMap = { title: 'title', description: 'description', startTime: 'start_time', endTime: 'end_time', capacity: 'capacity', hashtags: 'hashtags', isPrivate: 'is_private', showAttendees: 'show_attendees' };

    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, col] of Object.entries(fieldMap)) {
      if (req.body[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    if (fields.length === 0) return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'No fields to update' });

    values.push(req.params.eventId);
    await db.query(`UPDATE events SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    const full = await db.query(
      `${EVENT_BASE} WHERE e.id = $1 GROUP BY e.id, u.id`,
      [req.params.eventId]
    );
    res.json(formatEvent(full.rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:eventId
router.delete('/:eventId', authenticate, async (req, res, next) => {
  try {
    const eventRes = await db.query('SELECT host_id FROM events WHERE id = $1 AND cancelled = false', [req.params.eventId]);
    if (!eventRes.rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    if (eventRes.rows[0].host_id !== req.userId) return res.status(403).json({ error: 'FORBIDDEN', message: 'Not the host' });

    await db.query('UPDATE events SET cancelled = true WHERE id = $1', [req.params.eventId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── RSVPs ────────────────────────────────────────────────────────────────────

// POST /events/:eventId/rsvp
router.post('/:eventId/rsvp', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (status !== 'going' && status !== 'interested') {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'status must be going or interested' });
    }

    const eventRes = await db.query('SELECT * FROM events WHERE id = $1 AND cancelled = false', [req.params.eventId]);
    if (!eventRes.rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    const event = eventRes.rows[0];

    // Capacity check for 'going'
    if (status === 'going') {
      const countRes = await db.query(
        `SELECT COUNT(*) FROM rsvps WHERE event_id = $1 AND status = 'going'`,
        [req.params.eventId]
      );
      if (parseInt(countRes.rows[0].count) >= event.capacity) {
        return res.status(409).json({ error: 'CONFLICT', message: 'Event is at capacity' });
      }
    }

    try {
      const result = await db.query(
        `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, $3) RETURNING *`,
        [req.params.eventId, req.userId, status]
      );
      const r = result.rows[0];
      res.status(201).json({ id: r.id, eventId: r.event_id, userId: r.user_id, status: r.status, createdAt: r.created_at });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'CONFLICT', message: 'Already RSVP\'d to this event' });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// PATCH /events/:eventId/rsvp
router.patch('/:eventId/rsvp', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (status !== 'going' && status !== 'interested') {
      return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'status must be going or interested' });
    }

    const existing = await db.query(
      'SELECT * FROM rsvps WHERE event_id = $1 AND user_id = $2',
      [req.params.eventId, req.userId]
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No existing RSVP to update' });
    }

    // Capacity check when switching to 'going'
    if (status === 'going' && existing.rows[0].status !== 'going') {
      const eventRes = await db.query('SELECT capacity FROM events WHERE id = $1', [req.params.eventId]);
      const countRes = await db.query(
        `SELECT COUNT(*) FROM rsvps WHERE event_id = $1 AND status = 'going'`,
        [req.params.eventId]
      );
      if (parseInt(countRes.rows[0].count) >= eventRes.rows[0].capacity) {
        return res.status(409).json({ error: 'CONFLICT', message: 'Event is at capacity' });
      }
    }

    const result = await db.query(
      `UPDATE rsvps SET status = $1 WHERE event_id = $2 AND user_id = $3 RETURNING *`,
      [status, req.params.eventId, req.userId]
    );
    const r = result.rows[0];
    res.json({ id: r.id, eventId: r.event_id, userId: r.user_id, status: r.status, createdAt: r.created_at });
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:eventId/rsvp
router.delete('/:eventId/rsvp', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      'DELETE FROM rsvps WHERE event_id = $1 AND user_id = $2',
      [req.params.eventId, req.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No existing RSVP' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /events/:eventId/attendees
router.get('/:eventId/attendees', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const eventRes = await db.query('SELECT show_attendees FROM events WHERE id = $1 AND cancelled = false', [req.params.eventId]);
    if (!eventRes.rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    if (!eventRes.rows[0].show_attendees) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Host has disabled attendee list visibility' });
    }

    const conditions = ['r.event_id = $1'];
    const values = [req.params.eventId];
    let idx = 2;

    if (status === 'going' || status === 'interested') {
      conditions.push(`r.status = $${idx++}`);
      values.push(status);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await db.query(`SELECT COUNT(*) FROM rsvps r ${where}`, values);

    values.push(parseInt(limit), offset);
    const result = await db.query(
      `SELECT u.id, u.username, u.profile_picture
       FROM rsvps r
       JOIN users u ON u.id = r.user_id
       ${where}
       ORDER BY r.created_at ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    const total = parseInt(countRes.rows[0].count);
    res.json({
      data: result.rows.map((row) => ({ id: row.id, username: row.username, profilePicture: row.profile_picture })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
