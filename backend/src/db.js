const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = {
  query: (text, params) => pool.query(text, params),
};

pool.on('error', (err) => {
  console.error('Unexpected DB error', err);
  process.exit(-1);
});