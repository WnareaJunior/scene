#!/usr/bin/env node
// Remove seed, test and load-test accounts from a database — and nothing else.
//
//   scripts/with-env.sh production node scripts/purge-seed-accounts.js
//   scripts/with-env.sh production node scripts/purge-seed-accounts.js --apply
//
// Dry run by default: it reports what it would delete, what it is protecting,
// and — the part that actually matters — the collateral, i.e. rows belonging to
// REAL users that a cascade would take with it.
//
// Why collateral is the headline number: users -> events is ON DELETE CASCADE,
// and events -> rsvps is too. Deleting a seed host deletes that host's events,
// which deletes every RSVP on them, including RSVPs made by real people. The
// app is live, so that is a real user losing something they did, not a
// bookkeeping detail. Read that number before passing --apply.
//
// NOT touched, by explicit decision (2026-09-15):
//   - %@example.com — the NYC host roster behind the seeded borough events.
//     Production has no other meaningful map content yet, so purging it would
//     leave live users with an empty map. It goes once real supply exists.
//   - applereview@getscene.app / applereview2@getscene.app — Apple needs
//     working demo credentials for every FUTURE submission, not just the one
//     that shipped. The spare exists because a reviewer can delete the first
//     while testing account deletion (5.1.1(v)).
//
// Storage note: deleting a user cascades in Postgres but does NOT remove their
// uploaded avatar or event images from the bucket. Those objects are orphaned,
// not reclaimed. The script reports how many rows carried an image URL.
'use strict';

require('dotenv').config();
const db = require('../src/db');

const APPLY = process.argv.includes('--apply');
// Blast-radius guard: refuse an --apply that is far larger than expected unless
// the ceiling is raised on purpose. A pattern that suddenly matches thousands
// of rows means the pattern is wrong, not that the cleanup got bigger.
const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX_USERS = maxArg ? Number(maxArg.split('=')[1]) : 200;

// Each target is reported separately so a surprising count can be traced to the
// pattern that produced it rather than hiding inside a total.
const TARGETS = [
  { label: 'App Review seed (@scene-seed.app)', sql: `email LIKE '%@scene-seed.app'` },
  { label: 'seed.test accounts',                sql: `email LIKE '%@seed.test'` },
  { label: 'Playwright / e2e accounts',         sql: `email LIKE '%@e2e.test'` },
  { label: 'staging smoke account',             sql: `email = 'stagingsmoke@test.dev'` },
  { label: 'load-test / faker accounts',        sql: `email LIKE 'bulk1.%' OR username LIKE 'bulk1.%'` },
];

// Belt and braces: even if a target pattern were widened by mistake, nothing in
// here can be deleted. Checked again inside the transaction.
const PRESERVE = `(
  email LIKE '%@example.com'
  OR email IN ('applereview@getscene.app', 'applereview2@getscene.app')
)`;

const targetSet = `(SELECT id FROM users WHERE (${TARGETS.map(t => `(${t.sql})`).join(' OR ')}) AND NOT ${PRESERVE})`;

const n = v => Number(v).toLocaleString();

