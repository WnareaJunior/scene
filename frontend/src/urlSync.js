// URL <-> screen sync — native implementation: all no-ops. The app's swipe
// navigation has no URL concept; only the web build (urlSync.web.js) maps
// paths to screens.
export const isWeb = false;

export function getPath() {
  return null;
}

export function replacePath() {}

export function pushPath() {}

// Returns an unsubscribe function, like its web counterpart.
export function onPathChange() {
  return () => {};
}
