const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const storage = require('../storage');
const { eventVisibilitySql, canSeeEvent } = require('../eventVisibility');
const { isToken, ensureToken, inviteUrl } = require('../inviteLinks');

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

    // Pushed last on purpose: geoFilter above hardcodes $1..$3, so the viewer
    // has to take whatever index is left rather than shifting those.
    params.push(req.user.sub);
    const visibility = eventVisibilitySql(`$${params.length}`);

    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.latitude, e.longitude, e.address,
              e.start_time, e.end_time, e.capacity, e.hashtags, e.image_url,
              COUNT(r.id) FILTER (WHERE r.status = 'going') AS going_count,
              u.username AS host_username
       FROM events e
       JOIN users u ON u.id = e.host_id
       LEFT JOIN rsvps r ON r.event_id = e.id
       WHERE e.status = 'active'
         AND ${visibility}
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
      eventVisibilitySql('$1'),
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

// The full event the detail sheet renders, looked up by id or by invite token.
// `column` is one of the two literals below, never caller input.
async function loadEventDetail(column, value, viewerId) {
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
     WHERE ${column === 'invite_token' ? 'e.invite_token' : 'e.id'} = $1
     GROUP BY e.id, u.username, u.profile_picture`,
    [value, viewerId]
  );
  return rows[0] || null;
}

// GET /events/invite/:token — the event behind an invite link.
//
// Holding the token is the access check: this is how a private party reaches
// someone who doesn't follow the host. It unlocks this one event and nothing
// else (see eventVisibility.js). Registered before /:eventId so "invite" is
// never read as an id. A host who has blocked the viewer still wins — the link
// answers 404 for them, the same as a dead token.
router.get('/invite/:token', requireAuth, async (req, res, next) => {
  try {
    if (!isToken(req.params.token)) return res.status(404).json({ error: 'Event not found' });

    const event = await loadEventDetail('invite_token', req.params.token, req.user.sub);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { rows: blocked } = await db.query(
      `SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [event.host_id, req.user.sub]
    );
    if (blocked.length) return res.status(404).json({ error: 'Event not found' });

    res.json(event);
  } catch (err) {
    next(err);
  }
});

// GET /events/:eventId
router.get('/:eventId', requireAuth, async (req, res, next) => {
  try {
    const event = await loadEventDetail('id', req.params.eventId, req.user.sub);
    if (!(await canSeeEvent(event, req.user.sub))) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (err) {
    next(err);
  }
});

// POST /events/:eventId/invite-link — the shareable URL for a party.
//
// Anyone who can see a public party can share it; the link grants nothing the
// map doesn't. A private party's link is an invitation past the host's circle,
// so only the host can hand one out — otherwise any follower could forward it
// to anyone.
router.post('/:eventId/invite-link', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, host_id, is_private, status FROM events WHERE id = $1`,
      [req.params.eventId]
    );
    const event = rows[0];
    if (!(await canSeeEvent(event, req.user.sub))) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (event.is_private && event.host_id !== req.user.sub) {
      return res.status(403).json({ error: 'Only the host can invite people to a private party' });
    }
    if (event.status !== 'active') {
      return res.status(409).json({ error: 'This party was called off' });
    }

    const token = await ensureToken(event.id);
    res.json({ url: inviteUrl(req, token), token });
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

    // You can RSVP to what you can see, or to what you were sent a link to.
    // The invite token is how a stranger joins a private party; once they
    // have, their RSVP keeps it visible to them without the link.
    const { rows: found } = await db.query(
      `SELECT id, host_id, is_private, invite_token FROM events WHERE id = $1`,
      [req.params.eventId]
    );
    const target = found[0];
    const invited = target?.invite_token != null && req.body.inviteToken === target.invite_token;
    if (!invited && !(await canSeeEvent(target, req.user.sub))) {
      return res.status(404).json({ error: 'Event not found' });
    }
    // A forwarded link must not get someone the host blocked through the door;
    // GET /events/invite/:token answers them 404 too.
    if (invited && target.host_id !== req.user.sub) {
      const { rows: blocked } = await db.query(
        `SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
        [target.host_id, req.user.sub]
      );
      if (blocked.length) return res.status(404).json({ error: 'Event not found' });
    }

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

// Comment visibility mirrors GET /events/:eventId exactly: a private event is
// readable by its host or by someone already going, and invisible otherwise.
// Returns the event row when the caller may see it, or null when they may not,
// so callers answer 404 rather than confirming a private event exists.
async function visibleEvent(eventId, userId) {
  const { rows } = await db.query(
    `SELECT id, host_id, is_private FROM events WHERE id = $1`,
    [eventId]
  );
  if (!rows.length) return null;
  return (await canSeeEvent(rows[0], userId)) ? rows[0] : null;
}

// GET /events/:eventId/comments — oldest first; a thread reads forward.
router.get('/:eventId/comments', requireAuth, async (req, res, next) => {
  try {
    const event = await visibleEvent(req.params.eventId, req.user.sub);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const [{ rows: countRows }, { rows }] = await Promise.all([
      db.query(`SELECT count(*) FROM event_comments WHERE event_id = $1`, [req.params.eventId]),
      // Paged newest-first so offset walks backwards through history: the first
      // page is the end of the conversation, which is the part that matters.
      // Reversed before responding so the payload still reads chronologically.
      db.query(
        `SELECT c.id, c.body, c.created_at,
                u.id AS user_id, u.username, u.profile_picture,
                (c.user_id = $4) AS is_mine,
                (c.user_id = $5) AS is_host
         FROM event_comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.event_id = $1
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT $2 OFFSET $3`,
        [req.params.eventId, limit, offset, req.user.sub, event.host_id]
      ),
    ]);

    res.json({ data: rows.reverse(), total: parseInt(countRows[0].count), limit, offset });
  } catch (err) {
    next(err);
  }
});

// POST /events/:eventId/comments — RSVP required, host exempt.
router.post('/:eventId/comments', requireAuth, async (req, res, next) => {
  try {
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'body is required' });
    if (body.length > 500) return res.status(400).json({ error: 'body must be 500 characters or fewer' });

    const event = await visibleEvent(req.params.eventId, req.user.sub);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // The host can always speak on their own party; everyone else has to have
    // said they are coming first. Interested counts — the point is to keep out
    // people with no stake in the party, not to gate on a hard commitment.
    if (event.host_id !== req.user.sub) {
      const { rows: rsvpRows } = await db.query(
        `SELECT 1 FROM rsvps WHERE event_id = $1 AND user_id = $2`,
        [req.params.eventId, req.user.sub]
      );
      if (!rsvpRows.length) {
        return res.status(403).json({ error: 'RSVP before you comment' });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO event_comments (event_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at`,
      [req.params.eventId, req.user.sub, body]
    );

    const { rows: me } = await db.query(
      `SELECT id AS user_id, username, profile_picture FROM users WHERE id = $1`,
      [req.user.sub]
    );

    res.status(201).json({
      ...rows[0],
      ...me[0],
      is_mine: true,
      is_host: event.host_id === req.user.sub,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:eventId/comments/:commentId — author, or the host moderating.
router.delete('/:eventId/comments/:commentId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.user_id, e.host_id
       FROM event_comments c
       JOIN events e ON e.id = c.event_id
       WHERE c.id = $1 AND c.event_id = $2`,
      [req.params.commentId, req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Comment not found' });

    const { user_id, host_id } = rows[0];
    if (user_id !== req.user.sub && host_id !== req.user.sub) {
      return res.status(403).json({ error: 'Not your comment' });
    }

    await db.query(`DELETE FROM event_comments WHERE id = $1`, [req.params.commentId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