(async () => {
  console.log(APPLY ? '── PURGE (--apply)\n' : '── DRY RUN — nothing will be deleted. Re-run with --apply to execute.\n');

  // ── what would go ─────────────────────────────────────────────────────────
  console.log('Targets');
  let total = 0;
  for (const t of TARGETS) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM users WHERE (${t.sql}) AND NOT ${PRESERVE}`);
    total += rows[0].c;
    console.log(`  ${String(rows[0].c).padStart(6)}  ${t.label}`);
  }
  console.log(`  ${String(total).padStart(6)}  total users to delete\n`);

  // ── what is protected ─────────────────────────────────────────────────────
  const { rows: kept } = await db.query(
    `SELECT count(*)::int AS c FROM users WHERE ${PRESERVE}`);
  const { rows: review } = await db.query(
    `SELECT email FROM users WHERE email IN ('applereview@getscene.app','applereview2@getscene.app') ORDER BY email`);
  console.log('Protected');
  console.log(`  ${String(kept[0].c).padStart(6)}  users matched by the preserve rule (@example.com + App Review)`);
  console.log(`          App Review accounts present: ${review.length ? review.map(r => r.email).join(', ') : 'NONE FOUND — check before applying'}\n`);

  if (total === 0) {
    console.log('Nothing matches. Database is already clean.');
    await db.end();
    return;
  }

  // ── collateral: what real users lose ──────────────────────────────────────
  const { rows: ev } = await db.query(
    `SELECT count(*)::int AS c, count(image_url) FILTER (WHERE image_url IS NOT NULL)::int AS imgs
       FROM events WHERE host_id IN ${targetSet}`);
  const { rows: realRsvps } = await db.query(
    `SELECT count(*)::int AS c, count(DISTINCT r.user_id)::int AS people
       FROM rsvps r
       JOIN events e ON e.id = r.event_id
      WHERE e.host_id IN ${targetSet}
        AND r.user_id NOT IN ${targetSet}`);
  const { rows: realFollows } = await db.query(
    `SELECT count(*)::int AS c FROM follows
      WHERE followed_id IN ${targetSet} AND follower_id NOT IN ${targetSet}`);
  const { rows: realRsvpsOnReal } = await db.query(
    `SELECT count(*)::int AS c FROM rsvps
      WHERE user_id IN ${targetSet} AND event_id NOT IN (SELECT id FROM events WHERE host_id IN ${targetSet})`);

  console.log('Cascade reach');
  console.log(`  ${String(ev[0].c).padStart(6)}  events hosted by those users (deleted; ${n(ev[0].imgs)} carry an image that will be orphaned in the bucket)`);
  console.log(`  ${String(realRsvpsOnReal[0].c).padStart(6)}  RSVPs those users left on OTHER people's events (deleted)\n`);

  const collateral = realRsvps[0].c + realFollows[0].c;
  console.log(collateral ? 'COLLATERAL — real users are affected' : 'Collateral: none — no real user has touched this data');
  if (collateral) {
    console.log(`  ${String(realRsvps[0].c).padStart(6)}  RSVPs by ${n(realRsvps[0].people)} real user(s) on events that will be deleted`);
    console.log(`  ${String(realFollows[0].c).padStart(6)}  follows from real users onto accounts that will be deleted`);
    console.log('\n  These people will silently lose an RSVP or a follow. If that number is');
    console.log('  not acceptable, narrow the targets rather than proceeding.');
  }
  console.log('');

  if (!APPLY) {
    console.log(`Re-run with --apply to delete ${n(total)} users.`);
    await db.end();
    return;
  }

  if (total > MAX_USERS) {
    console.error(`REFUSING: ${n(total)} users exceeds the safety ceiling of ${n(MAX_USERS)}.`);
    console.error('A pattern matching this much is more likely wrong than right.');
    console.error(`Inspect the dry run, then raise it deliberately with --max=<n> if it is correct.`);
    await db.end();
    process.exit(1);
  }

  // One transaction: a half-purged database is worse than either end state.
  await db.query('BEGIN');
  try {
    const { rows: overlap } = await db.query(
      `SELECT count(*)::int AS c FROM users WHERE id IN ${targetSet} AND ${PRESERVE}`);
    if (overlap[0].c > 0) {
      throw new Error(`preserve rule overlaps the target set (${overlap[0].c} rows) — aborting`);
    }
    const { rowCount } = await db.query(`DELETE FROM users WHERE id IN ${targetSet}`);
    await db.query('COMMIT');
    console.log(`Deleted ${n(rowCount)} users (cascaded to their events, RSVPs, follows, blocks, reports and tokens).`);
    console.log('search_logs rows survive with user_id set to NULL, by schema design.');
    console.log(`\nNot handled here: ${n(ev[0].imgs)} orphaned image object(s) in the storage bucket.`);
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('ROLLED BACK —', err.message);
    process.exitCode = 1;
  }

  await db.end();
})().catch(async (err) => {
  console.error('purge-seed-accounts:', err.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
