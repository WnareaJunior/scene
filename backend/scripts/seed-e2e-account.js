#!/usr/bin/env node
// Creates (or resets) the account the Playwright suite logs in with.
//
//   E2E_EMAIL=scene.e2e@e2e.test E2E_PASSWORD=… E2E_USERNAME=scene_e2e \
//     node scripts/seed-e2e-account.js
//
// Idempotent on email: re-running resets the password, username and bio, so a
// half-finished run (profile.spec stamps the bio) never leaves the account in a
// state the next run can't use. The bio must be non-empty — C1 asserts it.
//
// Uses DATABASE_URL (and DATABASE_SSL) like every other script. Meant for the
// CI database and the devbox; nothing stops you aiming it at staging, but the
// suite itself should not run against production any more.
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const username = process.env.E2E_USERNAME || 'scene_e2e';
const bio = process.env.E2E_BIO || 'professional third wheel — i know where the party is';

if (!email || !password) {
  console.error('seed-e2e-account: E2E_EMAIL and E2E_PASSWORD are required');
  process.exit(1);
}

(async () => {
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await db.query(
    `INSERT INTO users (email, username, password_hash, bio)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET username = EXCLUDED.username,
           password_hash = EXCLUDED.password_hash,
           bio = EXCLUDED.bio,
           updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [email, username, hash, bio]
  );
  console.log(`[e2e-account] ${rows[0].inserted ? 'created' : 'reset'} ${username} <${email}> (${rows[0].id})`);
  await db.end();
})().catch((err) => {
  console.error('seed-e2e-account:', err.message);
  process.exit(1);
});
