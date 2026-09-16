// Invite links, against a real database.
//
// A link is possession-based access to one party: it must get a stranger into
// a private party (fetch + RSVP), and it must not get them anything else.
const test = require('node:test');
const {
  API, request, truncate, createUser, createEvent, assert, close, db,
} = require('./helpers');

test.beforeEach(truncate);
test.after(close);

const mint = (event, user) =>
  request.post(`${API}/events/${event.id}/invite-link`).set(user.auth);

const tokenOf = (res) => res.body.url.split('/e/')[1];

test('minting returns a stable /e/ link on the API origin', async () => {
  const host = await createUser();
  const event = await createEvent(host.id);

  const first = await mint(event, host);
  assert.equal(first.status, 200);
  assert.match(first.body.url, /^https?:\/\/[^/]+\/e\/[A-Za-z0-9_-]{22}$/);

  const again = await mint(event, host);
  assert.equal(again.body.url, first.body.url, 'one party, one link');
});

test('SHARE_BASE_URL moves links to the custom domain', async () => {
  const host = await createUser();
  const event = await createEvent(host.id);
  process.env.SHARE_BASE_URL = 'https://scene.example/';
  try {
    const res = await mint(event, host);
    assert.match(res.body.url, /^https:\/\/scene\.example\/e\/[A-Za-z0-9_-]{22}$/);
    const page = await request.get(`/e/${res.body.token}`);
    assert.match(page.text, /<meta property="og:image" content="https:\/\/scene\.example\/e-card\.png">/);
  } finally {
    delete process.env.SHARE_BASE_URL;
  }
});

test('anyone who can see a public party can share it', async () => {
  const host = await createUser();
  const guest = await createUser();
  const event = await createEvent(host.id);

  assert.equal((await mint(event, guest)).status, 200);
});

test('only the host can mint a link to a private party', async () => {
  const host = await createUser();
  const follower = await createUser();
  const stranger = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });
  await db.query(`INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)`, [follower.id, host.id]);

  assert.equal((await mint(secret, stranger)).status, 404, 'stranger cannot even confirm it exists');
  assert.equal((await mint(secret, follower)).status, 403, 'follower sees it but cannot invite past the circle');
  assert.equal((await mint(secret, host)).status, 200);
});

test('a cancelled party has no link to hand out', async () => {
  const host = await createUser();
  const event = await createEvent(host.id);
  await db.query(`UPDATE events SET status = 'cancelled' WHERE id = $1`, [event.id]);

  assert.equal((await mint(event, host)).status, 409);
});

test('the token opens a private party for a stranger, and they can RSVP with it', async () => {
  const host = await createUser();
  const stranger = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true, title: 'secret' });
  const token = tokenOf(await mint(secret, host));

  // Without the link: invisible, and RSVP is refused.
  assert.equal((await request.get(`${API}/events/${secret.id}`).set(stranger.auth)).status, 404);
  const blind = await request.post(`${API}/events/${secret.id}/rsvp`).set(stranger.auth).send({ status: 'going' });
  assert.equal(blind.status, 404);

  // With it.
  const opened = await request.get(`${API}/events/invite/${token}`).set(stranger.auth);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.id, secret.id);
  assert.equal(opened.body.title, 'secret');

  const joined = await request.post(`${API}/events/${secret.id}/rsvp`)
    .set(stranger.auth).send({ status: 'going', inviteToken: token });
  assert.equal(joined.status, 201);

  // Going now keeps it visible without the link.
  assert.equal((await request.get(`${API}/events/${secret.id}`).set(stranger.auth)).status, 200);
});

