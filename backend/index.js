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
    startEmbedSweep();
  })
  .catch((err) => {
    console.error('FATAL: database connection failed:', err.message);
    process.exit(1);
  });

// In-process embedding sweep: newly created or edited events land in the
// events_needing_embedding view and get vectors on the next pass, with no
// separate worker service to deploy. The worker's writes are idempotent, so
// this coexists safely with any manual `embed-events.js --once` run.
// EMBED_SWEEP_MS=0 disables it (e.g. when a dedicated worker runs --loop).
function startEmbedSweep() {
  if (process.env.SEARCH_ENABLED !== 'true') return;
  const intervalMs = process.env.EMBED_SWEEP_MS === undefined
    ? 5 * 60 * 1000
    : Number(process.env.EMBED_SWEEP_MS);
  if (!intervalMs) return;

  // The CLI's stub guard lives in its main(), not in drain() — re-assert it
  // here. Sweeping with the stub provider would fill the embedding column with
  // pseudo-vectors that look valid and return meaningless neighbors.
  const { isStub, provider } = require('./src/search/adapters/embeddings');
  if (isStub) {
    console.error('[embed-sweep] disabled: no embedding API key (provider=stub)');
    return;
  }

  const { drain } = require('./src/search/worker/embed-events');
  let running = false;
  const sweep = async () => {
    if (running) return; // a slow drain must not stack a second one
    running = true;
    try {
      const { written, failed } = await drain({ dryRun: false });
      if (written || failed) {
        console.log(`[embed-sweep] provider=${provider} embedded=${written}${failed ? ` failed=${failed}` : ''}`);
      }
    } catch (err) {
      console.error('[embed-sweep]', err.message); // next tick retries
    } finally {
      running = false;
    }
  };
  setInterval(sweep, intervalMs).unref();
  sweep(); // drain whatever accumulated while the server was down
}
