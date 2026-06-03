// Smoke tests for the JWT auth middleware — runnable with `node --test` (no
// extra dependencies, no database). Covers the U1 regression: a token signed
// when only JWT_SECRET is set must still verify, because the middleware resolves
// `JWT_ACCESS_SECRET || JWT_SECRET`.
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

const JWT_OPTS = { algorithm: 'HS256', issuer: 'scene-api', audience: 'scene-app' };
const MW_PATH = '../middleware/auth';

// The middleware caches the resolved secret at module-load time, so reload it
// with a clean env for each scenario.
function loadMiddleware(env) {
  delete process.env.JWT_ACCESS_SECRET;
  delete process.env.JWT_SECRET;
  Object.assign(process.env, env);
  delete require.cache[require.resolve(MW_PATH)];
  return require(MW_PATH);
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function runMiddleware(mw, token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

test('accepts a token signed with JWT_ACCESS_SECRET', () => {
  const mw = loadMiddleware({ JWT_ACCESS_SECRET: 'access-secret' });
  const token = jwt.sign({ sub: 'user-1' }, 'access-secret', { ...JWT_OPTS, expiresIn: '5m' });
  const { req, res, nextCalled } = runMiddleware(mw, token);
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.user.sub, 'user-1');
});

test('accepts a token when only JWT_SECRET is set (fallback) — regression for U1', () => {
  const mw = loadMiddleware({ JWT_SECRET: 'legacy-secret' });
  const token = jwt.sign({ sub: 'user-2' }, 'legacy-secret', { ...JWT_OPTS, expiresIn: '5m' });
  const { req, nextCalled } = runMiddleware(mw, token);
  assert.equal(nextCalled, true);
  assert.equal(req.user.sub, 'user-2');
});

test('rejects a request with no Authorization header', () => {
  const mw = loadMiddleware({ JWT_ACCESS_SECRET: 'access-secret' });
  const { res, nextCalled } = runMiddleware(mw, null);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('rejects a token signed with the wrong secret', () => {
  const mw = loadMiddleware({ JWT_ACCESS_SECRET: 'access-secret' });
  const token = jwt.sign({ sub: 'user-3' }, 'wrong-secret', { ...JWT_OPTS, expiresIn: '5m' });
  const { res, nextCalled } = runMiddleware(mw, token);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('rejects a malformed token', () => {
  const mw = loadMiddleware({ JWT_ACCESS_SECRET: 'access-secret' });
  const { res, nextCalled } = runMiddleware(mw, 'not-a-jwt');
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
