#!/usr/bin/env node
// Plain-SQL migration runner. One file per migration in backend/migrations,
// named NNNN_description.sql and applied in lexical order.
//
//   node scripts/migrate.js                 apply every pending migration
//   node scripts/migrate.js --status        list applied / pending, change nothing
//   node scripts/migrate.js --dry-run       print what would run, change nothing
//   node scripts/migrate.js --baseline 0003 mark 0001..0003 applied WITHOUT running
//                                           them (for databases that already have
//                                           the schema: staging, prod, the devbox)
//
// Env: DATABASE_URL (required), DATABASE_SSL=disable for a TLS-less local
// Postgres (same switch as src/db.js on the devbox branch).
//
// File headers the runner understands (first 20 lines):
//   -- migrate:no-transaction   run outside a transaction (CREATE INDEX CONCURRENTLY)
//
// Rules the runner enforces:
//   * an applied file's checksum must still match — edit an applied migration
//     and the runner refuses to continue; add a new file instead
//   * a database that already has the `users` table but no schema_migrations
//     rows is refused unless --baseline is given, so a deploy against an
//     existing database can never try to re-create it
//   * one runner at a time per database (advisory lock)
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'migrations');
const LOCK_KEY = 7214001; // arbitrary, unique to this runner
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

function listFiles() {
  return fs.readdirSync(DIR)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      const head = sql.split('\n').slice(0, 20).join('\n');
      return {
        version: file.slice(0, 4),
        name: file,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
        noTransaction: /^--\s*migrate:no-transaction\b/m.test(head),
      };
    });
}

function connect() {
  if (!process.env.DATABASE_URL) {
    console.error('migrate: DATABASE_URL is not set');
    process.exit(1);
  }
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  });
}

async function main() {
  const files = listFiles();
  const versions = new Set(files.map((f) => f.version));
  if (versions.size !== files.length) {
    console.error('migrate: two files share a version number');
    process.exit(1);
  }

  const client = connect();
  await client.connect();
  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows: appliedRows } = await client.query(
      `SELECT version, name, checksum FROM schema_migrations ORDER BY version`
    );
    const applied = new Map(appliedRows.map((r) => [r.version, r]));

    // Drift check: an applied migration must not have been edited.
    for (const f of files) {
      const a = applied.get(f.version);
      if (a && a.checksum !== f.checksum) {
        console.error(`migrate: ${f.name} was edited after it was applied (checksum mismatch). Add a new migration instead.`);
        process.exit(1);
      }
    }
    for (const a of appliedRows) {
      if (!versions.has(a.version)) {
        console.error(`migrate: database has ${a.name} applied but the file is missing from ${DIR}`);
        process.exit(1);
      }
    }

    const pending = files.filter((f) => !applied.has(f.version));

    if (flag('--status')) {
      for (const f of files) console.log(`${applied.has(f.version) ? 'applied' : 'pending'}  ${f.name}`);
      return;
    }

    const baseline = opt('--baseline');
    if (baseline) {
      const upTo = files.filter((f) => f.version <= baseline && !applied.has(f.version));
      if (!files.some((f) => f.version === baseline)) {
        console.error(`migrate: no migration with version ${baseline}`);
        process.exit(1);
      }
      for (const f of upTo) {
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
          [f.version, f.name, f.checksum]
        );
        console.log(`baselined  ${f.name}`);
      }
      if (!upTo.length) console.log('baseline: nothing to mark');
      return;
    }

    if (!pending.length) {
      console.log('migrate: up to date');
      return;
    }

    // Refuse to run the schema-creating baseline against a database that
    // already has the schema. This is the guard that keeps a deploy from
    // failing at boot with "relation users already exists".
    if (!applied.size) {
      const { rows } = await client.query(`SELECT to_regclass('public.users') AS t`);
      if (rows[0].t) {
        console.error(
          'migrate: this database already has the Scene schema but no schema_migrations rows.\n' +
          '  Mark it as baselined first:  node scripts/migrate.js --baseline <version>\n' +
          '  (use the highest version whose changes are already present in this database)'
        );
        process.exit(1);
      }
    }

    for (const f of pending) {
      if (flag('--dry-run')) {
        console.log(`would apply  ${f.name}${f.noTransaction ? '  (no transaction)' : ''}`);
        continue;
      }
      const started = Date.now();
      if (f.noTransaction) {
        // A multi-statement string is run by Postgres as one implicit
        // transaction, which is exactly what CONCURRENTLY forbids — so send
        // each statement on its own. Split on a semicolon at end of line;
        // no-transaction files must therefore not contain dollar-quoted bodies.
        const statements = f.sql
          .split(/;\s*$/m)
          .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
          .filter(Boolean);
        for (const statement of statements) await client.query(statement);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
          [f.version, f.name, f.checksum]
        );
      } else {
        await client.query('BEGIN');
        try {
          await client.query(f.sql);
          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
            [f.version, f.name, f.checksum]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
      console.log(`applied  ${f.name}  (${Date.now() - started} ms)`);
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error('migrate:', err.message);
  process.exit(1);
});
