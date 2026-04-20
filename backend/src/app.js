const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const eventRoutes = require('./routes/events');
const mapRoutes = require('./routes/map');

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

const app = express();
// helmet is first; crossOriginResourcePolicy is relaxed so upload static files
// served with Content-Disposition: attachment are not blocked by the browser.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/v1/auth/login', authLimiter);
app.post('/api/v1/auth/register', authLimiter);
app.post('/api/v1/auth/refresh', refreshLimiter);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/map', mapRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
