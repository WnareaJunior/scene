'use strict';
// Connecting to a Postgres that is coming up, rather than one that is down.
//
// Two places need this and both used to fail the same way:
//   * CI waits with `docker exec pg pg_isready`, which asks over the unix
//     socket. The official Postgres image's first boot starts a temporary
//     socket-only server to run initdb and the init scripts, shuts it down,
//     then restarts for real — so pg_isready answers "ready" while TCP 5432
//     is not serving yet, and the next connection dies with ECONNREFUSED or
//     "Connection terminated unexpectedly".
//   * a Render boot against a cold hosted database, where the first connection
//     can land on 57P03 ("the database system is starting up").
//
// Both are the same shape: transient for a few seconds, then fine. A wrong
// password or a missing database is not, and retrying those just delays a
// failure the operator needs to see, so they are classified out.

// Socket-level failures that mean "nothing is listening yet" or "the server
// hung up mid-handshake". ENOTFOUND is deliberately absent: a hostname that
// does not resolve is almost always a typo, not a race.
const TRANSIENT_SYSCALL_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN', // the transient DNS failure, unlike ENOTFOUND
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

// Postgres SQLSTATEs for a server that is not ready to take the connection.
const TRANSIENT_SQLSTATES = new Set([
  '57P03', // cannot_connect_now — "the database system is starting up"
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
]);

// node-postgres reports some of these as a bare Error with no code.
const TRANSIENT_MESSAGES = [
  /connection terminated unexpectedly/i,
  /connection terminated during connection establishment/i,
  /client has encountered a connection error/i,
  /timeout expired/i, // pg's own connectionTimeoutMillis
  /terminating connection due to administrator command/i,
  /the database system is (starting up|shutting down|in recovery)/i,
];

function isTransientConnectionError(err) {
  if (!err) return false;
  if (TRANSIENT_SQLSTATES.has(err.code)) return true;
  if (TRANSIENT_SYSCALL_CODES.has(err.code)) return true;
  // An aggregate from a host that resolves to several addresses (IPv6 + IPv4):
  // transient only if every leg was.
  if (Array.isArray(err.errors) && err.errors.length) {
    return err.errors.every((e) => isTransientConnectionError(e));
  }
  return TRANSIENT_MESSAGES.some((re) => re.test(err.message || ''));
}

// Connect, and prove the connection works with a trivial query — a socket that
// opens during the image's restart can still die on the first real statement,
// which is what made the CI flake look like a migration failure rather than a
// connection one.
//
// createClient must hand back a *fresh* client each call: a pg Client cannot be
// reused once its connection has failed.
async function connectWithRetry(createClient, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((msg) => console.error(msg));
  const deadline = now() + timeoutMs;

  let delayMs = 250;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const client = createClient();
    try {
      await client.connect();
      await client.query('SELECT 1');
      if (attempt > 1) log(`db: connected on attempt ${attempt}`);
      return client;
    } catch (err) {
      // Release the half-open client before deciding anything.
      await Promise.resolve(client.end && client.end()).catch(() => {});
      if (!isTransientConnectionError(err)) throw err;
      if (now() >= deadline) {
        err.message = `${err.message} (still unreachable after ${timeoutMs} ms, ${attempt} attempts)`;
        throw err;
      }
      log(`db: ${err.message} — not ready yet, retrying in ${delayMs} ms`);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 2000);
    }
  }
}

module.exports = { isTransientConnectionError, connectWithRetry };
