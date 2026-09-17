// Shareable party links: https://<share host>/e/<token>.
//
// Domain day (moving links to a custom domain) is config, not code: see
// backend/README.md → "Invite links: domain day".
//
// One URL does three jobs depending on who opens it:
//   - iMessage / WhatsApp / Slack fetch it for a preview card → the Open Graph
//     tags in invitePage.js (photo, title, when).
//   - a phone with Scene installed → iOS/Android hand the URL straight to the
//     app (universal links / app links, declared by the two /.well-known files
//     below), which opens the party's sheet.
//   - a phone without it → the same HTML page, with "get scene" on it.
//
// The token is possession-based access to ONE event. It is checked on the
// single-event fetch and on RSVP, and nowhere else — see eventVisibility.js
// for why it stays out of the list predicate.

const crypto = require('crypto');
const db = require('./db');

// 16 random bytes → 22 url-safe characters. Unguessable, and short enough that
// the link doesn't dominate a text message.
function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

// Anything else is rejected before it reaches the database.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const isToken = (s) => typeof s === 'string' && TOKEN_RE.test(s);

/**
 * The event's token, minting one on first share. A single UPDATE, so two
 * people sharing the same party at once still converge on one token.
 */
async function ensureToken(eventId) {
  const { rows } = await db.query(
    `UPDATE events SET invite_token = COALESCE(invite_token, $2)
      WHERE id = $1
      RETURNING invite_token`,
    [eventId, newToken()]
  );
  return rows[0]?.invite_token ?? null;
}

/**
 * Origin the links are built on. SHARE_BASE_URL wins when set — that is the
 * one switch for a custom domain. It must name the same host the app was built
 * to open (frontend/app.config.js, EXPO_PUBLIC_SHARE_HOST), or links still
 * work as web pages but never jump into the app. The app warns when the two
 * disagree (src/inviteLink.js); checkShareBaseUrl() below catches a malformed
 * value at boot.
 *
 * Unset: the API's own origin. `trust proxy` makes req.protocol https on
 * Render, which is what iMessage needs for og:image.
 */
function shareOrigin(req) {
  const configured = (process.env.SHARE_BASE_URL || '').replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

/**
 * Why SHARE_BASE_URL is unusable, or null when it is fine (or unset). It must
 * be a bare https origin: universal links, app links and iMessage previews all
 * refuse plain http, and a path would break /e/<token> and /.well-known.
 */
function shareBaseUrlProblem(value = process.env.SHARE_BASE_URL) {
  if (!value) return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return `SHARE_BASE_URL="${value}" is not a URL`;
  }
  if (u.protocol !== 'https:') return `SHARE_BASE_URL="${value}" must be https`;
  if (u.pathname.replace(/\/+$/, '') || u.search || u.hash) {
    return `SHARE_BASE_URL="${value}" must be an origin only, like https://scene.party`;
  }
  return null;
}

/**
 * Boot check, called from app.js. In production a bad value stops the deploy
 * (Render keeps the old instance serving); elsewhere it only warns.
 */
function checkShareBaseUrl(log = console) {
  const problem = shareBaseUrlProblem();
  if (problem && process.env.NODE_ENV === 'production') throw new Error(problem);
  if (problem) log.warn(`[invite links] ${problem}; links will not work as intended`);
  else if (process.env.SHARE_BASE_URL) {
    log.info(
      `[invite links] links go out on ${process.env.SHARE_BASE_URL}; the app build must have ` +
        `EXPO_PUBLIC_SHARE_HOST=${new URL(process.env.SHARE_BASE_URL).hostname}`
    );
  }
  return problem;
}

function inviteUrl(req, token) {
  return `${shareOrigin(req)}/e/${token}`;
}

const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.wilsonnarea.scene';
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'com.wilsonnarea.scene';

/**
 * apple-app-site-association body, or null when APPLE_TEAM_ID is unset.
 * Without the team ID there is nothing valid to publish, and a wrong file is
 * worse than none: iOS caches it per install. Links still work without it —
 * they just land on the web page instead of jumping into the app.
 */
function appleAppSiteAssociation() {
  const team = process.env.APPLE_TEAM_ID;
  if (!team) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${IOS_BUNDLE_ID}`],
          components: [{ '/': '/e/*', comment: 'party invite links' }],
        },
      ],
    },
  };
}

/**
 * Digital Asset Links body for Android app-link verification, or null when
 * ANDROID_CERT_SHA256 (comma-separated signing-cert fingerprints) is unset.
 */
function assetLinks() {
  const prints = (process.env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!prints.length) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: prints,
      },
    },
  ];
}

module.exports = {
  newToken,
  isToken,
  ensureToken,
  shareOrigin,
  shareBaseUrlProblem,
  checkShareBaseUrl,
  inviteUrl,
  appleAppSiteAssociation,
  assetLinks,
};
