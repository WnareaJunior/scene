// Integration-test harness: a real Postgres (PostGIS + pgvector) with the
// tracked migrations applied, and the Express app driven through supertest
// with no listening socket.
//
//   DATABASE_URL=postgresql://dev:…@localhost:5433/scene_test DATABASE_SSL=disable npm test
//
// Guard: the database name must end in `_test` (or CI must be set), because
// truncate() wipes every table. That is what stops a stray `.env` pointing at
// staging from being emptied by a test run.
//
// Test files share one database, so `npm test` runs them with
// --test-concurrency=1; two files truncating at once would race.
//
// Users are inserted directly and tokens signed here, bypassing /auth/register
// and its 10-per-15-minutes limiter; the auth routes get exercised only where
// a test is about them.
'use strict';

const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');

if (!process.env.DATABASE_URL) {
  throw new Error('tests need DATABASE_URL pointing at a *_test database');
}
const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/_test$/.test(dbName) && !process.env.CI) {
  throw new Error(`refusing to run destructive tests against database "${dbName}" (name must end in _test)`);
}

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
// No storage configured: avatar cleanup on account deletion is best-effort and
// skipped when storage.configured is false.
delete process.env.SUPABASE_URL;
delete process.env.STORAGE_DRIVER;

const supertest = require('supertest');
const db = require('../db');
const app = require('../app');

const JWT_OPTS = { algorithm: 'HS256', issuer: 'scene-api', audience: 'scene-app' };
const API = '/api/v1';

// Low bcrypt cost: these hashes are throwaway and the tests create many users.
const HASH_ROUNDS = 4;

// Everything except neighborhoods (seed data, part of the schema).
async function truncate() {
  await db.query(
    `TRUNCATE users, events, rsvps, follows, blocks, reports, refresh_tokens, search_logs CASCADE`
  );
}

function tokenFor(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, { ...JWT_OPTS, expiresIn: '5m' });
}

let userSeq = 0;
async function createUser(overrides = {}) {
  userSeq += 1;
  const username = overrides.username || `user${userSeq}_${randomUUID().slice(0, 6)}`;
  const password = overrides.password || 'Test-Password-123!';
  const email = overrides.email || `${username}@test.local`;
  const { rows } = await db.query(
    `INSERT INTO users (email, username, password_hash)
     VALUES ($1, $2, $3) RETURNING id, email, username`,
    [email, username, await bcrypt.hash(password, HASH_ROUNDS)]
  );
  const user = rows[0];
  return { ...user, password, token: tokenFor(user.id), auth: { Authorization: `Bearer ${tokenFor(user.id)}` } };
}

// A public party in Bushwick tomorrow evening unless told otherwise.
async function createEvent(hostId, overrides = {}) {
  const e = {
    title: 'Test party',
    latitude: 40.6944,
    longitude: -73.9213,
    startTime: new Date(Date.now() + 24 * 3600e3).toISOString(),
    capacity: null,
    isPrivate: false,
    showAttendees: true,
    ...overrides,
  };
  const { rows } = await db.query(
    `INSERT INTO events (host_id, title, location, latitude, longitude, start_time, capacity, is_private, show_attendees)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [hostId, e.title, e.latitude, e.longitude, e.startTime, e.capacity, e.isPrivate, e.showAttendees]
  );
  return rows[0];
}

async function count(table, where = '', params = []) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table} ${where}`, params);
  return rows[0].n;
}

module.exports = {
  API,
  app,
  db,
  request: supertest(app),
  truncate,
  createUser,
  createEvent,
  tokenFor,
  count,
  assert,
  // Call from test.after(): the pg pool keeps idle sockets open for 30 s and
  // the test process would wait that long to exit.
  close: () => db.end(),
};
