require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
for (const v of required) {
  if (!process.env[v]) {
    console.error(`FATAL: missing required env var ${v}`);
    process.exit(1);
  }
}

const app = require('./src/app');
const db = require('./src/db');

const PORT = process.env.PORT || 3000;

db.query('SELECT 1')
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Scene API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('FATAL: database connection failed:', err.message);
    process.exit(1);
  });
