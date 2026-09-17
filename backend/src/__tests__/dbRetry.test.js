// Waiting out a database that is coming up, without waiting on one that will
// never answer (no database needed — the clients here are fakes).
const test = require('node:test');
const assert = require('node:assert/strict');
const { isTransientConnectionError, connectWithRetry } = require('../dbRetry');

const err = (props) => Object.assign(new Error(props.message || 'boom'), props);

// A fake pg Client. `script` is one entry per attempt: an Error to fail the
// connect with, 'query' to fail the first SELECT 1 instead, or null to succeed.
function fakeClients(script) {
  const made = [];
  const createClient = () => {
    const step = script[made.length];
    const client = {
      ended: false,
      async connect() {
        if (step && step !== 'query') throw step;
      },
      async query() {
        if (step === 'query') throw err({ message: 'Connection terminated unexpectedly' });
        return { rows: [{ '?column?': 1 }] };
      },
      async end() { this.ended = true; },
    };
    made.push(client);
    return client;
  };
  return { createClient, made };
}

// A clock and a sleep that record instead of waiting, so the tests are instant.
function fakeTime() {
  let t = 0;
  const slept = [];
  return {
    now: () => t,
    sleep: async (ms) => { slept.push(ms); t += ms; },
    slept,
    advance: (ms) => { t += ms; },
  };
}

test('a server that is still starting up is transient', () => {
  assert.ok(isTransientConnectionError(err({ code: 'ECONNREFUSED' })));
  assert.ok(isTransientConnectionError(err({ code: 'ECONNRESET' })));
  assert.ok(isTransientConnectionError(err({ code: 'EAI_AGAIN' })));
  assert.ok(isTransientConnectionError(err({ code: '57P03' })));
  assert.ok(isTransientConnectionError(err({ code: '08006' })));
  // The one CI actually reports, which arrives with no code at all.
  assert.ok(isTransientConnectionError(err({ message: 'Connection terminated unexpectedly' })));
  assert.ok(isTransientConnectionError(err({ message: 'timeout expired' })));
  assert.ok(isTransientConnectionError(err({ message: 'the database system is starting up' })));
});

test('a misconfiguration is not transient, so it is not retried away', () => {
  assert.equal(isTransientConnectionError(err({ code: '28P01' })), false); // bad password
  assert.equal(isTransientConnectionError(err({ code: '3D000' })), false); // no such database
  assert.equal(isTransientConnectionError(err({ code: 'ENOTFOUND' })), false); // typo'd host
  assert.equal(isTransientConnectionError(err({ code: '42P01' })), false); // undefined_table
  assert.equal(isTransientConnectionError(null), false);
});

test('a multi-address failure is transient only if every leg was', () => {
  const legs = (...codes) => err({ message: 'aggregate', errors: codes.map((code) => err({ code })) });
  assert.ok(isTransientConnectionError(legs('ECONNREFUSED', 'ECONNREFUSED')));
  assert.equal(isTransientConnectionError(legs('ECONNREFUSED', '28P01')), false);
});

test('connects first try without sleeping', async () => {
  const { createClient, made } = fakeClients([null]);
  const time = fakeTime();
  const client = await connectWithRetry(createClient, { ...time, log: () => {} });
  assert.equal(made.length, 1);
  assert.equal(client, made[0]);
  assert.deepEqual(time.slept, []);
});

test('retries past the image restart with a backing-off delay', async () => {
  const refused = err({ code: 'ECONNREFUSED' });
  const { createClient, made } = fakeClients([refused, refused, refused, null]);
  const time = fakeTime();
  const logged = [];
  const client = await connectWithRetry(createClient, { ...time, log: (m) => logged.push(m) });
  assert.equal(made.length, 4);
  assert.equal(client, made[3]);
  assert.deepEqual(time.slept, [250, 500, 1000]);
  // Every abandoned client is released, and the recovery is announced.
  assert.deepEqual(made.slice(0, 3).map((c) => c.ended), [true, true, true]);
  assert.ok(logged.some((m) => /attempt 4/.test(m)), logged.join(' | '));
});

test('a socket that opens and then dies on the first statement also retries', async () => {
  // The case that made the flake read as a migration failure: connect() won,
  // the server was still mid-restart, and SELECT 1 was what noticed.
  const { createClient, made } = fakeClients(['query', null]);
  const time = fakeTime();
  const client = await connectWithRetry(createClient, { ...time, log: () => {} });
  assert.equal(made.length, 2);
  assert.equal(client, made[1]);
});

test('a bad password fails on the first attempt', async () => {
  const { createClient, made } = fakeClients([err({ code: '28P01', message: 'password authentication failed' })]);
  const time = fakeTime();
  await assert.rejects(
    connectWithRetry(createClient, { ...time, log: () => {} }),
    /password authentication failed/
  );
  assert.equal(made.length, 1);
  assert.deepEqual(time.slept, []);
});

test('gives up at the deadline and says how long it waited', async () => {
  const refused = err({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' });
  const { createClient, made } = fakeClients(new Array(50).fill(refused));
  const time = fakeTime();
  await assert.rejects(
    connectWithRetry(createClient, { ...time, timeoutMs: 1000, log: () => {} }),
    /still unreachable after 1000 ms, \d+ attempts/
  );
  // Bounded by the deadline, not by the script length.
  assert.ok(made.length > 1 && made.length < 10, `attempts: ${made.length}`);
});

test('the delay never grows past two seconds', async () => {
  const refused = err({ code: 'ECONNREFUSED' });
  const { createClient } = fakeClients([...new Array(8).fill(refused), null]);
  const time = fakeTime();
  await connectWithRetry(createClient, { ...time, timeoutMs: 60000, log: () => {} });
  assert.deepEqual(time.slept, [250, 500, 1000, 2000, 2000, 2000, 2000, 2000]);
});
