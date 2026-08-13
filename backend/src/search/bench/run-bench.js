#!/usr/bin/env node
//
// Search quality + latency benchmark. Runs the golden query set through the
// pipeline in-process (no HTTP) against whatever DATABASE_URL points at.
//
//   node src/search/bench/run-bench.js                 # staging (backend/.env)
//   node src/search/bench/run-bench.js --k 5           # judge hits within top 5
//   node src/search/bench/run-bench.js --json out.json # machine-readable dump
//   node src/search/bench/run-bench.js --verbose       # per-case detail
//
// Metrics
//   hit@k  — share of cases where a relevant result (title+description matches
//            the case regex) appears in the top k events
//   MRR    — mean reciprocal rank of the first relevant result
//   parse  — place/time extraction accuracy on cases that assert them
//   geo    — share of results within the expected radius on borough cases
//   p50/p95 latency — end-to-end pipeline time per query, measured here
//
// Every bench search is logged to search_logs under the bench user like any
// other search; filter them out of product analytics by the bench user id.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { search } = require('../index');

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const K = Number(argVal('--k', 10));
const JSON_OUT = argVal('--json', null);
const VERBOSE = args.includes('--verbose');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden.json'), 'utf8'));

const haversineKm = (aLat, aLng, bLat, bLng) => {
  const R = 6371, dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

async function benchUser() {
  // The viewer must NOT be a user the golden set searches for — user lookup
  // excludes the viewer themselves, so benching as @miabk makes "@miabk"
  // unfindable by design. teo@example.com is reserved for the bench.
  const { rows } = await db.query(`SELECT id FROM users WHERE email = 'teo@example.com'`);
  if (!rows.length) throw new Error('no bench user — run scripts/seed-nyc-events.js first');
  return rows[0].id;
}

async function runCase(c, userId) {
  const vp = c.viewport || golden.defaultViewport;
  const started = Date.now();
  const res = await search({
    query: c.q,
    userId,
    db,
    viewport: { lat: vp.lat, lng: vp.lng },
    limit: Math.max(K, 10),
    utcOffsetMinutes: -240, // NYC in DST; keeps "tonight"/"weekend" cases honest
  });
  const latencyMs = Date.now() - started;
  const m = res.meta;

  const out = { cat: c.cat, q: c.q, latencyMs, counts: m.counts || null, fallback: !!m.fallbackApplied, llm: !!m.llmEscalated, checks: {}, rank: null };

  if (c.match) {
    const re = new RegExp(c.match, 'i');
    const rank = res.events.findIndex((e) => re.test(`${e.title} ${e.description}`)) + 1;
    out.rank = rank || null;
    out.checks.hit = rank > 0 && rank <= K;
  }
  if (c.expectPlace) out.checks.place = (m.parsed?.place?.name || null) === c.expectPlace;
  if (c.expectTime) out.checks.time = m.parsed?.time != null;
  if (c.resultsNear && res.events.length) {
    const near = res.events.filter((e) => haversineKm(e.latitude, e.longitude, c.resultsNear.lat, c.resultsNear.lng) <= c.resultsNear.km);
    out.checks.geo = near.length / res.events.length >= 0.5; // majority in-borough
  }
  if (c.expectMode === 'users') {
    if (c.expectUser) out.checks.user = res.users.some((u) => u.username === c.expectUser);
    if (c.expectEmptyUsers) out.checks.user = res.users.length === 0 && !m.fallbackApplied;
  }

  out.pass = Object.values(out.checks).every(Boolean);
  return out;
}

async function main() {
  const userId = await benchUser();
  const results = [];
  for (const c of golden.cases) {
    const r = await runCase(c, userId);
    results.push(r);
    if (VERBOSE) {
      const checks = Object.entries(r.checks).map(([k, v]) => `${k}:${v ? '✓' : '✗'}`).join(' ');
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.cat}] "${r.q}" rank=${r.rank ?? '—'} ${checks} ${r.latencyMs}ms`);
    }
  }

  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const matchCases = results.filter((r) => 'hit' in r.checks);
  const ranked = matchCases.filter((r) => r.rank);
  const mrr = matchCases.length
    ? (matchCases.reduce((acc, r) => acc + (r.rank ? 1 / r.rank : 0), 0) / matchCases.length)
    : 0;

  const byCat = {};
  for (const r of results) {
    byCat[r.cat] = byCat[r.cat] || { pass: 0, total: 0 };
    byCat[r.cat].total++;
    if (r.pass) byCat[r.cat].pass++;
  }

  const summary = {
    cases: results.length,
    passed: results.filter((r) => r.pass).length,
    [`hit@${K}`]: pct(matchCases.filter((r) => r.checks.hit).length, matchCases.length),
    'hit@3': pct(ranked.filter((r) => r.rank <= 3).length, matchCases.length),
    mrr: +mrr.toFixed(3),
    latency_p50_ms: quantile(lat, 0.5),
    latency_p95_ms: quantile(lat, 0.95),
    fallback_rate: pct(results.filter((r) => r.fallback).length, results.length),
    llm_escalation_rate: pct(results.filter((r) => r.llm).length, results.length),
  };

  console.log('\n── search bench ─────────────────────────────');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log('  by category:');
  for (const [cat, s] of Object.entries(byCat)) console.log(`    ${cat.padEnd(10)} ${s.pass}/${s.total}`);
  const fails = results.filter((r) => !r.pass);
  if (fails.length) {
    console.log('  failing cases:');
    for (const f of fails) console.log(`    [${f.cat}] "${f.q}" rank=${f.rank ?? '—'} checks=${JSON.stringify(f.checks)}`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, byCat, results }, null, 2));
    console.log(`  wrote ${JSON_OUT}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[bench] fatal:', err.message); process.exit(1); });
