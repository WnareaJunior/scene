const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const eventRoutes = require('./routes/events');
const mapRoutes = require('./routes/map');
const searchRoutes = require('./routes/search');

// Fail fast at boot if no JWT secret is configured. The auth route and middleware
// both resolve `JWT_ACCESS_SECRET || JWT_SECRET`; without one, tokens are signed
// with `undefined` and every protected request 401s. Surface that at startup.
if (!process.env.JWT_ACCESS_SECRET && !process.env.JWT_SECRET) {
  throw new Error('Missing JWT secret: set JWT_ACCESS_SECRET (preferred) or JWT_SECRET');
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(Object.assign(new Error(`Origin '${origin}' not allowed by CORS`), { status: 403 }));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  // X-E2E-Key: see isE2eBypass below — without it here, the browser's CORS
  // preflight rejects the header before the limiter ever sees it.
  allowedHeaders: ['Authorization', 'Content-Type', 'X-E2E-Key'],
};

const rateLimitResponse = (req, res) =>
  res.status(429).json({ error: 'Too many attempts, please try again later' });

// E2E test support. The Playwright suite runs its whole auth matrix from a
// single CI IP, which would trip the 10-per-15-min auth limiter on the third
// test. When the E2E_RATE_LIMIT_BYPASS env var is set, requests carrying the
// matching X-E2E-Key header skip rate limiting. Unset (the default everywhere
// except a test-enabled deploy), this is dead code — no request can bypass.
// timingSafeEqual so the header can't be brute-forced via a timing oracle.
function isE2eBypass(req) {
  const secret = process.env.E2E_RATE_LIMIT_BYPASS;
  if (!secret) return false;
  const key = req.get('x-e2e-key') || '';
  const a = Buffer.from(key);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: rateLimitResponse,
  skip: isE2eBypass,
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  handler: rateLimitResponse,
  skip: isE2eBypass,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  handler: rateLimitResponse,
  skip: isE2eBypass,
});

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '50kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/v1/auth/login', authLimiter);
app.post('/api/v1/auth/register', authLimiter);
app.post('/api/v1/auth/refresh', refreshLimiter);

// Every /api/v1 response is private, per-user JSON — never disk-cacheable.
// Without this, Chromium can revive a pre-edit GET /users/me from cache after
// a reload and show stale profile data.
app.use('/api/v1', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/v1', apiLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/map', mapRoutes);
// Ships dark: the search pipeline can merge to main before its embedding
// backfill has run. Until SEARCH_ENABLED=true is set in the environment,
// the route does not exist (404), so a deploy cannot expose half-built search.
if (process.env.SEARCH_ENABLED === 'true') {
  app.use('/api/v1/search', searchRoutes);
}

app.use((err, req, res, next) => {
  console.error(err.message, err.stack);
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

module.exports = app;
