// Account-deletion coverage for DELETE /users/me (App Store Guideline 5.1.1(v)).
//
// Same situation as events.authz.test.js: these need a live Postgres (PostGIS)
// test database and an HTTP harness (supertest), which aren't wired up yet.
// Skeletons are SKIPPED so the coverage gap stays explicit.
const test = require('node:test');

const NEEDS_HARNESS = 'needs a test Postgres + HTTP harness (supertest); not yet wired up';

test('DELETE /users/me returns 400 when password is missing', { skip: NEEDS_HARNESS }, () => {});
test('DELETE /users/me returns 401 for a wrong password', { skip: NEEDS_HARNESS }, () => {});
test('DELETE /users/me removes the user and cascades events/rsvps/follows/tokens', { skip: NEEDS_HARNESS }, () => {});
test('DELETE /users/me invalidates existing refresh tokens (refresh returns 401)', { skip: NEEDS_HARNESS }, () => {});