test('a token is not a key to anything else: lists, map and search stay shut', async () => {
  const host = await createUser();
  const stranger = await createUser();
  const shared = await createEvent(host.id, { isPrivate: true, title: 'shared' });
  const other = await createEvent(host.id, { isPrivate: true, title: 'other' });
  const token = tokenOf(await mint(shared, host));

  // The stranger holds the link and has opened it.
  assert.equal((await request.get(`${API}/events/invite/${token}`).set(stranger.auth)).status, 200);

  const wrong = await request.post(`${API}/events/${other.id}/rsvp`)
    .set(stranger.auth).send({ status: 'going', inviteToken: token });
  assert.equal(wrong.status, 404, "one party's token must not RSVP you to another");

  const ids = (res) => (Array.isArray(res.body) ? res.body : res.body.data ?? []).map((e) => e.id);
  const box = 'swLat=40.5&swLng=-74.1&neLat=40.9&neLng=-73.7';
  const surfaces = {
    discover: `${API}/events?${box}`,
    feed: `${API}/events/feed`,
    map: `${API}/map/events?${box}`,
    "host's profile": `${API}/users/${host.id}/hosted-events`,
  };
  for (const [name, url] of Object.entries(surfaces)) {
    const res = await request.get(url).set(stranger.auth);
    assert.ok(res.status < 500, `${name} answered ${res.status}`);
    assert.ok(!ids(res).includes(shared.id), `holding a link must not surface the party on ${name}`);
    assert.ok(!ids(res).includes(other.id), `holding a link must not surface other parties on ${name}`);
  }

  // Search ships dark (SEARCH_ENABLED), so run its hard filter directly: it is
  // the WHERE clause both retrievers share.
  const { buildEventFilters } = require('../search/stages/03-filters');
  const f = buildEventFilters({
    userId: stranger.id, now: new Date(), startAfter: null, startBefore: null,
    center: null, radiusM: 0, hashtags: null,
  });
  const { rows } = await db.query(`SELECT e.id FROM events e WHERE ${f.where}`, f.params);
  assert.deepEqual(rows.map((r) => r.id), [], 'search candidates must not include either party');
});

test('a blocked guest cannot RSVP with a forwarded link', async () => {
  const host = await createUser();
  const blocked = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });
  const token = tokenOf(await mint(secret, host));
  await db.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [host.id, blocked.id]);

  const res = await request.post(`${API}/events/${secret.id}/rsvp`)
    .set(blocked.auth).send({ status: 'going', inviteToken: token });
  assert.equal(res.status, 404);
});

test("a private party's public page never shows the address", async () => {
  const host = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true, title: 'basement' });
  await db.query(`UPDATE events SET address = '99 Secret Street' WHERE id = $1`, [secret.id]);
  const token = tokenOf(await mint(secret, host));

  const page = await request.get(`/e/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /basement/);
  assert.ok(!page.text.includes('Secret Street'));
});

test('unknown, malformed and blocked lookups all answer 404', async () => {
  const host = await createUser();
  const blockedGuest = await createUser();
  const event = await createEvent(host.id);
  const token = tokenOf(await mint(event, host));
  await db.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [host.id, blockedGuest.id]);

  assert.equal((await request.get(`${API}/events/invite/${'x'.repeat(22)}`).set(host.auth)).status, 404);
  assert.equal((await request.get(`${API}/events/invite/not!a!token`).set(host.auth)).status, 404);
  assert.equal((await request.get(`${API}/events/invite/${token}`).set(blockedGuest.auth)).status, 404);
  assert.equal((await request.get(`${API}/events/invite/${token}`)).status, 401, 'the API side needs a login');
});

test('GET /e/:token serves the preview page without a login', async () => {
  const host = await createUser({ username: 'hostperson' });
  const event = await createEvent(host.id, { title: 'warehouse night' });
  const token = tokenOf(await mint(event, host));

  const page = await request.get(`/e/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.text, /<meta property="og:title" content="warehouse night">/);
  assert.match(page.text, /@hostperson/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);

  const dead = await request.get(`/e/${'y'.repeat(22)}`);
  assert.equal(dead.status, 404);
  assert.match(dead.text, /this link is dead/);

  const card = await request.get('/e-card.png');
  assert.equal(card.status, 200);
  assert.match(card.headers['content-type'], /image\/png/);
});

test('the /.well-known files are 404 until configured, then name the app', async () => {
  delete process.env.APPLE_TEAM_ID;
  assert.equal((await request.get('/.well-known/apple-app-site-association')).status, 404);

  process.env.APPLE_TEAM_ID = 'ABCDE12345';
  process.env.ANDROID_CERT_SHA256 = 'AA:BB';
  try {
    const aasa = await request.get('/.well-known/apple-app-site-association');
    assert.equal(aasa.status, 200);
    assert.match(aasa.headers['content-type'], /application\/json/);
    assert.deepEqual(aasa.body.applinks.details[0].appIDs, ['ABCDE12345.com.wilsonnarea.scene']);
    assert.equal(aasa.body.applinks.details[0].components[0]['/'], '/e/*');

    const android = await request.get('/.well-known/assetlinks.json');
    assert.equal(android.status, 200);
    assert.deepEqual(android.body[0].target.sha256_cert_fingerprints, ['AA:BB']);
  } finally {
    delete process.env.APPLE_TEAM_ID;
    delete process.env.ANDROID_CERT_SHA256;
  }
});
