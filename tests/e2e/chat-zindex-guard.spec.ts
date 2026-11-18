import { test, expect } from '@playwright/test';

test('chat button z-index is 105', async ({ page }) => {
  await page.goto('/table'); // Assuming this lands on the table
  // Locate the collapsed chat button
  const chatButton = page.locator('.chat-collapsed');
  await expect(chatButton).toBeVisible();

  // Verify z-index
  const zIndex = await chatButton.evaluate((el) => window.getComputedStyle(el).zIndex);
  expect(zIndex).toBe('105');
});
