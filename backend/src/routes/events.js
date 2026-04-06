const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

// POST /events
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      title, description, latitude, longitude, address,
      startTime, endTime, capacity, hashtags, isPrivate, showAttendees,
    } = req.body;

    if (!title || !latitude || !longitude || !startTime) {
      return res.status(400).json({ error: 'title, latitude, longitude, and startTime are required' });
    }

    const { rows } = await db.query(
      `INSERT INTO events
         (host_id, title, description, location, latitude, longitude, address,
          start_time, end_time, capacity, hashtags, is_private, show_attendees)
       VALUES
         ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
          $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.user.sub, title, description || null,
        latitude, longitude, address || null,
        startTime, endTime || null, capacity || null,
        hashtags || [], isPrivate || false, showAttendees !== false,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /events/feed
router.get('/feed', requireAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * Math.min(limit, 100);

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags, e.is_private, e.show_attendees, e.status,
              e.host_id,
              (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'going') AS going_count,
              (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'interested') AS interested_count,
              u.username AS host_username, u.profile_picture AS host_picture
       FROM events e
       JOIN users u ON u.id = e.host_id
       WHERE e.host_id IN (SELECT followed_id FROM follows WHERE follower_id = $1)
         AND e.status = 'active'
         AND e.start_time >= now()
       ORDER BY e.start_time ASC
       LIMIT $2 OFFSET $3`,
      [req.user.sub, Math.min(limit, 100), offset]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /events/random
router.get('/random', requireAuth, async (req, res, next) => {
  try {
    const { lat, lng, radius = 5000, hashtags } = req.query;

    let geoFilter = '';
    const params = [];

    if (lat && lng) {
      params.push(lng, lat, radius);
      geoFilter = `AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`;
    }

    let hashtagFilter = '';
    if (hashtags) {
      const tags = hashtags.split(',').map(t => t.trim());
      params.push(tags);
      hashtagFilter = `AND hashtags && $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags,
              (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'going') AS going_count,
              u.username AS host_username
       FROM events e
       JOIN users u ON u.id = e.host_id
       WHERE e.status = 'active'
         AND e.is_private = false
         AND e.start_time >= now()
         AND (e.capacity IS NULL OR (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'going') < e.capacity)
         ${geoFilter} ${hashtagFilter}
       ORDER BY random()
       LIMIT 1`,
      params
    );

    if (!rows.length) return res.status(404).json({ error: 'No events found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /events — discover
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const {
      swLat, swLng, neLat, neLng,
      lat, lng, radius = 5000,
      hashtags, startAfter, startBefore,
      page = 1, limit = 20,
    } = req.query;

    const params = [];
    const conditions = [`e.status = 'active'`, `e.is_private = false`];

    if (swLat && swLng && neLat && neLng) {
      params.push(swLng, swLat, neLng, neLat);
      conditions.push(
        `ST_Within(location::geometry, ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326))`
      );
    } else if (lat && lng) {
      params.push(lng, lat, radius);
      conditions.push(
        `ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($${params.length - 2}, $${params.length - 1}), 4326)::geography, $${params.length})`
      );
    }

    if (hashtags) {
      const tags = hashtags.split(',').map(t => t.trim());
      params.push(tags);
      conditions.push(`e.hashtags && $${params.length}`);
    }

    if (startAfter) {
      params.push(startAfter);
      conditions.push(`e.start_time >= $${params.length}`);
    }
    if (startBefore) {
      params.push(startBefore);
      conditions.push(`e.start_time <= $${params.length}`);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;
    params.push(limitNum, offset);

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags, e.show_attendees, e.host_id,
              (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'going') AS going_count,
              (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'interested') AS interested_count,
              u.username AS host_username, u.profile_picture AS host_picture
       FROM events e
       JOIN users u ON u.id = e.host_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.start_time ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /events/:eventId
router.get('/:eventId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT e.*,
              (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'going') AS going_count,
              (SELECT count(*) FROM rsvps WHERE event_id = e.id AND status = 'interested') AS interested_count,
              u.username AS host_username, u.profile_picture AS host_picture
       FROM events e
       JOIN users u ON u.id = e.host_id
       WHERE e.id = $1`,
      [req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /events/:eventId
router.patch('/:eventId', requireAuth, async (req, res, next) => {
  try {
    const { rows: existing } = await db.query(
      `SELECT host_id FROM events WHERE id = $1`, [req.params.eventId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Event not found' });
    if (existing[0].host_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });

    const {
      title, description, address, startTime, endTime,
      capacity, hashtags, isPrivate, showAttendees,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE events SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         address = COALESCE($3, address),
         start_time = COALESCE($4, start_time),
         end_time = COALESCE($5, end_time),
         capacity = COALESCE($6, capacity),
         hashtags = COALESCE($7, hashtags),
         is_private = COALESCE($8, is_private),
         show_attendees = COALESCE($9, show_attendees),
         updated_at = now()
       WHERE id = $10
       RETURNING *`,
      [title, description, address, startTime, endTime, capacity, hashtags, isPrivate, showAttendees, req.params.eventId]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:eventId
router.delete('/:eventId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT host_id FROM events WHERE id = $1`, [req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    if (rows[0].host_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });

    await db.query(`UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1`, [req.params.eventId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /events/:eventId/rsvp
router.post('/:eventId/rsvp', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['going', 'interested'].includes(status)) {
      return res.status(400).json({ error: 'status must be going or interested' });
    }

    // Enforce capacity for going RSVPs
    if (status === 'going') {
      const { rows } = await db.query(
        `SELECT capacity, (SELECT count(*) FROM rsvps WHERE event_id = $1 AND status = 'going') AS going_count
         FROM events WHERE id = $1`,
        [req.params.eventId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Event not found' });
      const { capacity, going_count } = rows[0];
      if (capacity !== null && parseInt(going_count) >= capacity) {
        return res.status(409).json({ error: 'Event is at capacity' });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO rsvps (event_id, user_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3, updated_at = now()
       RETURNING *`,
      [req.params.eventId, req.user.sub, status]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /events/:eventId/rsvp
router.patch('/:eventId/rsvp', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['going', 'interested'].includes(status)) {
      return res.status(400).json({ error: 'status must be going or interested' });
    }

    if (status === 'going') {
      const { rows } = await db.query(
        `SELECT capacity, (SELECT count(*) FROM rsvps WHERE event_id = $1 AND status = 'going' AND user_id != $2) AS going_count
         FROM events WHERE id = $1`,
        [req.params.eventId, req.user.sub]
      );
      if (rows.length && rows[0].capacity !== null && parseInt(rows[0].going_count) >= rows[0].capacity) {
        return res.status(409).json({ error: 'Event is at capacity' });
      }
    }

    const { rows } = await db.query(
      `UPDATE rsvps SET status = $1, updated_at = now()
       WHERE event_id = $2 AND user_id = $3
       RETURNING *`,
      [status, req.params.eventId, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'RSVP not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:eventId/rsvp
router.delete('/:eventId/rsvp', requireAuth, async (req, res, next) => {
  try {
    await db.query(
      `DELETE FROM rsvps WHERE event_id = $1 AND user_id = $2`,
      [req.params.eventId, req.user.sub]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /events/:eventId/attendees
router.get('/:eventId/attendees', requireAuth, async (req, res, next) => {
  try {
    const { rows: event } = await db.query(
      `SELECT show_attendees, host_id FROM events WHERE id = $1`,
      [req.params.eventId]
    );
    if (!event.length) return res.status(404).json({ error: 'Event not found' });
    if (!event[0].show_attendees && event[0].host_id !== req.user.sub) {
      return res.status(403).json({ error: 'Attendee list is private' });
    }

    const { rows } = await db.query(
      `SELECT u.id, u.username, u.profile_picture, r.status AS rsvp_status
       FROM rsvps r
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $1
       ORDER BY r.status DESC, r.created_at ASC`,
      [req.params.eventId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
