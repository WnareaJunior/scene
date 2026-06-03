// Authorization / capacity coverage for the events routes.
//
// These are true integration tests: they need a live Postgres (PostGIS) test
// database and an HTTP harness (e.g. supertest) to exercise the route stack end
// to end. Neither is wired up yet — package.json has no test dependencies and
// adding them is out of scope for this change. The skeletons are left SKIPPED so
// the coverage gap is explicit and tracked rather than silently missing.
const test = require('node:test');

const NEEDS_HARNESS = 'needs a test Postgres + HTTP harness (supertest); not yet wired up';

test('host-only PATCH /events/:id returns 403 for a non-host', { skip: NEEDS_HARNESS }, () => {});
test('host-only DELETE /events/:id returns 403 for a non-host', { skip: NEEDS_HARNESS }, () => {});
test('POST /events/:id/rsvp returns 409 when the event is at capacity', { skip: NEEDS_HARNESS }, () => {});
