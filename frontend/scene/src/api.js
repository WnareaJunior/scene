import * as SecureStore from 'expo-secure-store';

const BASE_URL = 'https://scene-19ss.onrender.com/api/v1';

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
  await SecureStore.setItemAsync('accessToken', data.accessToken);
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
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
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
  uploadAvatar: async (imageUri) => {
    const token = await SecureStore.getItemAsync('accessToken');
    const filename = imageUri.split('/').pop();
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    const formData = new FormData();
    formData.append('avatar', { uri: imageUri, name: filename, type });
    const res = await fetch(`${BASE_URL}/users/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Avatar upload failed');
    }
    return res.json();
  },
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
  uploadImage: async (imageUri) => {
    const token = await SecureStore.getItemAsync('accessToken');
    const filename = imageUri.split('/').pop();
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    const formData = new FormData();
    formData.append('image', { uri: imageUri, name: filename, type });
    const res = await fetch(`${BASE_URL}/events/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Image upload failed');
    }
    return res.json();
  },
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
