#!/usr/bin/env node
//
// Review the search pipeline's per-search logs (search_logs table).
//
//   node scripts/search-logs.js                  # last 20 searches, one line each
//   node scripts/search-logs.js --limit 50
//   node scripts/search-logs.js --last           # full trace of the latest search
//   node scripts/search-logs.js --id <uuid>      # full trace of one search
//   node scripts/search-logs.js --stats [--hours 24]
//
// Read-only. Uses DATABASE_URL from the environment: backend/.env (staging) by
// default; export .env.production first to read prod.

require('dotenv').config();
const db = require('../src/db');

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(argVal('--limit', 20));
const HOURS = Number(argVal('--hours', 24));
const ID = argVal('--id', null);

const short = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function list() {
  const { rows } = await db.query(
    `SELECT l.*, u.username FROM search_logs l LEFT JOIN users u ON u.id = l.user_id
     ORDER BY l.created_at DESC LIMIT $1`, [LIMIT]);
  console.log('time              user            query → cleaned                     lex/sem→ret  conf  flags                 tap   ms');
  console.log('─'.repeat(118));
  for (const r of rows) {
    const flags = [
      r.rejected && `REJECTED:${r.rejection_reason}`,
      r.llm_escalated && 'llm',
      r.fallback_applied && 'fallback',
      r.retriever_errors && 'ERRORS',
    ].filter(Boolean).join(',') || '—';
    const q = r.cleaned_query && r.cleaned_query !== r.sanitized_query
      ? `${short(r.sanitized_query, 20)} → ${short(r.cleaned_query, 12)}`
      : short(r.sanitized_query, 34);
    const tap = r.tapped_position ? `#${r.tapped_position}` : '—';
    console.log(
      `${r.created_at.toISOString().slice(5, 19).replace('T', ' ')}  ` +
      `${short(r.username || '?', 14).padEnd(15)} ${q.padEnd(36)}` +
      `${String(r.lexical_count ?? 0).padStart(3)}/${String(r.semantic_count ?? 0).padEnd(3)}→${String(r.result_count ?? 0).padEnd(3)}  ` +
      `${(r.parse_confidence ?? 0).toFixed(2)}  ${flags.padEnd(20)}  ${tap.padEnd(4)}  ${r.latency_ms}`
    );
  }
  console.log(`\n${rows.length} searches. Trace one with --id <uuid> (ids via --last or SQL).`);
}

async function trace(id) {
  const { rows } = await db.query(
    id
      ? `SELECT l.*, u.username FROM search_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = $1`
      : `SELECT l.*, u.username FROM search_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 1`,
    id ? [id] : []);
  if (!rows.length) return console.log('no such search');
  const r = rows[0];
  const j = (v) => JSON.stringify(v, null, 2)?.split('\n').join('\n     ') ?? '—';

  console.log(`search ${r.id}\nby @${r.username || '?'} at ${r.created_at.toISOString()} · ${r.latency_ms}ms\n`);
  console.log(`1 sanitize   raw:       ${JSON.stringify(r.raw_query)}`);
  console.log(`             sanitized: ${JSON.stringify(r.sanitized_query)}  flags: ${r.sanitize_flags?.join(',') || '—'}`);
  if (r.rejected) return console.log(`             REJECTED: ${r.rejection_reason} (pipeline stopped here)`);
  console.log(`2 parse      cleaned:   ${JSON.stringify(r.cleaned_query)}  confidence: ${r.parse_confidence}  llmEscalated: ${r.llm_escalated}`);
  console.log(`             entities:  ${j(r.parsed_entities)}`);
  console.log(`3 filters    ${j(r.applied_filters)}`);
  console.log(`4 route      ${j(r.route_weights)}`);
  console.log(`5 retrieve   lexical: ${r.lexical_count}  semantic: ${r.semantic_count}` +
    (r.retriever_errors ? `\n             ERRORS: ${j(r.retriever_errors)}` : ''));
  console.log(`6 fuse       fused: ${r.fused_count}  fallbackApplied: ${r.fallback_applied}`);
  console.log(`7 results    returned: ${r.result_count}`);
  const shown = r.results_shown || [];
  const ids = shown.map((s) => s.id);
  const names = {};
  if (ids.length) {
    const { rows: ev } = await db.query(`SELECT id, title FROM events WHERE id = ANY($1)`, [ids]);
    const { rows: us } = await db.query(`SELECT id, username FROM users WHERE id = ANY($1)`, [ids]);
    for (const e of ev) names[e.id] = e.title;
    for (const u of us) names[u.id] = '@' + u.username;
  }
  shown.forEach((s, i) => {
    const tapped = r.tapped_result_id && (s.id === r.tapped_result_id) ? '  ← TAPPED' : '';
    console.log(`             ${String(i + 1).padStart(2)}. [${s.type || 'event'}] ${short(names[s.id] || s.id, 60)}${tapped}`);
  });
  if (r.tapped_result_id) console.log(`8 tap        position ${r.tapped_position} (${r.tapped_result_type}) at ${r.tapped_at?.toISOString()}`);
}

