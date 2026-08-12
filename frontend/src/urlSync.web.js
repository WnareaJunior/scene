// URL <-> screen sync — web implementation. A deliberately tiny router:
// four paths (/login, /signup, /feed, /profile), no params, no nesting.
// History API + a listener set; popstate covers back/forward.
//
// EXPO_PUBLIC_WEB_BASE_PATH supports hosting under a subpath (GitHub Pages
// project sites live at /<repo>/). App code only ever sees base-stripped
// paths; the base is re-attached on write. Unset (local dev, CI e2e,
// root-hosted deploys) every transform below is an identity.
export const isWeb = true;

// e.g. '/scene' — no trailing slash. Inlined at build time by Expo.
const BASE = (process.env.EXPO_PUBLIC_WEB_BASE_PATH || '').replace(/\/$/, '');

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(getPath()));
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
}

export function getPath() {
  const p = window.location.pathname;
  if (BASE && p.startsWith(BASE)) {
    return p.slice(BASE.length) || '/';
  }
  return p;
}

export function replacePath(path) {
  if (getPath() === path) return;
  window.history.replaceState(null, '', BASE + path);
  notify();
}

export function pushPath(path) {
  if (getPath() === path) return;
  window.history.pushState(null, '', BASE + path);
  notify();
}

export function onPathChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
