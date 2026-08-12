// URL <-> screen sync — web implementation. A deliberately tiny router:
// four paths (/login, /signup, /feed, /profile), no params, no nesting.
// History API + a listener set; popstate covers back/forward.
export const isWeb = true;

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(getPath()));
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
}

export function getPath() {
  return window.location.pathname;
}

export function replacePath(path) {
  if (getPath() === path) return;
  window.history.replaceState(null, '', path);
  notify();
}

export function pushPath(path) {
  if (getPath() === path) return;
  window.history.pushState(null, '', path);
  notify();
}

export function onPathChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
