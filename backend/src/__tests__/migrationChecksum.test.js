// Line-ending-insensitive migration checksums (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { migrationChecksum, checksumMatches } = require('../migrationChecksum');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const lf = 'CREATE TABLE t (id int);\n-- note\nCREATE INDEX t_id ON t (id);\n';
const crlf = lf.replace(/\n/g, '\r\n');

test('a file hashes the same with LF or CRLF line endings', () => {
  assert.equal(migrationChecksum(lf), migrationChecksum(crlf));
  assert.equal(migrationChecksum(crlf), sha(lf));
});

test('a ledger row from either kind of checkout matches either kind of file', () => {
  // Rows written before the fix: raw hash of whatever the checkout had.
  for (const recorded of [sha(lf), sha(crlf)]) {
    assert.ok(checksumMatches(recorded, lf), 'LF file');
    assert.ok(checksumMatches(recorded, crlf), 'CRLF file');
  }
});

test('a real edit still does not match', () => {
  const edited = lf + '-- edited after apply\n';
  assert.equal(checksumMatches(sha(lf), edited), false);
  assert.equal(checksumMatches(sha(crlf), edited), false);
  assert.equal(checksumMatches(migrationChecksum(lf), edited.replace(/\n/g, '\r\n')), false);
});
