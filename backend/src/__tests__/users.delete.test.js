// Account deletion — DELETE /users/me (App Store Guideline 5.1.1(v)).
// Real database via helpers.js; see the *_test guard there.
const test = require('node:test');
const {
  API, request, truncate, createUser, createEvent, assert, close, db, count,
} = require('./helpers');

test.beforeEach(truncate);
test.after(close);

test('DELETE /users/me returns 400 when password is missing', async () => {
  const user = await createUser();
  const res = await request.delete(`${API}/users/me`).set(user.auth).send({});
  assert.equal(res.status, 400);
  assert.equal(await count('users'), 1);
});

test('DELETE /users/me returns 401 for a wrong password', async () => {
  const user = await createUser();
  const res = await request.delete(`${API}/users/me`).set(user.auth).send({ password: 'not-it' });
  assert.equal(res.status, 401);
  assert.equal(await count('users'), 1);
});

test('DELETE /users/me removes the user and cascades events/rsvps/follows/tokens', async () => {
  const user = await createUser();
  const other = await createUser();
  const mine = await createEvent(user.id, { title: 'mine' });
  const theirs = await createEvent(other.id, { title: 'theirs' });
  await db.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`, [theirs.id, user.id]);
  await db.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`, [mine.id, other.id]);
  await db.query(`INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2), ($2, $1)`, [user.id, other.id]);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, 'deadbeef', now() + interval '1 day')`,
    [user.id]
  );

  const res = await request.delete(`${API}/users/me`).set(user.auth).send({ password: user.password });
  assert.equal(res.status, 204);

  assert.equal(await count('users', 'WHERE id = $1', [user.id]), 0);
  assert.equal(await count('events', 'WHERE host_id = $1', [user.id]), 0);
  assert.equal(await count('rsvps', 'WHERE user_id = $1', [user.id]), 0);
  assert.equal(await count('rsvps', 'WHERE event_id = $1', [mine.id]), 0, 'RSVPs to the deleted host\'s event go too');
  assert.equal(await count('follows', 'WHERE follower_id = $1 OR followed_id = $1', [user.id]), 0);
  assert.equal(await count('refresh_tokens', 'WHERE user_id = $1', [user.id]), 0);

  // The other account and its own event are untouched.
  assert.equal(await count('users', 'WHERE id = $1', [other.id]), 1);
  assert.equal(await count('events', 'WHERE id = $1', [theirs.id]), 1);

  // The deleted user's access token no longer resolves to anyone.
  assert.equal((await request.get(`${API}/users/me`).set(user.auth)).status, 404);
});

test('DELETE /users/me invalidates existing refresh tokens (refresh returns 401)', async () => {
  const user = await createUser();
  const login = await request.post(`${API}/auth/login`).send({ email: user.email, password: user.password });
  assert.equal(login.status, 200);
  const { refreshToken } = login.body;
  assert.ok(refreshToken);

  // Sanity: the token works before deletion.
  assert.equal((await request.post(`${API}/auth/refresh`).send({ refreshToken })).status, 200);

  const del = await request.delete(`${API}/users/me`).set(user.auth).send({ password: user.password });
  assert.equal(del.status, 204);

  const after = await request.post(`${API}/auth/refresh`).send({ refreshToken });
  assert.equal(after.status, 401);
});
