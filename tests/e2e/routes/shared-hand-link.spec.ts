/**
 * A SHARED HAND LINK OPENS THE SENDER'S HAND (2026-11-06).
 *
 * Reported by players: Chris sent Art a hand link and Mongo sent one to Burls,
 * and each recipient landed on his OWN hand history. The popup's Link button
 * copied the archive address (`hand-history?hand=<id>`), which reads under RLS
 * and so only ever opens for the players dealt into the hand. Link now copies
 * the self-contained replay (`replay?h=<payload>`) the Share sheet sends.
 *
 * Production checks, run after every publish from this directory:
 *   1. The replay a sender's link carries opens that exact hand for whoever
 *      taps it, and names the sender rather than telling the viewer "Yours".
 *   2. An old archive link to a hand the signed-in viewer was not dealt into
 *      shows the explanatory note and NOTHING of the viewer's own records.
 *
 * The fixture is hand #56019216 (production), a hand a human was dealt into,
 * which the retention policy keeps for good. The payload below is exactly what
 * the shipped Link button produced for its sender, Mongo: his own folded K-4
 * marked private, the two holdings the table saw, no cards for the folders.
 */
import { expect, test } from '@playwright/test';

const HAND_ID = '2c604730-39ac-445f-b777-2592785024d6';
const PAYLOAD =
  'djR-TkxIfjAuMjUtMC41fjZ-bXc1ZWI3MHB-MTpUVzl1WjI4OmNlbTptSzpocDo6OzI6Y0dGdVkyRnJaVGs1Ojg5MjpJTzo6U0dsbmFDQkRZWEprOjszOlEyaGhaQTo4Mmo6Ojo6OzQ6UVc1a2NtVktjZzo5emI6Ojo6OzU6ZUhKaGRBOjZwbDo6Ojo7NjpWbVZuWVhOZlQzZGxiZzo0M2c6W1c6dzpTR2xuYUNCRFlYSms6N3J-MVNwLDJHMWUsMk4xZSEsM0YsNEYsNUYsNlIzcSwxRiwyQzJjfl1lR3wyWCw2WH5xfDJYLDZYflR8MlgsNlh-OWp-Njo3cjo6OlNHbG5hQ0JEWVhKa35Ua3hJSURBdU1qVXZNQzQxTUNCTWFXZG9kRzVwYm1jZ1IyRnRaWE1-fn5OVFl3TVRreU1UWX5-Y35-';

test.describe("A shared hand link opens the sender's hand", () => {
  test('the replay a sender shares opens that exact hand and names the sender', async ({
    page,
  }) => {
    await page.goto(`replay?h=${PAYLOAD}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/auth(?:\/|\?|$)/);
    await expect(page.getByText('Hand #56019216')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Shared From Mongo's Hand History", { exact: false })
    ).toBeVisible();
    await expect(page.locator('.hr-seat__private')).toHaveText("Mongo's");
    await expect(page.locator('body')).not.toContainText('Yours');
  });

  test.describe('a signed-out viewer', () => {
    // A fresh context: no stored session, as a friend opening the link has.
    test.use({ storageState: { cookies: [], origins: [] } });

    test("is offered Create Account through the sender's invite code", async ({ page }) => {
      await page.goto(`replay?h=${PAYLOAD}&i=HSTAAAA`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Hand #56019216')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Mongo Invited You')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create Account' })).toHaveAttribute(
        'href',
        '/i/HSTAAAA'
      );
      await expect(page.getByRole('link', { name: 'Sign In' })).toHaveAttribute(
        'href',
        /^\/auth\/login\?redirect=/
      );
    });
  });

  test.describe('an old archive link to a hand the viewer was not dealt into', () => {
    test.skip(
      !process.env.SP_EMAIL || !process.env.SP_PASS,
      'Reserved authenticated production fixture is required.'
    );

    test("shows the note and none of the viewer's own records", async ({ page }) => {
      await page.goto(`hand-history?hand=${HAND_ID}`, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/\/auth(?:\/|\?|$)/, { timeout: 30_000 });
      await expect(
        page.getByText('That Hand Belongs To Another Player', { exact: false })
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('button', { name: 'Show My Hands' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ask For A Share Link' })).toBeVisible();
      await expect(page.locator('.hands-list')).toHaveCount(0);
      await expect(page.locator('.hh-summary')).toHaveCount(0);
      await expect(page.locator('.load-more-btn')).toHaveCount(0);
    });
  });
});
