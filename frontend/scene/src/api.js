import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = 'http://localhost:3000/api/v1';

// ── Token storage ─────────────────────────────────────────────────────────────

export async function saveTokens({ accessToken, refreshToken }) {
  const ops = [AsyncStorage.setItem('accessToken', accessToken)];
  if (refreshToken) ops.push(AsyncStorage.setItem('refreshToken', refreshToken));
  await Promise.all(ops);
}

export async function clearTokens() {
  await Promise.all([
    AsyncStorage.removeItem('accessToken'),
    AsyncStorage.removeItem('refreshToken'),
  ]);
}

async function getStoredToken() {
  return AsyncStorage.getItem('accessToken');
}

async function refreshAccessToken() {
  const refreshToken = await AsyncStorage.getItem('refreshToken');
  if (!refreshToken) throw new Error('No refresh token');

  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    await clearTokens();
    throw new Error('Session expired');
  }

  const data = await res.json();
  await AsyncStorage.setItem('accessToken', data.accessToken);
  return data.accessToken;
}

// ── Core request ──────────────────────────────────────────────────────────────

async function request(method, path, body, retry = true) {
  const token = await getStoredToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    try {
      await refreshAccessToken();
      return request(method, path, body, false);
    } catch {
      throw new Error('Session expired');
    }
  }

  if (res.status === 204) return null;
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
    const refreshToken = await AsyncStorage.getItem('refreshToken');
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
  hostedEvents: (params = {}) => request('GET', `/users/me/hosted-events?${qs(params)}`),
  myRsvps: (params = {}) => request('GET', `/users/me/rsvps?${qs(params)}`),
  getUser: (userId) => request('GET', `/users/${userId}`),
  search: (q) => request('GET', `/users/search?q=${encodeURIComponent(q)}`),
  follow: (userId) => request('POST', `/users/${userId}/follow`),
  unfollow: (userId) => request('DELETE', `/users/${userId}/follow`),
  followers: (userId, params = {}) => request('GET', `/users/${userId}/followers?${qs(params)}`),
  following: (userId, params = {}) => request('GET', `/users/${userId}/following?${qs(params)}`),
};

// ── Events ────────────────────────────────────────────────────────────────────

export const events = {
  create: (data) => request('POST', '/events', data),
  discover: (params = {}) => request('GET', `/events?${qs(params)}`),
  feed: (params = {}) => request('GET', `/events/feed?${qs(params)}`),
  random: (params = {}) => request('GET', `/events/random?${qs(params)}`),
  get: (id) => request('GET', `/events/${id}`),
  update: (id, data) => request('PATCH', `/events/${id}`, data),
  cancel: (id) => request('DELETE', `/events/${id}`),
  rsvp: (id, status) => request('POST', `/events/${id}/rsvp`, { status }),
  updateRsvp: (id, status) => request('PATCH', `/events/${id}/rsvp`, { status }),
  cancelRsvp: (id) => request('DELETE', `/events/${id}/rsvp`),
  attendees: (id, params = {}) => request('GET', `/events/${id}/attendees?${qs(params)}`),
};

// ── Map ───────────────────────────────────────────────────────────────────────

export const map = {
  eventPins: (params = {}) => request('GET', `/map/events?${qs(params)}`),
};
