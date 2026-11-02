import { expect, test } from '@playwright/test';

// Read-only regression for the owner-reported event. Its finalized award is
// preserved; the incorrect entry copy and guarantee-met claim must disappear.
test('the reported bounty event shows charged terms and its actual house overlay', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('tournaments/6b72abc3-bd16-488c-aea5-54b1eace98d5', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('.tournament-blurb')).toContainText(
    'Entry: 26 Prize Pool + 10 Bounty + 4 Rake.',
    { timeout: 30_000 }
  );
  await page.getByRole('button', { name: 'Rewards', exact: true }).click();
  await expect(page.locator('.rw-pool__value')).toHaveText('5,950');
  await expect(page.getByText('2,530 Overlay', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('3,420 Of 5,000', { exact: true })).toBeVisible();
  await expect(page.getByText('Guarantee Met', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'e2e-report/bounty-guarantee.png', fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.tournament-blurb')).toContainText(
    '26 Prize Pool + 10 Bounty + 4 Rake.',
    { timeout: 30_000 }
  );
});
