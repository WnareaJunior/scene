// Image storage behind a driver switch:
//
//   STORAGE_DRIVER=supabase  (default) — Supabase Storage REST API, production
//   STORAGE_DRIVER=s3        — any S3-compatible endpoint; used for local dev
//                              against MinIO on the devbox
//
// Both drivers expose the same contract: upload() resolves to the public URL
// that gets stored in Postgres, remove() is best-effort cleanup.

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const DRIVER = process.env.STORAGE_DRIVER || 'supabase';

// ── supabase driver ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;

async function supabaseUpload(buffer, key, mimetype) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': mimetype,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Storage upload failed: ${res.status}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${key}`;
}

function supabaseRemove(key) {
  return fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
}

// ── s3 driver (MinIO locally, but any S3-compatible store works) ─────────────
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET;
// Where browsers fetch objects from. Defaults to the endpoint itself, which is
// right for MinIO with an anonymous-download bucket policy.
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL || S3_ENDPOINT;

let s3Client;
function s3() {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      // Path-style URLs (host/bucket/key) — MinIO doesn't do virtual hosts.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
    });
  }
  return s3Client;
}

async function s3Upload(buffer, key, mimetype) {
  await s3().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }));
  return `${S3_PUBLIC_URL}/${S3_BUCKET}/${key}`;
}

function s3Remove(key) {
  return s3().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

// ── public contract ──────────────────────────────────────────────────────────
const configured =
  DRIVER === 's3'
    ? Boolean(S3_ENDPOINT && S3_BUCKET && process.env.S3_ACCESS_KEY)
    : Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY && SUPABASE_BUCKET);

module.exports = {
  // False when storage env vars are absent — callers skip best-effort cleanup.
  configured,

  // prefix is "avatars" or "events"; resolves to the stored public URL.
  upload(prefix, filename, buffer, mimetype) {
    const key = `${prefix}/${filename}`;
    return DRIVER === 's3'
      ? s3Upload(buffer, key, mimetype)
      : supabaseUpload(buffer, key, mimetype);
  },

  // Best-effort: callers attach their own .catch.
  remove(prefix, filename) {
    const key = `${prefix}/${filename}`;
    return DRIVER === 's3' ? s3Remove(key) : supabaseRemove(key);
  },
};
