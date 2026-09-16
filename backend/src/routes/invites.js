// Public, unauthenticated surface for invite links. Mounted at the root, not
// under /api/v1: these URLs are what people paste into group chats, and the
// /.well-known paths are fixed by Apple and Google.
//
//   GET /e/:token                               the invite page (invitePage.js)
//   GET /e-card.png                             preview image for photo-less parties
//   GET /.well-known/apple-app-site-association iOS universal links
//   GET /.well-known/assetlinks.json            Android app links
//
// The page is the only place an event is readable without a login, so the
// query below selects exactly what the page renders and nothing more.

const path = require('path');
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  isToken, inviteUrl, shareOrigin, appleAppSiteAssociation, assetLinks,
} = require('../inviteLinks');
const { renderInvitePage } = require('../invitePage');

const CARD_PATH = path.join(__dirname, '..', 'assets', 'invite-card.png');

// Defaults point at what exists today: the public TestFlight group. Swap
// APP_STORE_URL for the App Store listing once the app is live there, and set
// APP_STORE_ID (6792423931) then too: it drives Safari's "open / get" smart
// banner, which only works for an app that is actually on the store.
// Read per request so a Render env change needs no code change.
const appStoreUrl = () => process.env.APP_STORE_URL || 'https://testflight.apple.com/join/WG6cdp1k';
const appStoreId = () => process.env.APP_STORE_ID || undefined;

// Generous for people, tight enough that walking the token space from one IP
// goes nowhere (and at 2^128 tokens it goes nowhere anyway).
const pageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  handler: (req, res) => res.status(429).type('text/plain').send('slow down'),
});

// No scripts on the page, so none are allowed. Images are the party photo,
// wherever storage put it (https in prod, http MinIO on the devbox).
const PAGE_CSP = [
  "default-src 'none'",
  "img-src 'self' https: http: data:",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

router.get('/e-card.png', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(CARD_PATH);
});

router.get('/e/:token', pageLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;
    let event = null;

    if (isToken(token)) {
      const { rows } = await db.query(
        `SELECT e.title, e.start_time, e.end_time, e.address, e.is_private,
                e.status, e.image_url,
                u.username AS host_username,
                (SELECT count(*) FROM rsvps r
                  WHERE r.event_id = e.id AND r.status = 'going') AS going_count
           FROM events e
           JOIN users u ON u.id = e.host_id
          WHERE e.invite_token = $1`,
        [token]
      );
      event = rows[0] || null;
    }

    const html = renderInvitePage(event, {
      url: inviteUrl(req, token),
      token,
      fallbackImage: `${shareOrigin(req)}/e-card.png`,
      appStoreUrl: appStoreUrl(),
      appStoreId: appStoreId(),
      timeZone: process.env.INVITE_TIMEZONE,
    });

    res
      .status(event ? 200 : 404)
      .set({
        'Content-Security-Policy': PAGE_CSP,
        // Short: a host who changes the photo or time should see previews
        // catch up within minutes, and iMessage re-fetches per send anyway.
        'Cache-Control': 'public, max-age=60',
      })
      .type('html')
      .send(html);
  } catch (err) {
    next(err);
  }
});

function sendWellKnown(body, res) {
  if (!body) return res.status(404).json({ error: 'Not configured' });
  res.set('Cache-Control', 'public, max-age=3600');
  // Apple wants application/json served directly at this path (no redirect).
  res.json(body);
}

router.get('/.well-known/apple-app-site-association', (req, res) =>
  sendWellKnown(appleAppSiteAssociation(), res));

router.get('/.well-known/assetlinks.json', (req, res) =>
  sendWellKnown(assetLinks(), res));

module.exports = router;
