// Comment thread coverage for the events routes, against a real database.
// See helpers.js for the harness and the *_test database guard.
const test = require('node:test');
const {
  API, request, truncate, createUser, createEvent, assert, close, db, count,
} = require('./helpers');

test.beforeEach(truncate);
test.after(close);

const rsvp = (event, user, status = 'going') =>
  request.post(`${API}/events/${event.id}/rsvp`).set(user.auth).send({ status });

const post = (event, user, body) =>
  request.post(`${API}/events/${event.id}/comments`).set(user.auth).send({ body });

test('POST /comments is refused without an RSVP and allowed with one', async () => {
  const host = await createUser();
  const guest = await createUser();
  const event = await createEvent(host.id);

  const denied = await post(event, guest, 'let me in');
  assert.equal(denied.status, 403);
  assert.equal(await count('event_comments'), 0);

  await rsvp(event, guest);

  const ok = await post(event, guest, 'pulling up');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.body, 'pulling up');
  assert.equal(ok.body.is_mine, true);
  assert.equal(ok.body.is_host, false);
  assert.equal(ok.body.username, guest.username);
});

test('an interested RSVP is enough to comment', async () => {
  const host = await createUser();
  const maybe = await createUser();
  const event = await createEvent(host.id);

  await rsvp(event, maybe, 'interested');
  assert.equal((await post(event, maybe, 'might swing by')).status, 201);
});

test('the host can comment on their own party without an RSVP', async () => {
  const host = await createUser();
  const event = await createEvent(host.id);

  const res = await post(event, host, 'doors at 10');
  assert.equal(res.status, 201);
  assert.equal(res.body.is_host, true);
});

test('GET /comments returns the thread oldest first, flagged for the caller', async () => {
  const host = await createUser();
  const guest = await createUser();
  const event = await createEvent(host.id);
  await rsvp(event, guest);

  await post(event, host, 'first');
  await post(event, guest, 'second');

  const res = await request.get(`${API}/events/${event.id}/comments`).set(guest.auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.data.map((c) => c.body), ['first', 'second']);

  const [fromHost, fromGuest] = res.body.data;
  assert.equal(fromHost.is_host, true);
  assert.equal(fromHost.is_mine, false);
  assert.equal(fromGuest.is_mine, true);
});

test('paging returns the newest comments first, still in chronological order', async () => {
  const host = await createUser();
  const event = await createEvent(host.id);

  // created_at defaults to now() and these land inside the same millisecond,
  // so set the timestamps explicitly to get a deterministic order.
  for (let i = 1; i <= 5; i += 1) {
    await db.query(
      `INSERT INTO event_comments (event_id, user_id, body, created_at)
       VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
      [event.id, host.id, `c${i}`, i]
    );
  }

  const page = await request.get(`${API}/events/${event.id}/comments?limit=2`).set(host.auth);
  assert.equal(page.status, 200);
  assert.equal(page.body.total, 5);
  // the tail of the thread, reading forward
  assert.deepEqual(page.body.data.map((c) => c.body), ['c4', 'c5']);

  const older = await request.get(`${API}/events/${event.id}/comments?limit=2&offset=2`).set(host.auth);
  assert.deepEqual(older.body.data.map((c) => c.body), ['c2', 'c3']);
});

test('a comment body must be non-empty and at most 500 characters', async () => {
  const host = await createUser();
  const event = await createEvent(host.id);

  assert.equal((await post(event, host, '   ')).status, 400);
  assert.equal((await post(event, host, 'x'.repeat(501))).status, 400);
  assert.equal((await post(event, host, 'x'.repeat(500))).status, 201);
});

test('DELETE /comments: author or host may delete, a third party may not', async () => {
  const host = await createUser();
  const author = await createUser();
  const bystander = await createUser();
  const event = await createEvent(host.id);
  await rsvp(event, author);
  await rsvp(event, bystander);

  const mine = (await post(event, author, 'mine to delete')).body;
  const moderated = (await post(event, author, 'host takes this down')).body;

  const url = (c) => `${API}/events/${event.id}/comments/${c.id}`;

  assert.equal((await request.delete(url(mine)).set(bystander.auth)).status, 403);
  assert.equal((await request.delete(url(mine)).set(author.auth)).status, 204);
  assert.equal((await request.delete(url(moderated)).set(host.auth)).status, 204);
  assert.equal(await count('event_comments'), 0);
});

test('a private event hides its thread from someone who is not going', async () => {
  const host = await createUser();
  const outsider = await createUser();
  const going = await createUser();
  const event = await createEvent(host.id, { isPrivate: true });

  // A private event is reachable by its host or by someone already going, so
  // the RSVP has to be seeded directly -- the RSVP route would be a 404 too.
  await db.query(
    `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`,
    [event.id, going.id]
  );

  assert.equal((await request.get(`${API}/events/${event.id}/comments`).set(outsider.auth)).status, 404);
  assert.equal((await post(event, outsider, 'who is this')).status, 404);

  assert.equal((await request.get(`${API}/events/${event.id}/comments`).set(going.auth)).status, 200);
  assert.equal((await post(event, going, 'see you there')).status, 201);
});

test('comments on an unknown event are a 404, not an empty thread', async () => {
  const user = await createUser();
  const missing = '00000000-0000-0000-0000-000000000000';
  assert.equal((await request.get(`${API}/events/${missing}/comments`).set(user.auth)).status, 404);
  assert.equal((await request.post(`${API}/events/${missing}/comments`).set(user.auth).send({ body: 'hi' })).status, 404);
});

test('deleting the event takes the thread with it', async () => {
  const host = await createUser();
  const event = await createEvent(host.id);
  await post(event, host, 'this goes away');
  assert.equal(await count('event_comments'), 1);

  // The route cancels rather than deletes, so exercise the cascade directly.
  await db.query(`DELETE FROM events WHERE id = $1`, [event.id]);
  assert.equal(await count('event_comments'), 0);
});
