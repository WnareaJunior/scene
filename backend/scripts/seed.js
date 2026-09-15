#!/usr/bin/env node
// Seed the database with a deterministic, realistic dataset.
//
//   node scripts/seed.js --profile smoke              # 12 hosts, 30 events, follows, RSVPs
//   node scripts/seed.js --profile nyc  --seed 7      # 200 events + 40 extra users
//   node scripts/seed.js --profile load               # 2,000 users, 20,000 events
//   node scripts/seed.js --profile nyc  --reset       # wipe app tables first (local only)
//   node scripts/seed.js --profile smoke --events 60 --users 20   # override a profile
//   node scripts/seed.js --profile smoke --dry-run
//
// Profiles are defaults, flags override. Everything is derived from --seed
// (default 1) so two runs produce the same data. Hosts are the fixed
// @example.com roster from seed-nyc-events.js (teo@example.com is reserved for
// the search bench); extra users are @seed.test.
//
// --reset truncates users, events, rsvps, follows, blocks, reports,
// refresh_tokens and search_logs. It refuses unless DATABASE_URL points at a
// local host (localhost, 127.0.0.1, devbox, dev-postgres, postgres) or
// --i-mean-it is passed. This is the guard the old --unseed never had.
//
// Not seeded here: the e2e login account (scripts/seed-e2e-account.js) and
// embeddings (the in-process sweep or worker/embed-events.js).
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const nyc = require('./seed-nyc-events');

const PROFILES = {
  smoke: { events: 30,    users: 12,   followsPerUser: [2, 5],  rsvpsPerEvent: [0, 6]  },
  nyc:   { events: 200,   users: 40,   followsPerUser: [3, 8],  rsvpsPerEvent: [0, 15] },
  load:  { events: 20000, users: 2000, followsPerUser: [3, 10], rsvpsPerEvent: [0, 25] },
};
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'devbox', 'dev-postgres', 'postgres', '::1']);

const args = process.argv.slice(2);
const argVal = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
const has = (flag) => args.includes(flag);

const profileName = argVal('--profile', 'smoke');
const profile = PROFILES[profileName];
if (!profile) {
  console.error(`seed: unknown profile "${profileName}" (smoke | nyc | load)`);
  process.exit(2);
}
const SEED = Number(argVal('--seed', 1));
const EVENTS = Number(argVal('--events', profile.events));
const USERS = Number(argVal('--users', profile.users));
const DRY = has('--dry-run');

const rand = nyc.mulberry32(SEED * 7919 + 17);
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function dbHost() {
  try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ''; }
}

function assertLocalForReset() {
  const host = dbHost();
  if (LOCAL_HOSTS.has(host) || has('--i-mean-it')) return;
  console.error(
    `seed: --reset refused — DATABASE_URL points at "${host || '?'}", which is not a local host.\n` +
    `  This would truncate every user and event there. If that is really what you want,\n` +
    `  pass --i-mean-it.`
  );
  process.exit(1);
}

async function reset() {
  await db.query(`TRUNCATE users, events, rsvps, follows, blocks, reports, refresh_tokens, search_logs CASCADE`);
}

const FIRST = ['ari', 'bea', 'cal', 'dee', 'eli', 'fay', 'gus', 'hal', 'ivy', 'jo', 'kit', 'lou', 'max', 'nia', 'oz', 'pia', 'quin', 'rae', 'sam', 'tao', 'uma', 'val', 'wes', 'xi', 'yas', 'zed'];
const BIOS = [
  'here for the music', 'will bring snacks', 'dj by night, nurse by day', 'new to the city, show me around',
  'rooftops > basements', 'basements > rooftops', 'only at parties with a dog', 'i know a guy',
  'chronically early', 'chronically late', 'ask me about my playlists', '',
];

// Extra (non-host) users: deterministic handles, all @seed.test.
async function ensureUsers(n) {
  const hash = await bcrypt.hash('SeedUser123!', 4);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const username = `${pick(FIRST)}${String(i).padStart(4, '0')}`;
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, username, bio)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET username = users.username
       RETURNING id`,
      [`${username}@seed.test`, hash, username, pick(BIOS)]
    );
    ids.push(rows[0].id);
  }
  return ids;
}

async function seedFollows(userIds, [lo, hi]) {
  let n = 0;
  for (const follower of userIds) {
    const want = randInt(lo, Math.min(hi, userIds.length - 1));
    const chosen = new Set();
    while (chosen.size < want) {
      const target = pick(userIds);
      if (target !== follower) chosen.add(target);
    }
    for (const followed of chosen) {
      await db.query(
        `INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [follower, followed]
      );
      n++;
    }
  }
  return n;
}

// RSVPs are "velocity-shaped": parties starting sooner draw more of them,
// which is what the search re-ranker's popularity signal expects to see.
async function seedRsvps(events, userIds, [lo, hi], now) {
  let going = 0, interested = 0;
  for (const ev of events) {
    const daysOut = (new Date(ev.start_time) - now) / 86400000;
    const soonBoost = daysOut < 7 ? 1.6 : daysOut < 14 ? 1.2 : 0.8;
    let want = Math.round(randInt(lo, hi) * soonBoost);
    if (ev.capacity) want = Math.min(want, ev.capacity);
    const chosen = new Set();
    while (chosen.size < Math.min(want, userIds.length)) chosen.add(pick(userIds));
    for (const userId of chosen) {
      const status = rand() < 0.7 ? 'going' : 'interested';
      await db.query(
        `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [ev.id, userId, status]
      );
      if (status === 'going') going++; else interested++;
    }
  }
  return { going, interested };
}

async function main() {
  const now = new Date();
  console.log(`[seed] profile=${profileName} seed=${SEED} events=${EVENTS} users=${USERS}${DRY ? ' (dry run)' : ''}`);
  if (DRY) {
    nyc.setSeed(SEED);
    for (let i = 0; i < Math.min(EVENTS, 5); i++) {
      const e = nyc.buildEvent(['dry-run'], now);
      console.log(`  ${e.start_time.slice(0, 16)}  ${e.title}  (${e.address})`);
    }
    console.log(`[seed] would insert ${EVENTS} events, ${USERS} users, follows and RSVPs`);
    return;
  }

  if (has('--reset')) {
    assertLocalForReset();
    await reset();
    console.log(`[seed] reset: app tables truncated on ${dbHost()}`);
  }

  const hostIds = await nyc.ensureHosts();
  const userIds = await ensureUsers(USERS);
  const everyone = [...hostIds, ...userIds];

  nyc.setSeed(SEED);
  const events = [];
  for (let i = 0; i < EVENTS; i++) {
    events.push(await nyc.insertEvent(nyc.buildEvent(hostIds, now)));
    if (EVENTS >= 1000 && (i + 1) % 1000 === 0) console.log(`  … ${i + 1} events`);
  }

  const follows = await seedFollows(everyone, profile.followsPerUser);
  const rsvps = await seedRsvps(events, everyone, profile.rsvpsPerEvent, now);

  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM events WHERE status = 'active' AND start_time > now()) AS upcoming,
            (SELECT count(*) FROM events WHERE embedding IS NULL) AS needs_embedding`
  );
  console.log(
    `[seed] done · users ${rows[0].users} · events +${events.length} (upcoming ${rows[0].upcoming}) · ` +
    `follows +${follows} · rsvps +${rsvps.going} going / +${rsvps.interested} interested · ` +
    `awaiting embedding: ${rows[0].needs_embedding}`
  );
}

main()
  .then(() => db.end())
  .catch((err) => { console.error('[seed] fatal:', err.message); process.exit(1); });
