// Private-event visibility, against a real database.
//
// A private event is visible to its host, to anyone following the host, and to
// anyone already RSVP'd. The rule lives in src/eventVisibility.js and is
// applied by five separate queries; these tests exist because five call sites
// is five chances for one of them to drift and leak a private party.
const test = require('node:test');
const {
  API, request, truncate, createUser, createEvent, assert, close, db,
} = require('./helpers');

test.beforeEach(truncate);
test.after(close);

const follow = (follower, followed) =>
  db.query(`INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)`, [follower.id, followed.id]);

const ids = (res) => (Array.isArray(res.body) ? res.body : res.body.data ?? []).map((e) => e.id);

test('a follower sees a private event on discover; a stranger does not', async () => {
  const host = await createUser();
  const follower = await createUser();
  const stranger = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true, title: 'secret' });

  await follow(follower, host);

  const seen = await request.get(`${API}/events`).set(follower.auth);
  assert.equal(seen.status, 200);
  assert.ok(ids(seen).includes(secret.id), 'follower should see the private event');

  const hidden = await request.get(`${API}/events`).set(stranger.auth);
  assert.ok(!ids(hidden).includes(secret.id), 'stranger must not see the private event');
});

test('a follower sees a private event among map pins; a stranger does not', async () => {
  const host = await createUser();
  const follower = await createUser();
  const stranger = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });

  await follow(follower, host);

  const box = 'swLat=40.5&swLng=-74.1&neLat=40.9&neLng=-73.7';
  const seen = await request.get(`${API}/map/events?${box}`).set(follower.auth);
  assert.equal(seen.status, 200);
  assert.ok(ids(seen).includes(secret.id), 'follower should see the pin');

  const hidden = await request.get(`${API}/map/events?${box}`).set(stranger.auth);
  assert.ok(!ids(hidden).includes(secret.id), 'stranger must not see the pin');
});

test('GET /events/:id admits host, follower and going attendee, and nobody else', async () => {
  const host = await createUser();
  const follower = await createUser();
  const attendee = await createUser();
  const stranger = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });

  await follow(follower, host);
  await db.query(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`,
    [secret.id, attendee.id]
  );

  const get = (u) => request.get(`${API}/events/${secret.id}`).set(u.auth);
  assert.equal((await get(host)).status, 200);
  assert.equal((await get(follower)).status, 200);
  assert.equal((await get(attendee)).status, 200);
  assert.equal((await get(stranger)).status, 404);
});

test('an interested RSVP keeps access to a private event', async () => {
  const host = await createUser();
  const maybe = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });

  await db.query(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'interested')`,
    [secret.id, maybe.id]
  );
  assert.equal((await request.get(`${API}/events/${secret.id}`).set(maybe.auth)).status, 200);
});

test('a profile lists its private events to a follower but not to a stranger', async () => {
  const host = await createUser();
  const follower = await createUser();
  const stranger = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });
  const open = await createEvent(host.id, { isPrivate: false });

  await follow(follower, host);

  const seen = await request.get(`${API}/users/${host.id}/hosted-events`).set(follower.auth);
  assert.equal(seen.status, 200);
  assert.ok(ids(seen).includes(secret.id));
  assert.ok(ids(seen).includes(open.id));

  const hidden = await request.get(`${API}/users/${host.id}/hosted-events`).set(stranger.auth);
  assert.ok(!ids(hidden).includes(secret.id), 'stranger must not see the private event');
  assert.ok(ids(hidden).includes(open.id), 'the public one is still listed');
});

test('following is directional: the host following you does not expose your view', async () => {
  const host = await createUser();
  const other = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });

  // host follows other -- the wrong direction
  await follow(host, other);

  assert.equal((await request.get(`${API}/events/${secret.id}`).set(other.auth)).status, 404);
});

test('unfollowing takes private access away again', async () => {
  const host = await createUser();
  const follower = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });

  await follow(follower, host);
  assert.equal((await request.get(`${API}/events/${secret.id}`).set(follower.auth)).status, 200);

  await db.query(
    `DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2`,
    [follower.id, host.id]
  );
  assert.equal((await request.get(`${API}/events/${secret.id}`).set(follower.auth)).status, 404);
});

test('a follower can read and post comments on a private event', async () => {
  const host = await createUser();
  const follower = await createUser();
  const secret = await createEvent(host.id, { isPrivate: true });
  await follow(follower, host);

  assert.equal((await request.get(`${API}/events/${secret.id}/comments`).set(follower.auth)).status, 200);

  // Visibility gets them in; the RSVP gate still governs posting.
  const refused = await request.post(`${API}/events/${secret.id}/comments`).set(follower.auth).send({ body: 'hi' });
  assert.equal(refused.status, 403);

  await request.post(`${API}/events/${secret.id}/rsvp`).set(follower.auth).send({ status: 'going' });
  const ok = await request.post(`${API}/events/${secret.id}/comments`).set(follower.auth).send({ body: 'hi' });
  assert.equal(ok.status, 201);
});
