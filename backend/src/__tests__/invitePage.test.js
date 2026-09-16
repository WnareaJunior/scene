// The invite page is a pure function, so it's tested without a database: the
// link-preview tags, what a private party's card leaks, and escaping.
const test = require('node:test');
const assert = require('node:assert');
const { renderInvitePage, formatWhen } = require('../invitePage');

const opts = {
  url: 'https://api.example/e/tok_abcdefghijklmnop',
  token: 'tok_abcdefghijklmnop',
  fallbackImage: 'https://api.example/e-card.png',
  appStoreUrl: 'https://testflight.apple.com/join/x',
  appStoreId: '123',
  timeZone: 'America/New_York',
  now: Date.parse('2026-09-01T00:00:00Z'),
};

const party = {
  title: 'rooftop thing',
  start_time: '2026-09-19T02:00:00Z', // fri 10pm in new york
  end_time: null,
  address: '123 Wyckoff Ave',
  is_private: false,
  status: 'active',
  image_url: 'https://cdn.example/p.jpg',
  host_username: 'dj',
  going_count: '12',
};

const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`));
  return m && m[1];
};

test('formats times in the party\'s city, not the server\'s UTC', () => {
  assert.equal(formatWhen('2026-09-19T02:00:00Z', 'America/New_York'), 'fri, sep 18 · 10pm');
  assert.equal(formatWhen('2026-09-19T02:30:00Z', 'America/New_York'), 'fri, sep 18 · 10:30pm');
});

test('a public party previews as a photo card with time, place, host and count', () => {
  const html = renderInvitePage(party, opts);
  assert.equal(meta(html, 'og:title'), 'rooftop thing');
  assert.equal(meta(html, 'og:image'), 'https://cdn.example/p.jpg');
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
  assert.equal(
    meta(html, 'og:description'),
    'fri, sep 18 · 10pm · 123 Wyckoff Ave · hosted by @dj · 12 going'
  );
  assert.ok(html.includes('href="scene://e/tok_abcdefghijklmnop"'), 'open-in-app button');
  assert.ok(html.includes('app-argument=https://api.example/e/tok_abcdefghijklmnop'), 'smart banner');
});

test('a private party\'s preview never carries the address', () => {
  const html = renderInvitePage({ ...party, is_private: true }, opts);
  assert.ok(!html.includes('Wyckoff'), 'address must not appear anywhere on the page');
  assert.match(meta(html, 'og:description'), /private party/);
});

test('no photo falls back to the branded card with a small preview', () => {
  const html = renderInvitePage({ ...party, image_url: null }, opts);
  assert.equal(meta(html, 'og:image'), 'https://api.example/e-card.png');
  assert.equal(meta(html, 'twitter:card'), 'summary');
});

test('a dead token renders the not-found page, still with a preview', () => {
  const html = renderInvitePage(null, opts);
  assert.equal(meta(html, 'og:title'), 'this link is dead');
  assert.ok(!html.includes('scene://'), 'nothing to open');
});

test('cancelled and finished parties say so', () => {
  assert.match(renderInvitePage({ ...party, status: 'cancelled' }, opts), /called off/);
  assert.match(
    renderInvitePage(party, { ...opts, now: Date.parse('2026-09-20T00:00:00Z') }),
    /this one&#39;s over/
  );
});

test('host-written text is escaped everywhere it lands', () => {
  const html = renderInvitePage(
    { ...party, title: '"><script>alert(1)</script>', host_username: 'a&b' },
    opts
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  assert.ok(html.includes('@a&amp;b'));
});

test('an http photo (devbox MinIO) is not handed to iMessage; the https card is', () => {
  const html = renderInvitePage({ ...party, image_url: 'http://100.64.0.1:9000/scene/p.jpg' }, opts);
  assert.equal(meta(html, 'og:image'), 'https://api.example/e-card.png');
  assert.equal(meta(html, 'og:image:width'), '1024');
  assert.ok(html.includes('class="hero" src="http://100.64.0.1:9000/scene/p.jpg"'), 'the page itself still shows it');
});

test('no smart banner unless an App Store id is configured', () => {
  const html = renderInvitePage(party, { ...opts, appStoreId: undefined });
  assert.ok(!html.includes('apple-itunes-app'));
});

test('the install path tells people to tap the link again', () => {
  assert.match(renderInvitePage(party, opts), /tap the link again/);
});

test('SHARE_BASE_URL must be a bare https origin', () => {
  const { shareBaseUrlProblem } = require('../inviteLinks');
  assert.equal(shareBaseUrlProblem(undefined), null);
  assert.equal(shareBaseUrlProblem('https://scene.party'), null);
  assert.equal(shareBaseUrlProblem('https://scene.party/'), null);
  assert.match(shareBaseUrlProblem('http://scene.party'), /https/);
  assert.match(shareBaseUrlProblem('https://scene.party/links'), /origin only/);
  assert.match(shareBaseUrlProblem('scene.party'), /not a URL|https/);
});
