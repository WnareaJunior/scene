import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';
import { CREDS } from './helpers';

test.use({ storageState: STORAGE_STATE });

test('C1: own profile shows the seeded username and bio', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByTestId('profile-username')).toHaveText(CREDS.username, { timeout: 60_000 });
  // Exact seeded copy isn't asserted — C2 rewrites the bio and restores it,
  // so a mid-run crash could leave a stamped value behind. Non-empty is the contract.
  await expect(page.getByTestId('profile-bio')).not.toHaveText('');
});

// The profile screen renders the cached login user, then refreshes from
// GET /users/me. Wait for that refresh so `original` is the server's bio, not
// a stale cached one (against a remote API it can take seconds).
const meLoaded = (page: import('@playwright/test').Page) =>
  page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith('/users/me'),
    { timeout: 60_000 },
  );

test('C2: edited bio persists across a reload, then is restored', async ({ page }) => {
  const loaded = meLoaded(page);
  await page.goto('/profile');
  await loaded;
  const input = page.getByTestId('profile-bio-input');
  await expect(input).toBeVisible({ timeout: 60_000 });
  const original = await input.inputValue();

  const stamped = `e2e bio ${Date.now()}`;
  // Real keystrokes, not fill(): on chromium, fill() sets the textarea's DOM
  // value without react-native-web's state seeing it, so the save would send
  // the old bio. Typing is what users do and works on every engine.
  await input.click();
  await input.clear();
  await input.pressSequentially(stamped);
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-saved')).toBeVisible();

  const reloaded = meLoaded(page);
  await page.reload();
  await reloaded;
  await expect(page.getByTestId('profile-bio')).toHaveText(stamped, { timeout: 60_000 });

  // Restore so the test is re-runnable and other tests see a stable account.
  const restoreInput = page.getByTestId('profile-bio-input');
  await restoreInput.click();
  await restoreInput.clear();
  await restoreInput.pressSequentially(original);
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-saved')).toBeVisible();
});
