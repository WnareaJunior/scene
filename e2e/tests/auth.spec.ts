import { test, expect } from '@playwright/test';
import { CREDS, uniqueUser } from './helpers';

// Auth flows run with a clean context (no storageState) — these are the only
// tests that exercise the login/signup UI itself.

test('A1: signup happy path lands on the feed', async ({ page }) => {
  const user = uniqueUser('a1');
  await page.goto('/signup');
  await page.getByTestId('auth-username-input').fill(user.username);
  await page.getByTestId('auth-email-input').fill(user.email);
  await page.getByTestId('auth-password-input').fill(user.password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/feed');
  await expect(page.getByTestId('feed-list')).toBeVisible();
});

test('A2: signup validation errors are inline, no navigation', async ({ page }) => {
  await page.goto('/signup');
  await page.getByTestId('auth-username-input').fill('e2e_validation');
  await page.getByTestId('auth-email-input').fill('not-an-email');
  await page.getByTestId('auth-password-input').fill('short');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-email-error')).toBeVisible();
  await expect(page.getByTestId('auth-password-error')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/signup');
  await expect(page.getByTestId('feed-list')).not.toBeVisible();
});

test('A3: signup with an existing email surfaces a clear error', async ({ page }) => {
  const user = uniqueUser('a3');
  await page.goto('/signup');
  await page.getByTestId('auth-username-input').fill(user.username);
  await page.getByTestId('auth-email-input').fill(CREDS.email);
  await page.getByTestId('auth-password-input').fill(user.password);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-form-error')).toContainText(/already taken/i);
  expect(new URL(page.url()).pathname).toBe('/signup');
});

test('A4: login happy path lands on the feed', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('auth-email-input').fill(CREDS.email);
  await page.getByTestId('auth-password-input').fill(CREDS.password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/feed');
  await expect(page.getByTestId('feed-list')).toBeVisible();
});

test('A5: wrong password shows an error and stays on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('auth-email-input').fill(CREDS.email);
  await page.getByTestId('auth-password-input').fill('definitely-wrong-password');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-form-error')).toContainText(/invalid credentials/i);
  expect(new URL(page.url()).pathname).toBe('/login');
});

test('A6: session survives a page reload', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('auth-email-input').fill(CREDS.email);
  await page.getByTestId('auth-password-input').fill(CREDS.password);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('feed-list')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('feed-list')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/feed');
});

test('A7: logout returns to login and locks the feed', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('auth-email-input').fill(CREDS.email);
  await page.getByTestId('auth-password-input').fill(CREDS.password);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('feed-list')).toBeVisible();

  await page.getByTestId('nav-profile').click();
  await page.getByTestId('profile-signout').click();
  await page.waitForURL('**/login');

  await page.goto('/feed');
  await page.waitForURL('**/login');
  await expect(page.getByTestId('auth-submit')).toBeVisible();
});

test('A8: hitting an authed route unauthenticated redirects to login', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForURL('**/login');
  await expect(page.getByTestId('auth-submit')).toBeVisible();
});
