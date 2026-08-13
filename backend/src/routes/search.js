const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const { search } = require('../search');
const { logTap } = require('../search/stages/08-log');
const { MAX_QUERY_LENGTH, MAX_RADIUS_M } = require('../search/config');

// GET /search?q=&lat=&lng=&radius=&limit=&offset=&tzOffset=&tz=
//
// The unified search endpoint. GET /events and GET /users/search are unchanged
// and still serve the existing client; this runs alongside them so the app can
// migrate behind a flag and the two can be compared on the same traffic.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '');
    if (!q.trim()) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    if (q.length > MAX_QUERY_LENGTH * 4) {
      // Hard reject well before the sanitizer's truncation point. Anything this
      // long isn't a search, and it shouldn't reach the normalizer at all.
      return res.status(400).json({ error: 'Query is too long' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Viewport is optional — search works without location, it just can't apply
    // a geo filter or the distance-decay signal.
    let viewport = null;
    if (req.query.lat !== undefined || req.query.lng !== undefined) {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'lat and lng must be finite numbers' });
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'lat and lng must be valid coordinates' });
      }
      const radius = parseInt(req.query.radius);
      viewport = {
        lat,
        lng,
        radiusM: Number.isFinite(radius) ? Math.min(Math.max(radius, 0), MAX_RADIUS_M) : undefined,
      };
    }

    // The client sends its own UTC offset so "tonight" resolves in the user's
    // day, not the server's. Render runs in UTC; without this every evening
    // query after 19:00 EST would resolve to tomorrow.
    const tzOffset = parseInt(req.query.tzOffset);
    const utcOffsetMinutes =
      Number.isFinite(tzOffset) && Math.abs(tzOffset) <= 840 ? tzOffset : 0;

    const result = await search({
      query: q,
      userId: req.user.sub,
      db,
      viewport,
      limit,
      offset,
      utcOffsetMinutes,
      timezone: String(req.query.tz || 'UTC').slice(0, 64),
    });

    if (result.meta.rejected) {
      // 200, not 4xx. A blocked query is a valid request with an empty result —
      // the client renders "no results", and a 4xx would surface as an error
      // toast telling the user their search broke.
      return res.json({ events: [], users: [], meta: result.meta });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /search/:searchId/tap
//
// Click attribution for stage 8. Fire-and-forget from the client's perspective:
// it must never block navigation into the event detail sheet.
router.post('/:searchId/tap', requireAuth, async (req, res, next) => {
  try {
    const { resultId, resultType, position } = req.body || {};

    if (!resultId) return res.status(400).json({ error: 'resultId is required' });
    if (!['event', 'user'].includes(resultType)) {
      return res.status(400).json({ error: 'resultType must be event or user' });
    }
    const pos = parseInt(position);
    if (!Number.isFinite(pos) || pos < 1) {
      return res.status(400).json({ error: 'position must be a positive integer' });
    }

    const ok = await logTap(db, {
      searchId: req.params.searchId,
      userId: req.user.sub,
      resultId,
      resultType,
      position: pos,
    });

    // 404 rather than 403 on a mismatch: the WHERE clause scopes to the caller's
    // own rows, so "not yours" and "doesn't exist" are indistinguishable here and
    // should stay that way.
    if (!ok) return res.status(404).json({ error: 'Search not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
