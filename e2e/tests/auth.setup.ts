import { test as setup, expect } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';
import { CREDS } from './helpers';

// Logs in once through the real UI and saves storageState (the app keeps its
// tokens in localStorage on web). feed.spec and profile.spec reuse it, so only
// auth.spec exercises the login form.
setup('authenticate as the seeded account', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('auth-email-input').fill(CREDS.email);
  await page.getByTestId('auth-password-input').fill(CREDS.password);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('feed-list')).toBeVisible({ timeout: 60_000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
