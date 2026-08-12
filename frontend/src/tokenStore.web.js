// Token persistence — web implementation. localStorage, not httpOnly cookies:
// an accepted v1 tradeoff (documented in the e2e handoff notes) so the existing
// Bearer-token API client works unchanged. Revisit before public launch.
//
// Async signatures mirror tokenStore.js so api.js stays platform-agnostic.
const ACCESS_KEY = 'scene.accessToken';
const REFRESH_KEY = 'scene.refreshToken';

export async function getAccessToken() {
  return window.localStorage.getItem(ACCESS_KEY);
}

export async function getRefreshToken() {
  return window.localStorage.getItem(REFRESH_KEY);
}

export async function setAccessToken(token) {
  window.localStorage.setItem(ACCESS_KEY, token);
}

export async function saveTokens({ accessToken, refreshToken }) {
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export async function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}
