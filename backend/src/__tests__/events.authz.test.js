// Authorization and capacity coverage for the events routes, against a real
// database. See helpers.js for the harness and the *_test database guard.
const test = require('node:test');
const {
  API, request, truncate, createUser, createEvent, assert, close, db,
} = require('./helpers');

test.beforeEach(truncate);
test.after(close);

test('host-only PATCH /events/:id returns 403 for a non-host, 200 for the host', async () => {
  const host = await createUser();
  const other = await createUser();
  const event = await createEvent(host.id, { title: 'before' });

  const denied = await request.patch(`${API}/events/${event.id}`).set(other.auth).send({ title: 'hijacked' });
  assert.equal(denied.status, 403);

  const ok = await request.patch(`${API}/events/${event.id}`).set(host.auth).send({ title: 'after' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.title, 'after');
});

test('host-only DELETE /events/:id returns 403 for a non-host, 204 + cancelled for the host', async () => {
  const host = await createUser();
  const other = await createUser();
  const event = await createEvent(host.id);

  const denied = await request.delete(`${API}/events/${event.id}`).set(other.auth);
  assert.equal(denied.status, 403);

  const ok = await request.delete(`${API}/events/${event.id}`).set(host.auth);
  assert.equal(ok.status, 204);
  const { rows } = await db.query(`SELECT status FROM events WHERE id = $1`, [event.id]);
  assert.equal(rows[0].status, 'cancelled');
});

test('PATCH and DELETE on an unknown event return 404', async () => {
  const user = await createUser();
  const missing = '00000000-0000-0000-0000-000000000000';
  assert.equal((await request.patch(`${API}/events/${missing}`).set(user.auth).send({ title: 'x' })).status, 404);
  assert.equal((await request.delete(`${API}/events/${missing}`).set(user.auth)).status, 404);
});

test('POST /events/:id/rsvp returns 409 when the event is at capacity', async () => {
  const host = await createUser();
  const first = await createUser();
  const second = await createUser();
  const event = await createEvent(host.id, { capacity: 1 });

  const a = await request.post(`${API}/events/${event.id}/rsvp`).set(first.auth).send({ status: 'going' });
  assert.equal(a.status, 201);
  assert.equal(a.body.status, 'going');

  const b = await request.post(`${API}/events/${event.id}/rsvp`).set(second.auth).send({ status: 'going' });
  assert.equal(b.status, 409);

  // "interested" does not count against capacity.
  const c = await request.post(`${API}/events/${event.id}/rsvp`).set(second.auth).send({ status: 'interested' });
  assert.equal(c.status, 201);

  // Re-RSVPing the person who already holds the slot is not blocked by their own row.
  const again = await request.post(`${API}/events/${event.id}/rsvp`).set(first.auth).send({ status: 'going' });
  assert.equal(again.status, 201);
});

test('PATCH /events/:id/rsvp to going returns 409 at capacity and 404 without an RSVP', async () => {
  const host = await createUser();
  const holder = await createUser();
  const waiting = await createUser();
  const event = await createEvent(host.id, { capacity: 1 });

  await request.post(`${API}/events/${event.id}/rsvp`).set(holder.auth).send({ status: 'going' });
  await request.post(`${API}/events/${event.id}/rsvp`).set(waiting.auth).send({ status: 'interested' });

  const full = await request.patch(`${API}/events/${event.id}/rsvp`).set(waiting.auth).send({ status: 'going' });
  assert.equal(full.status, 409);

  const nobody = await createUser();
  const none = await request.patch(`${API}/events/${event.id}/rsvp`).set(nobody.auth).send({ status: 'going' });
  assert.equal(none.status, 404);
});

test('GET /events/:id hides a private event from anyone but the host and going attendees', async () => {
  const host = await createUser();
  const stranger = await createUser();
  const attendee = await createUser();
  const event = await createEvent(host.id, { isPrivate: true });

  assert.equal((await request.get(`${API}/events/${event.id}`).set(host.auth)).status, 200);
  assert.equal((await request.get(`${API}/events/${event.id}`).set(stranger.auth)).status, 404);

  await db.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'going')`, [event.id, attendee.id]);
  assert.equal((await request.get(`${API}/events/${event.id}`).set(attendee.auth)).status, 200);
});

test('private events stay off discover and map pins', async () => {
  const host = await createUser();
  const viewer = await createUser();
  await createEvent(host.id, { title: 'public one' });
  await createEvent(host.id, { title: 'private one', isPrivate: true });

  const bbox = 'swLat=40.5&swLng=-74.3&neLat=40.95&neLng=-73.7';
  const discover = await request.get(`${API}/events?${bbox}`).set(viewer.auth);
  assert.equal(discover.status, 200);
  assert.deepEqual(discover.body.map((e) => e.title), ['public one']);

  const pins = await request.get(`${API}/map/events?${bbox}`).set(viewer.auth);
  assert.equal(pins.status, 200);
  assert.deepEqual(pins.body.map((e) => e.title), ['public one']);
});

test('GET /events/:id/attendees is host-only when show_attendees is off', async () => {
  const host = await createUser();
  const other = await createUser();
  const event = await createEvent(host.id, { showAttendees: false });

  assert.equal((await request.get(`${API}/events/${event.id}/attendees`).set(other.auth)).status, 403);
  const mine = await request.get(`${API}/events/${event.id}/attendees`).set(host.auth);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.total, 0);
});
