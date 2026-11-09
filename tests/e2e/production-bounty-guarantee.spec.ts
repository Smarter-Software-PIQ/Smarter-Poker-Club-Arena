import { expect, test, type Page } from '@playwright/test';

// Read-only proof of the corrected event, including awards paid before correction.
const PLACE_AWARDS = [
  940.14, 539.77, 390.47, 310.08, 259.39, 224.14, 198.01, 178.21, 161.97, 148.9, 138.21, 128.71,
  152.5, 143.5, 136,
];

async function verifyRewards(page: Page) {
  await expect(page.locator('.tournament-blurb')).toContainText(
    'Entry: 26 Prize Pool + 10 Bounty + 4 Rake.',
    { timeout: 30_000 }
  );
  await page.getByRole('tab', { name: 'Rewards', exact: true }).click();
  await expect(page.locator('.rw-pool__value')).toHaveText('5,000');
  await expect(page.getByText('1,580 Overlay', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Only 3,420 prize contributions count; the 380 rake is excluded.
  // Historical house funding remains posted; it is not the credit basis.
  await expect(page.getByText('Credited Toward The Guarantee', { exact: true })).toBeVisible();
  await expect(page.getByText('3,420 Of 5,000', { exact: true })).toBeVisible();
  await expect(page.getByText('Guarantee Met', { exact: true })).toHaveCount(0);

  // The first list is the place ladder. A later list may contain bounty-only winners.
  const rows = page.locator('.rw-list').first().locator(':scope > .rw-row');
  await expect(rows).toHaveCount(15);
  for (const [index, award] of PLACE_AWARDS.entries()) {
    const place = index + 1;
    const rank = `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'}`;
    const row = rows.nth(index);
    await expect(row.locator(':scope > .rw-rank')).toHaveText(rank);
    await expect(row.locator(':scope > .rw-row__mid .rw-pct')).toHaveText(
      `${Number(((award / 4050) * 100).toFixed(2))}%`
    );
    // The lobby deliberately rounds chips. A finisher adds bounties to Total,
    // so verify Place Prize instead; either shape may appear as the event advances.
    const placeValue = row.locator(':scope > .rw-award > .rw-pct:first-child, :scope > .rw-prize');
    await expect(placeValue).toHaveText(new RegExp(`^(?:Place Prize )?${Math.round(award)}$`));
  }
}

test('the reported bounty event shows all corrected payouts and actual house overlay', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('tournaments/6b72abc3-bd16-488c-aea5-54b1eace98d5', {
    waitUntil: 'domcontentloaded',
  });
  await verifyRewards(page);
  await page.screenshot({ path: 'e2e-report/bounty-guarantee.png', fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await verifyRewards(page);
  await page.screenshot({ path: 'e2e-report/bounty-guarantee-reloaded.png', fullPage: true });
});

async function verifyCompletedSupplement(page: Page) {
  await expect(page.locator('.tournament-blurb')).toContainText(
    'Entry: 26 Prize Pool + 10 Bounty + 4 Rake.',
    { timeout: 30_000 }
  );
  await page.getByRole('tab', { name: 'Rewards', exact: true }).click();
  await expect(page.locator('.rw-pool__value')).toHaveText('2,412');
  await expect(page.getByText('88 Overlay', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('2,412 Of 2,500', { exact: true })).toBeVisible();
  await expect(
    page.getByText('88 Promo Paid Separately To The Finishers After Completion', { exact: true })
  ).toBeVisible();
  await expect(page.locator('.rw-mix__label').filter({ hasText: /^Club Overlay$/ })).toHaveCount(0);
}

test('the completed 88-chip shortfall shows the paid supplement and preserves its sealed pool', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('tournaments/f22ceae6-2850-40ef-8f97-7d3660be32a3', {
    waitUntil: 'domcontentloaded',
  });
  await verifyCompletedSupplement(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await verifyCompletedSupplement(page);
});
