// Scene palette — "The Unlisted Map" (DESIGN.md).
// One streetlight: amber marks what you can act on; everything else recedes.
// Grays here differ from DESIGN.md's ink-hint/ink-meta on purpose: #555/#666
// fail WCAG on every surface in the app (2.3–3.4:1). inkSecondary passes 4.5:1
// on all four dark surfaces; inkFaint is for ≥18pt/decorative text only (≥3:1).
export const COLORS = {
  amber: '#ffa028',
  amberPressed: '#e08010',
  amberTint: '#2b1d0a',
  amberInk: '#1a0d00',

  void: '#000000',
  asphalt: '#0a0a0a',
  surface: '#111111',
  card: '#1a1a1a',
  border: '#2a2a2a',
  divider: '#1c1c1e',
  handle: '#3a3a3c', // drag handles + non-text ornaments only

  ink: '#ffffff',
  inkSecondary: '#8e8e93',
  inkFaint: '#6e6e73',

  liveGreen: '#22c55e',
  errorRed: '#ef4444',

  scrim: 'rgba(0,0,0,0.55)',
};
