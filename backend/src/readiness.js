// Readiness: is this instance actually able to serve?
//
// GET /health stays a constant-time "the process is up" answer — Render's own
// health check and the Uptime Kuma keep-warm monitor hit it constantly, and
// neither should cost a database round trip.
//
// GET /health/ready is the deep check deploy gates use. It is ready only when
//   * the database answers a query, and
//   * the schema_migrations ledger matches backend/migrations/ exactly:
//     nothing pending, nothing applied that is missing on disk, no checksum
//     drift (the same rules scripts/migrate.js enforces).
// It also reports the commit Render built (RENDER_GIT_COMMIT), so a workflow
// can wait for a specific deploy instead of guessing with sleeps.
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { migrationChecksum, checksumMatches } = require('./migrationChecksum');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const FILE_RE = /^\d{4}_[\w-]+\.sql$/; // keep in step with scripts/migrate.js
const QUERY_TIMEOUT_MS = 3000;

// The files cannot change while the process runs, so read them once per dir.
const fileCache = new Map();
function migrationFiles(dir) {
  if (!fileCache.has(dir)) {
    const files = fs.readdirSync(dir)
      .filter((f) => FILE_RE.test(f))
      .sort()
      .map((name) => ({
        version: name.slice(0, 4),
        name,
        sql: fs.readFileSync(path.join(dir, name), 'utf8'),
      }))
      .map((f) => ({ ...f, checksum: migrationChecksum(f.sql) }));
    fileCache.set(dir, files);
  }
  return fileCache.get(dir);
}

const query = (text) => db.query({ text, query_timeout: QUERY_TIMEOUT_MS });

async function checkReadiness({ dir = MIGRATIONS_DIR } = {}) {
  const result = {
    status: 'not_ready',
    commit: process.env.RENDER_GIT_COMMIT || null,
    database: 'unknown',
    migrations: null,
  };

  const files = migrationFiles(dir);

  let ledger;
  try {
    const { rows } = await query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`);
    result.database = 'ok';
    if (!rows[0].present) {
      result.migrations = { error: 'no schema_migrations table: this database has not been baselined' };
      return result;
    }
    ({ rows: ledger } = await query(`SELECT version, name, checksum FROM schema_migrations ORDER BY version`));
  } catch (err) {
    result.database = 'error';
    // Log the detail, return only a generic reason: the endpoint is public.
    console.error('[health/ready]', err.message);
    return result;
  }

  const applied = new Map(ledger.map((r) => [r.version, r]));
  const onDisk = new Set(files.map((f) => f.version));
  const pending = files.filter((f) => !applied.has(f.version)).map((f) => f.name);
  const missing = ledger.filter((r) => !onDisk.has(r.version)).map((r) => r.name);
  const drifted = files
    .filter((f) => applied.has(f.version) && !checksumMatches(applied.get(f.version).checksum, f.sql))
    .map((f) => f.name);

  result.migrations = {
    applied: ledger.length,
    onDisk: files.length,
    latest: ledger.length ? ledger[ledger.length - 1].version : null,
    pending,
    missing,
    drifted,
  };
  if (!pending.length && !missing.length && !drifted.length) result.status = 'ready';
  return result;
}

// Express handler. 200 only when ready; 503 otherwise, so `curl -f` works as a
// gate. `opts` exists for tests (a different migrations dir).
function createReadyHandler(opts = {}) {
  return async (req, res, next) => {
    try {
      const result = await checkReadiness(opts);
      res.set('Cache-Control', 'no-store');
      res.status(result.status === 'ready' ? 200 : 503).json(result);
    } catch (err) {
      next(err); // e.g. an unreadable migrations dir
    }
  };
}

module.exports = { checkReadiness, createReadyHandler, MIGRATIONS_DIR };
