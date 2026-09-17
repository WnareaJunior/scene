// /health (cheap liveness) and /health/ready (DB + migration ledger), against
// the real test database, which `npm test` has just migrated. The negative
// cases point the check at a temporary copy of backend/migrations rather than
// editing the shared schema_migrations table.
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const supertest = require('supertest');
const { request, assert, close } = require('./helpers');
const { checkReadiness, createReadyHandler, MIGRATIONS_DIR } = require('../readiness');

test.after(close);

const realFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();

// A fresh temp dir holding the real migrations, adjusted by `mutate`.
function migrationsCopy(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-migrations-'));
  for (const f of realFiles) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  mutate(dir);
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('GET /health answers ok without any detail', async () => {
  const res = await request.get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('GET /health/ready is 200 when the ledger matches the files on disk', async () => {
  process.env.RENDER_GIT_COMMIT = 'abc1234';
  try {
    const res = await request.get('/health/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ready');
    assert.equal(res.body.database, 'ok');
    assert.equal(res.body.commit, 'abc1234');
    assert.equal(res.body.migrations.applied, realFiles.length);
    assert.equal(res.body.migrations.onDisk, realFiles.length);
    assert.equal(res.body.migrations.latest, realFiles[realFiles.length - 1].slice(0, 4));
    assert.deepEqual(res.body.migrations.pending, []);
    assert.deepEqual(res.body.migrations.missing, []);
    assert.deepEqual(res.body.migrations.drifted, []);
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    delete process.env.RENDER_GIT_COMMIT;
  }
});

test('a migration file that has not been applied makes the instance not ready (503)', async () => {
  const dir = migrationsCopy((d) => fs.writeFileSync(path.join(d, '9999_not_yet_applied.sql'), 'SELECT 1;\n'));

  const result = await checkReadiness({ dir });
  assert.equal(result.status, 'not_ready');
  assert.deepEqual(result.migrations.pending, ['9999_not_yet_applied.sql']);

  const app = express();
  app.get('/ready', createReadyHandler({ dir }));
  const res = await supertest(app).get('/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'not_ready');
});

test('an applied migration missing from disk makes the instance not ready', async () => {
  const last = realFiles[realFiles.length - 1];
  const dir = migrationsCopy((d) => fs.rmSync(path.join(d, last)));

  const result = await checkReadiness({ dir });
  assert.equal(result.status, 'not_ready');
  assert.deepEqual(result.migrations.missing, [last]);
  assert.deepEqual(result.migrations.pending, []);
});

test('an applied migration edited on disk (checksum drift) makes the instance not ready', async () => {
  const first = realFiles[0];
  const dir = migrationsCopy((d) => fs.appendFileSync(path.join(d, first), '\n-- edited after apply\n'));

  const result = await checkReadiness({ dir });
  assert.equal(result.status, 'not_ready');
  assert.deepEqual(result.migrations.drifted, [first]);
});

test('CRLF copies of the applied migrations (a Windows checkout) are not drift', async () => {
  const dir = migrationsCopy((d) => {
    for (const f of realFiles) {
      const p = path.join(d, f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
  });

  const result = await checkReadiness({ dir });
  assert.deepEqual(result.migrations.drifted, []);
  assert.equal(result.status, 'ready');
});
