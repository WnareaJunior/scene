// Token persistence — native implementation (SecureStore, encrypted on-device).
// The web build resolves tokenStore.web.js instead; keep both files' exports
// identical.
import * as SecureStore from 'expo-secure-store';

export function getAccessToken() {
  return SecureStore.getItemAsync('accessToken');
}

export function getRefreshToken() {
  return SecureStore.getItemAsync('refreshToken');
}

export function setAccessToken(token) {
  return SecureStore.setItemAsync('accessToken', token);
}

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
