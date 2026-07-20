import * as SecureStore from 'expo-secure-store';
import { File } from 'expo-file-system';

const BASE_URL = 'https://scene-19ss.onrender.com/api/v1';

// ── Fetch with retry ──────────────────────────────────────────────────────────
// Render free tier spins the server down when idle; the first request during a
// cold start can be dropped at the proxy (iOS: "The network connection was
// lost"). Network-level failures mean the request never reached the app, so
// retrying is safe even for non-idempotent calls.

const NETWORK_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt >= NETWORK_RETRIES) {
        throw new Error('Could not reach the server — it may be waking up. Please try again.');
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
}

// ── Token storage (SecureStore — encrypted on-device) ─────────────────────────

export async function saveTokens({ accessToken, refreshToken }) {
  const ops = [SecureStore.setItemAsync('accessToken', accessToken)];
  if (refreshToken) ops.push(SecureStore.setItemAsync('refreshToken', refreshToken));
  await Promise.all(ops);
}

export async function clearTokens() {
  await Promise.all([
    SecureStore.deleteItemAsync('accessToken'),
    SecureStore.deleteItemAsync('refreshToken'),
  ]);
}

export async function getStoredToken() {
  return SecureStore.getItemAsync('accessToken');
}

async function refreshAccessToken() {
  const refreshToken = await SecureStore.getItemAsync('refreshToken');
  if (!refreshToken) throw new Error('No refresh token');

  const res = await fetchWithRetry(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    await clearTokens();
    throw new Error('Session expired');
  }

  const data = await res.json();
  await SecureStore.setItemAsync('accessToken', data.accessToken);
  return data.accessToken;
}

// ── Core request ──────────────────────────────────────────────────────────────

async function request(method, path, body, retry = true) {
  const token = await getStoredToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      await refreshAccessToken();
      return request(method, path, body, false);
    } catch {
      throw new Error('Session expired');
    }
  }

  if (res.status === 204) return null;
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || 'Request failed');
  }
  return res.json();
}

// ── Shared multipart upload (handles 401 token refresh) ──────────────────────

async function uploadFile(path, fieldName, imageUri, retry = true) {
  let token = await getStoredToken();
  // SDK 54+ global fetch is Expo's WinterCG fetch, which rejects React Native's
  // proprietary {uri, name, type} FormData parts ("Unsupported FormDataPart
  // implementation"). expo-file-system's File implements Blob, which it accepts.
  const formData = new FormData();
  formData.append(fieldName, new File(imageUri));
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (res.status === 401 && retry) {
    token = await refreshAccessToken();
    return uploadFile(path, fieldName, imageUri, false);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  register: (email, password, username) =>
    request('POST', '/auth/register', { email, password, username }),

  login: (email, password) =>
    request('POST', '/auth/login', { email, password }),

  logout: async () => {
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    if (refreshToken) {
      await request('POST', '/auth/logout', { refreshToken }).catch(() => {});
    }
    await clearTokens();
  },
};

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = {
  me: () => request('GET', '/users/me'),
  update: (data) => request('PATCH', '/users/me', data),
  uploadAvatar: (imageUri) => uploadFile('/users/me/avatar', 'avatar', imageUri),
  hostedEvents: (params = {}) => request('GET', `/users/me/hosted-events?${qs(params)}`),
  myRsvps: (params = {}) => request('GET', `/users/me/rsvps?${qs(params)}`),
  getUser: (userId) => request('GET', `/users/${userId}`),
  search: (q) => request('GET', `/users/search?q=${encodeURIComponent(q)}`),
  follow: (userId) => request('POST', `/users/${userId}/follow`),
  unfollow: (userId) => request('DELETE', `/users/${userId}/follow`),
  block: (userId) => request('POST', `/users/${userId}/block`),
  unblock: (userId) => request('DELETE', `/users/${userId}/block`),
  report: (userId, reason) => request('POST', `/users/${userId}/report`, { reason }),
  followers: (userId, params = {}) => request('GET', `/users/${userId}/followers?${qs(params)}`),
  following: (userId, params = {}) => request('GET', `/users/${userId}/following?${qs(params)}`),
  userEvents: (userId, params = {}) => request('GET', `/users/${userId}/hosted-events?${qs(params)}`),
};

// ── Events ────────────────────────────────────────────────────────────────────

export const events = {
  uploadImage: (imageUri) => uploadFile('/events/image', 'image', imageUri),
  create: (data) => request('POST', '/events', data),
  discover: (params = {}) => request('GET', `/events?${qs(params)}`),
  feed: (params = {}) => request('GET', `/events/feed?${qs(params)}`),
  random: (params = {}) => request('GET', `/events/random?${qs(params)}`),
  get: (id) => request('GET', `/events/${id}`),
  update: (id, data) => request('PATCH', `/events/${id}`, data),
  cancel: (id) => request('DELETE', `/events/${id}`),
  report: (id, reason) => request('POST', `/events/${id}/report`, { reason }),
  rsvp: (id, status) => request('POST', `/events/${id}/rsvp`, { status }),
  updateRsvp: (id, status) => request('PATCH', `/events/${id}/rsvp`, { status }),
  cancelRsvp: (id) => request('DELETE', `/events/${id}/rsvp`),
  attendees: (id, params = {}) => request('GET', `/events/${id}/attendees?${qs(params)}`),
};

// ── Map ───────────────────────────────────────────────────────────────────────

export const map = {
  eventPins: (params = {}) => request('GET', `/map/events?${qs(params)}`),
};
