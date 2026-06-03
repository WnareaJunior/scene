const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const eventRoutes = require('./routes/events');
const mapRoutes = require('./routes/map');

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
  allowedHeaders: ['Authorization', 'Content-Type'],
};

const rateLimitResponse = (req, res) =>
  res.status(429).json({ error: 'Too many attempts, please try again later' });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: rateLimitResponse,
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  handler: rateLimitResponse,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  handler: rateLimitResponse,
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

app.use('/api/v1', apiLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/map', mapRoutes);

app.use((err, req, res, next) => {
  console.error(err.message, err.stack);
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

module.exports = app;
