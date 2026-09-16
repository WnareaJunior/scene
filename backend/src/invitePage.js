// The HTML behind an invite link. Two readers:
//
//   1. Link-preview crawlers (iMessage, WhatsApp, Slack, Discord). They read
//      only the <head>: og:title / og:description / og:image become the card.
//      iMessage wants a large image, so the party photo goes in og:image and
//      the card turns into a flyer.
//   2. A person on a phone without the app (with the app, the OS never loads
//      this page — it hands the URL to Scene). They get the flyer, an
//      "open in scene" button (custom scheme, for when universal links are not
//      set up yet or were bypassed) and a "get scene" button.
//
// Pure function of its inputs: no database, no request. No JavaScript on the
// page either, so the route can ship a CSP with no script-src at all.
//
// What a preview reveals is deliberate. A link gets forwarded past the person
// it was sent to, so a private party's card shows its name, time and photo —
// what the host chose to send — but never the address. Public parties show the
// address, as the map already does.

const COLORS = {
  accent: '#22d3ee',
  accentInk: '#001418',
  asphalt: '#0a0a0a',
  card: '#1a1a1a',
  border: '#484848',
  ink: '#ffffff',
  inkSecondary: '#8e8e93',
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

// Parties have no timezone column, and the server runs in UTC. Scene is live in
// New York, so that is the default; INVITE_TIMEZONE overrides it.
function formatWhen(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit',
  }).format(d)
    .replace(':00', '')
    .replace(/\s/g, '');
  return `${day} · ${time}`.toLowerCase();
}

function describe(event, timeZone) {
  const parts = [formatWhen(event.start_time, timeZone)];
  if (event.is_private) parts.push('private party');
  else if (event.address) parts.push(event.address);
  if (event.host_username) parts.push(`hosted by @${event.host_username}`);
  const going = Number(event.going_count ?? 0);
  if (going > 0) parts.push(`${going} going`);
  return parts.filter(Boolean).join(' · ');
}

function status(event, now) {
  if (event.status === 'cancelled') return 'this one got called off.';
  const end = event.end_time
    ? new Date(event.end_time).getTime()
    : new Date(event.start_time).getTime() + 4 * 3600e3;
  if (end < now) return "this one's over.";
  return null;
}

/**
 * @param {object|null} event  row with title, start_time, end_time, address,
 *   is_private, status, image_url, host_username, going_count — or null when
 *   the token matched nothing
 * @param {object} o
 * @param {string} o.url            canonical link (https://…/e/<token>)
 * @param {string} o.token
 * @param {string} o.fallbackImage  absolute URL of the branded card image
 * @param {string} o.appStoreUrl    where "get scene" goes
 * @param {string} [o.appStoreId]   App Store id for Safari's smart banner
 * @param {string} [o.timeZone]
 * @param {number} [o.now]
 */
function renderInvitePage(event, o) {
  const timeZone = o.timeZone || 'America/New_York';
  const now = o.now ?? Date.now();
  const openInApp = `scene://e/${o.token}`;

  const title = event ? event.title : 'this link is dead';
  const description = event
    ? describe(event, timeZone)
    : "the party behind it isn't around anymore. find another one on scene.";
  // iMessage (and most crawlers) only render an absolute https og:image. A
  // photo that isn't one (the devbox's http MinIO) falls back to the card.
  const photo = event && /^https:\/\//i.test(event.image_url || '') ? event.image_url : null;
  const image = photo || o.fallbackImage;
  const note = event ? status(event, now) : null;

  // summary_large_image only when there is a real photo; the square app icon
  // looks wrong stretched across a wide card.
  const twitterCard = photo ? 'summary_large_image' : 'summary';

  // The fallback card's size is known (src/assets/invite-card.png, 1024²);
  // declaring it lets crawlers lay the card out without fetching it first.
  // A host's photo has whatever size it was uploaded at, so none is claimed.
  const imageSize = photo
    ? ''
    : `<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1024">
`;

  const banner = o.appStoreId
    ? `<meta name="apple-itunes-app" content="app-id=${esc(o.appStoreId)}, app-argument=${esc(o.url)}">`
    : '';

  const hero = event && event.image_url
    ? `<img class="hero" src="${esc(event.image_url)}" alt="">`
    : '';

  const body = event
    ? `${hero}
    <main>
      <p class="kicker">you're invited${event.is_private ? ' · private' : ''}</p>
      <h1>${esc(event.title)}</h1>
      <p class="meta">${esc(describe(event, timeZone))}</p>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
      <a class="btn primary" href="${esc(openInApp)}">open in scene</a>
      <a class="btn" href="${esc(o.appStoreUrl)}">don't have it? get scene</a>
      <p class="fine">installed it? come back and tap the link again. it opens right on this party.</p>
    </main>`
    : `<main>
      <p class="kicker">scene</p>
      <h1>${esc(title)}</h1>
      <p class="meta">${esc(description)}</p>
      <a class="btn primary" href="${esc(o.appStoreUrl)}">get scene</a>
    </main>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · scene</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(o.url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="scene">
<meta property="og:url" content="${esc(o.url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
${imageSize}<meta property="og:image:alt" content="${esc(event ? `${title} flyer` : 'scene')}">
<meta name="twitter:card" content="${twitterCard}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="${COLORS.asphalt}">
${banner}
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: ${COLORS.asphalt}; color: ${COLORS.ink}; }
  body { font: 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .hero { display: block; width: 100%; max-height: 56vh; object-fit: cover; }
  main { max-width: 480px; margin: 0 auto; padding: 24px 16px 40px; }
  .kicker { margin: 0 0 8px; color: ${COLORS.accent}; font-size: 13px; font-weight: 700; letter-spacing: .04em; }
  h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.1; overflow-wrap: anywhere; }
  .meta { margin: 0 0 24px; color: ${COLORS.inkSecondary}; }
  .note { margin: -12px 0 24px; color: ${COLORS.ink}; font-weight: 600; }
  .btn { display: flex; align-items: center; justify-content: center; min-height: 50px;
         margin-bottom: 10px; padding: 0 18px; text-decoration: none; font-weight: 700;
         color: ${COLORS.ink}; background: ${COLORS.card}; border: 1px solid ${COLORS.border}; }
  .btn.primary { color: ${COLORS.accentInk}; background: ${COLORS.accent}; border-color: ${COLORS.accent}; }
  .fine { margin: 14px 0 0; color: ${COLORS.inkSecondary}; font-size: 13px; text-align: center; }
</style>
</head>
<body>
    ${body}
</body>
</html>
`;
}

module.exports = { renderInvitePage, formatWhen };
