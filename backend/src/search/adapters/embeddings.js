// Embedding adapter — one of the pipeline's two external dependencies.
//
// Provider is chosen by EMBEDDING_PROVIDER; with no key configured it falls back
// to a deterministic local stub so the semantic retrieval path is exercisable in
// tests and on a dev box without spending an API call. The stub is NOT
// semantically meaningful — it exists to prove wiring, not relevance. Relevance
// thresholds (recall@5, MRR) must be asserted against a real provider.

const { EMBEDDING_DIM } = require('../config');

const PROVIDER = process.env.EMBEDDING_PROVIDER || (process.env.VOYAGE_API_KEY ? 'voyage' : 'stub');
const MODEL = process.env.EMBEDDING_MODEL || 'voyage-3';

/**
 * FNV-1a over the input, used to seed a deterministic PRNG.
 * @param {string} str
 * @returns {number} 32-bit unsigned hash
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic pseudo-embedding. Token-bag based, so texts sharing tokens land
 * closer together than texts that don't — enough structure for a wiring test to
 * distinguish a hit from a miss, nowhere near enough for a relevance assertion.
 * @param {string} text
 * @returns {number[]} unit-normalized vector of length EMBEDDING_DIM
 */
function stubEmbed(text) {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const tokens = String(text).toLowerCase().split(/\W+/).filter(Boolean);
  for (const token of tokens) {
    const h = fnv1a(token);
    // Scatter each token across a few dimensions so vectors aren't near-orthogonal.
    for (let i = 0; i < 4; i++) {
      const idx = (h + i * 0x9e3779b9) % EMBEDDING_DIM;
      vec[idx] += 1 - i * 0.2;
    }
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

/**
 * @param {string[]} texts
 * @param {'query'|'document'} inputType Voyage ranks asymmetrically; queries and
 *   documents must be embedded with the matching input type or recall degrades.
 * @returns {Promise<number[][]>}
 */
async function voyageEmbed(texts, inputType) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      input_type: inputType === 'query' ? 'query' : 'document',
      output_dimension: EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage embeddings failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data.map(d => d.embedding);
}

/**
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function openaiEmbed(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      input: texts,
      dimensions: EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data.map(d => d.embedding);
}

/**
 * Embed one or more texts.
 *
 * @param {string|string[]} input
 * @param {{inputType?: 'query'|'document'}} [opts]
 * @returns {Promise<number[][]>} one vector per input, in order
 */
async function embed(input, opts = {}) {
  const texts = Array.isArray(input) ? input : [input];
  if (!texts.length) return [];

  switch (PROVIDER) {
    case 'voyage':
      return voyageEmbed(texts, opts.inputType || 'document');
    case 'openai':
      return openaiEmbed(texts);
    case 'stub':
      return texts.map(stubEmbed);
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER '${PROVIDER}'`);
  }
}

/**
 * Convenience wrapper for the single-query case in stage 4.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedQuery(text) {
  const [vec] = await embed([text], { inputType: 'query' });
  return vec;
}

/**
 * pgvector's text input format. node-postgres has no native vector type, so the
 * literal is passed as a string and cast in SQL.
 * @param {number[]} vec
 * @returns {string}
 */
function toPgVector(vec) {
  return `[${vec.join(',')}]`;
}

module.exports = { embed, embedQuery, toPgVector, provider: PROVIDER, isStub: PROVIDER === 'stub' };
