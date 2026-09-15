const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase / hosted Postgres needs TLS; the local devbox Postgres doesn't
  // speak it. Set DATABASE_SSL=disable when pointing at a plain server.
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 10,                   // maximum connections in the pool
  idleTimeoutMillis: 30000,  // close idle connections after 30 s
  connectionTimeoutMillis: 5000, // fail fast if a new connection takes > 5 s
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};

pool.on('error', (err) => {
  console.error('Unexpected DB error', err);
});