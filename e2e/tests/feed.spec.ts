import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';

test.use({ storageState: STORAGE_STATE });

test('B1: feed loads with visible posts showing author and content', async ({ page }) => {
  await page.goto('/feed');
  const cards = page.getByTestId('feed-post-card');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });

  const first = cards.first();
  // Author (host @username) and content (the card's title text) both render.
  await expect(first.getByTestId('feed-post-host')).toContainText(/@\w+/);
  expect((await first.innerText()).trim().length).toBeGreaterThan(0);
});

test('B2: reaching the end of the feed loads more posts', async ({ page }) => {
  await page.goto('/feed');
  const cards = page.getByTestId('feed-post-card');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  const before = await cards.count();
  expect(before).toBeGreaterThanOrEqual(20); // needs a full first page — see README seeding notes

  // Scroll the list to the bottom — programmatic scrollTo fires the same
  // scroll events a user's gesture does, which triggers the feed's
  // near-bottom pagination. (A visible "more parties" button also exists as
  // a human-facing fallback/retry; the test doesn't depend on it.)
  // scrollTop assignment, not el.scrollTo(): scrollTo is silently ignored on
  // react-native-web's scroll container, while the property write both moves
  // the list and fires the scroll event on every engine.
  await page.getByTestId('feed-list').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(async () => cards.count()).toBeGreaterThan(before);
});
