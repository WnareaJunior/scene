import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

export const STORAGE_STATE = path.join(__dirname, '.auth/user.json');

const WEB_URL = process.env.E2E_WEB_URL || 'http://localhost:4173';

export default defineConfig({
  testDir: './tests',
  // One worker, always: every test shares a single seeded account and a
  // rate-limited auth API — parallel projects would race on both (e.g. C2's
  // bio write vs C1's bio read).
  workers: 1,
  fullyParallel: false,
  // A test that needs retries to pass gets fixed or deleted; retry once in CI
  // only to buy the trace on genuine infra flakes.
  retries: process.env.CI ? 1 : 0,
  // Render's free tier cold-starts in ~30-60s; the app's fetch layer retries,
  // so give tests room before calling that a failure.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    // Injected at the network layer (not by page JS, so no CORS preflight
    // involvement): lets a test-enabled API deploy skip its auth rate limiter.
    extraHTTPHeaders: process.env.E2E_KEY ? { 'x-e2e-key': process.env.E2E_KEY } : {},
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'] },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      dependencies: ['setup'],
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // -s = SPA fallback: /login, /feed etc. all rewrite to index.html.
    command: `npx serve -s ../frontend/dist -l 4173`,
    url: WEB_URL,
    reuseExistingServer: !process.env.CI,
  },
});
