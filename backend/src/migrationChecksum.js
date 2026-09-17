// Migration checksums, shared by scripts/migrate.js and readiness.js.
//
// The checksum is taken over the file with CRLF normalised to LF, so the same
// migration hashes the same on a Windows checkout (git turns LF into CRLF in
// the working copy) and on Render or CI (LF, straight from git). Before this,
// staging was baselined from a Windows machine and every file then looked
// "edited" to the LF copy the server runs.
//
// Ledger rows written before the fix may hold the hash of the CRLF text, so a
// recorded checksum matches if it equals the hash of either form.
'use strict';

const crypto = require('crypto');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const toLf = (sql) => sql.replace(/\r\n/g, '\n');

// What gets written to schema_migrations.checksum.
function migrationChecksum(sql) {
  return sha256(toLf(sql));
}

// Does a recorded checksum belong to this file's content?
function checksumMatches(recorded, sql) {
  const lf = toLf(sql);
  return recorded === sha256(lf) || recorded === sha256(lf.replace(/\n/g, '\r\n'));
}

module.exports = { migrationChecksum, checksumMatches };