async function stats() {
  const { rows: [s] } = await db.query(`
    SELECT count(*) AS searches,
           count(*) FILTER (WHERE rejected) AS rejected,
           count(*) FILTER (WHERE result_count = 0 AND NOT rejected) AS zero_results,
           count(*) FILTER (WHERE llm_escalated) AS llm,
           count(*) FILTER (WHERE fallback_applied) AS fallback,
           -- jsonb gotcha: the pipeline logs JSON null (jsonb 'null'), which
           -- is NOT SQL NULL — filter both or every search counts as errored
           count(*) FILTER (WHERE retriever_errors IS NOT NULL AND retriever_errors <> 'null'::jsonb) AS errors,
           count(*) FILTER (WHERE tapped_result_id IS NOT NULL) AS tapped,
           round(avg(tapped_position) FILTER (WHERE tapped_position IS NOT NULL), 2) AS avg_tap_pos,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM search_logs WHERE created_at > now() - make_interval(hours => $1)`, [HOURS]);
  const pc = (n) => s.searches > 0 ? `${(100 * n / s.searches).toFixed(0)}%` : '—';
  console.log(`── search stats, last ${HOURS}h ──────────────`);
  console.log(`  searches        ${s.searches}`);
  console.log(`  rejected        ${s.rejected} (${pc(s.rejected)})`);
  console.log(`  zero results    ${s.zero_results} (${pc(s.zero_results)})   ← relevance debt lives here`);
  console.log(`  llm escalated   ${s.llm} (${pc(s.llm)})`);
  console.log(`  fallback used   ${s.fallback} (${pc(s.fallback)})`);
  console.log(`  retriever errs  ${s.errors} (${pc(s.errors)})`);
  console.log(`  tap-through     ${s.tapped} (${pc(s.tapped)})   avg tap position: ${s.avg_tap_pos ?? '—'}`);
  console.log(`  latency         p50 ${Math.round(s.p50 ?? 0)}ms · p95 ${Math.round(s.p95 ?? 0)}ms`);

  const { rows: top } = await db.query(`
    SELECT sanitized_query, count(*) AS n, count(*) FILTER (WHERE result_count = 0) AS zero
    FROM search_logs WHERE created_at > now() - make_interval(hours => $1) AND NOT rejected
    GROUP BY 1 ORDER BY n DESC LIMIT 10`, [HOURS]);
  if (top.length) {
    console.log('  top queries:');
    for (const t of top) console.log(`    ${String(t.n).padStart(3)}×  ${short(t.sanitized_query, 50)}${t.zero > 0 ? `  (${t.zero} zero-result)` : ''}`);
  }
}

(args.includes('--stats') ? stats() : (args.includes('--last') || ID) ? trace(ID) : list())
  .then(() => process.exit(0))
  .catch((err) => { console.error('[search-logs] fatal:', err.message); process.exit(1); });
