const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const storage = require('../storage');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MIME_TO_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function detectMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      const err = new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
      err.status = 400;
      return cb(err, false);
    }
    cb(null, true);
  },
});

// POST /events/image
router.post('/image', requireAuth, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const detectedMime = detectMime(req.file.buffer);
    if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.' });
    }
    const ext = MIME_TO_EXT[detectedMime];
    const filename = `${uuidv4()}${ext}`;
    const url = await storage.upload('events', filename, req.file.buffer, detectedMime);
    res.json({ url });
  } catch (err) { next(err); }
});

// POST /events
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      title, description, latitude, longitude, address,
      startTime, endTime, capacity, hashtags, isPrivate, showAttendees,
      imageUrl,
    } = req.body;

    if (!title || !latitude || !longitude || !startTime) {
      return res.status(400).json({ error: 'title, latitude, longitude, and startTime are required' });
    }

    const { rows } = await db.query(
      `INSERT INTO events
         (host_id, title, description, location, latitude, longitude, address,
          start_time, end_time, capacity, hashtags, is_private, show_attendees, image_url)
       VALUES
         ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
          $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.user.sub, title, description || null,
        latitude, longitude, address || null,
        startTime, endTime || null, capacity || null,
        hashtags || [], isPrivate || false, showAttendees !== false,
        imageUrl || null,
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
    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const limitNum = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags, e.is_private, e.show_attendees, e.status,
              e.host_id, e.image_url,
              COUNT(r.id) FILTER (WHERE r.status = 'going') AS going_count,
              COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count,
              u.username AS host_username, u.profile_picture AS host_picture,
              (SELECT status FROM rsvps WHERE event_id = e.id AND user_id = $1) AS user_rsvp
       FROM events e
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       WHERE e.host_id IN (SELECT followed_id FROM follows WHERE follower_id = $1)
         AND e.status = 'active'
         AND e.start_time >= now()
       GROUP BY e.id, u.username, u.profile_picture
       ORDER BY e.start_time ASC
       LIMIT $2 OFFSET $3`,
      [req.user.sub, limitNum, offset]
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
              e.start_time, e.end_time, e.capacity, e.hashtags, e.image_url,
              COUNT(r.id) FILTER (WHERE r.status = 'going') AS going_count,
              u.username AS host_username
       FROM events e
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       WHERE e.status = 'active'
         AND e.is_private = false
         AND e.start_time >= now()
         ${geoFilter} ${hashtagFilter}
       GROUP BY e.id, u.username
       HAVING e.capacity IS NULL OR COUNT(r.id) FILTER (WHERE r.status = 'going') < e.capacity
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

    const latNum = lat !== undefined ? parseFloat(lat) : undefined;
    const lngNum = lng !== undefined ? parseFloat(lng) : undefined;
    if ((lat !== undefined || lng !== undefined) && (!Number.isFinite(latNum) || !Number.isFinite(lngNum))) {
      return res.status(400).json({ error: 'lat and lng must be finite numbers' });
    }

    const params = [req.user.sub];
    const conditions = [
      `e.status = 'active'`,
      `e.is_private = false`,
      `e.host_id != $1`,
      // Blocking hides the blocked host's parties from the blocker everywhere.
      `NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = e.host_id)`,
    ];

    if (swLat && swLng && neLat && neLng) {
      const swLatF = parseFloat(swLat), swLngF = parseFloat(swLng);
      const neLatF = parseFloat(neLat), neLngF = parseFloat(neLng);
      if (!Number.isFinite(swLatF) || !Number.isFinite(swLngF) || !Number.isFinite(neLatF) || !Number.isFinite(neLngF)) {
        return res.status(400).json({ error: 'swLat, swLng, neLat, neLng must be finite numbers' });
      }
      params.push(swLngF, swLatF, neLngF, neLatF);
      conditions.push(
        `ST_Within(location::geometry, ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326))`
      );
    } else if (latNum !== undefined && lngNum !== undefined) {
      params.push(lngNum, latNum, radius);
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
      const d = new Date(startAfter);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'startAfter must be a valid ISO 8601 date' });
      }
      params.push(d.toISOString());
      conditions.push(`e.start_time >= $${params.length}`);
    }
    if (startBefore) {
      const d = new Date(startBefore);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'startBefore must be a valid ISO 8601 date' });
      }
      params.push(d.toISOString());
      conditions.push(`e.start_time <= $${params.length}`);
    }
    if (startAfter && startBefore) {
      if (new Date(startBefore) <= new Date(startAfter)) {
        return res.status(400).json({ error: 'startBefore must be after startAfter' });
      }
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;
    params.push(limitNum, offset);
    // Capture these indices now — the relevance sort below pushes more params,
    // which would otherwise shift LIMIT/OFFSET onto the wrong placeholders.
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    // relevance sort when a center point is available, otherwise chronological
    let orderBy;
    if (latNum !== undefined && lngNum !== undefined) {
      params.push(lngNum, latNum);
      const lngIdx = params.length - 1;
      const latIdx = params.length;
      orderBy = `(
        0.6 / (1 + ST_Distance(e.location::geography,
          ST_SetSRID(ST_MakePoint($${lngIdx}, $${latIdx}), 4326)::geography) / 1000.0)
        +
        0.4 / (1 + EXTRACT(EPOCH FROM (e.start_time - now())) / 3600.0)
      ) DESC`;
    } else {
      orderBy = `e.start_time ASC`;
    }

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags, e.show_attendees, e.host_id, e.image_url,
              COUNT(r.id) FILTER (WHERE r.status = 'going') AS going_count,
              COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count,
              u.username AS host_username, u.profile_picture AS host_picture,
              (SELECT status FROM rsvps WHERE event_id = e.id AND user_id = $1) AS user_rsvp
       FROM events e
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY e.id, u.username, u.profile_picture
       ORDER BY ${orderBy}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
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
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags, e.is_private, e.show_attendees, e.status,
              e.host_id, e.image_url,
              COUNT(r.id) FILTER (WHERE r.status = 'going') AS going_count,
              COUNT(r.id) FILTER (WHERE r.status = 'interested') AS interested_count,
              u.username AS host_username, u.profile_picture AS host_picture,
              (SELECT status FROM rsvps WHERE event_id = e.id AND user_id = $2) AS user_rsvp
       FROM events e
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       WHERE e.id = $1
       GROUP BY e.id, u.username, u.profile_picture`,
      [req.params.eventId, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });

    const event = rows[0];
    if (event.is_private && event.host_id !== req.user.sub) {
      const { rows: rsvpRows } = await db.query(
        `SELECT 1 FROM rsvps WHERE event_id = $1 AND user_id = $2 AND status = 'going'`,
        [event.id, req.user.sub]
      );
      if (!rsvpRows.length) return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
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
      imageUrl,
    } = req.body;

    if (startTime !== undefined) {
      const d = new Date(startTime);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'startTime must be a valid ISO 8601 date' });
    }
    if (endTime !== undefined) {
      const d = new Date(endTime);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'endTime must be a valid ISO 8601 date' });
    }

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
         image_url = COALESCE($10, image_url),
         updated_at = now()
       WHERE id = $11
       RETURNING *`,
      [title, description, address, startTime, endTime, capacity, hashtags, isPrivate, showAttendees, imageUrl ?? null, req.params.eventId]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /events/:eventId/report
router.post('/:eventId/report', requireAuth, async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;
    const { rows } = await db.query(
      `SELECT id, host_id FROM events WHERE id = $1`, [req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });

    await db.query(
      `INSERT INTO reports (reporter_id, event_id, reported_user_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [req.user.sub, req.params.eventId, rows[0].host_id, reason]
    );
    res.status(201).json({ ok: true });
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

    // Check event exists
    const eventCheck = await db.query(`SELECT id FROM events WHERE id = $1`, [req.params.eventId]);
    if (!eventCheck.rows.length) return res.status(404).json({ error: 'Event not found' });

    let rows;
    if (status === 'going') {
      // Atomic conditional INSERT: only succeeds when going_count < capacity (or capacity is null)
      ({ rows } = await db.query(
        `WITH capacity_check AS (
           SELECT id, capacity FROM events WHERE id = $1
         ), current_count AS (
           SELECT count(*) AS going_count FROM rsvps WHERE event_id = $1 AND status = 'going' AND user_id != $2
         )
         INSERT INTO rsvps (event_id, user_id, status)
         SELECT $1, $2, $3
         FROM capacity_check, current_count
         WHERE capacity_check.capacity IS NULL OR current_count.going_count < capacity_check.capacity
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3, updated_at = now()
         RETURNING *`,
        [req.params.eventId, req.user.sub, status]
      ));
      if (!rows.length) return res.status(409).json({ error: 'Event is at capacity' });
    } else {
      ({ rows } = await db.query(
        `INSERT INTO rsvps (event_id, user_id, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3, updated_at = now()
         RETURNING *`,
        [req.params.eventId, req.user.sub, status]
      ));
    }
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

    let rows;
    if (status === 'going') {
      // Atomic conditional UPDATE: only succeeds when going_count < capacity (or capacity is null)
      ({ rows } = await db.query(
        `WITH capacity_check AS (
           SELECT capacity FROM events WHERE id = $2
         ), current_count AS (
           SELECT count(*) AS going_count FROM rsvps WHERE event_id = $2 AND status = 'going' AND user_id != $3
         )
         UPDATE rsvps SET status = $1, updated_at = now()
         FROM capacity_check, current_count
         WHERE rsvps.event_id = $2
           AND rsvps.user_id = $3
           AND (capacity_check.capacity IS NULL OR current_count.going_count < capacity_check.capacity)
         RETURNING rsvps.*`,
        [status, req.params.eventId, req.user.sub]
      ));
      if (!rows.length) {
        // Distinguish between not-found and capacity exceeded
        const exists = await db.query(
          `SELECT 1 FROM rsvps WHERE event_id = $1 AND user_id = $2`,
          [req.params.eventId, req.user.sub]
        );
        if (!exists.rows.length) return res.status(404).json({ error: 'RSVP not found' });
        return res.status(409).json({ error: 'Event is at capacity' });
      }
    } else {
      ({ rows } = await db.query(
        `UPDATE rsvps SET status = $1, updated_at = now()
         WHERE event_id = $2 AND user_id = $3
         RETURNING *`,
        [status, req.params.eventId, req.user.sub]
      ));
      if (!rows.length) return res.status(404).json({ error: 'RSVP not found' });
    }
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

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const [{ rows: countRows }, { rows }] = await Promise.all([
      db.query(
        `SELECT count(*) FROM rsvps WHERE event_id = $1`,
        [req.params.eventId]
      ),
      db.query(
        `SELECT u.id, u.username, u.profile_picture, r.status AS rsvp_status
         FROM rsvps r
         JOIN users u ON u.id = r.user_id
         WHERE r.event_id = $1
         ORDER BY r.status DESC, r.created_at ASC
         LIMIT $2 OFFSET $3`,
        [req.params.eventId, limit, offset]
      ),
    ]);

    res.json({ data: rows, total: parseInt(countRows[0].count), limit, offset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
