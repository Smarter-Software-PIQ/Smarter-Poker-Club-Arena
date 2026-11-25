import { expect, test } from '@playwright/test';
import { clubDataReportFixture } from '../helpers/club-data-report-fixture.mjs';

const dates = 'dataStart=2026-11-09&dataEnd=2026-11-15';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
for (const entry of ['Advanced', 'union slug bookmark', 'union UUID bookmark']) {
  test(`union ${entry} opens Advanced with its inclusive dates and BBJ`, async ({ page }) => {
    page.on('pageerror', (error) => {
      throw error;
    });
    const fixture = await clubDataReportFixture();
    await page.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
      })
    );
    const path =
      entry === 'Advanced'
        ? '/clubs/fixture-union/data'
        : `/unions/${entry.includes('UUID') ? id : 'fixture-union'}/data/advanced`;
    await page.goto(`http://club-data.fixture${path}?${dates}#reconciliation`);
    await page.addStyleTag({ content: fixture.css });
    await page.addScriptTag({ content: fixture.javascript });
    if (entry === 'Advanced')
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/clubs/fixture-union/data/advanced\\?${dates}${entry === 'Advanced' ? '&dataGame=ALL&dataStakes=ALL&dataSearch=' : ''}&view=advanced${entry === 'Advanced' ? '$' : '#reconciliation$'}`
      )
    );
    await expect(page.locator('[data-club-data-mode]')).toHaveAttribute(
      'data-club-data-mode',
      'advanced'
    );
    await expect(page.getByRole('button', { name: 'Advanced', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('dl[aria-label="BBJ Totals"]')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Financial Reconciliation' })).toContainText(
      '639.04'
    );
    await page.getByRole('button', { name: 'Simple', exact: true }).click();
    await expect(page.locator('[data-club-data-mode]')).toHaveAttribute(
      'data-club-data-mode',
      'simple'
    );
    await expect(page).toHaveURL(/dataStart=2026-11-09&dataEnd=2026-11-15.*view=simple/);
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await expect(page.locator('[data-club-data-mode]')).toHaveAttribute(
      'data-club-data-mode',
      'advanced'
    );
    const reads = await page.evaluate(() =>
      (window as any).fixtureReads.filter((r: any) => r.fn === 'ca_club_data_snapshot_v2')
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads)
      expect(read.args).toMatchObject({
        p_club_id: id,
        p_start: '2026-11-09',
        p_end: '2026-11-15',
      });
  });
}

test('filtered Report keeps one question through real navigation and breakdown actions', async ({
  page,
}) => {
  const fixture = await clubDataReportFixture();
  await page.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' })
  );
  await page.goto(
    'http://club-data.fixture/clubs/fixture-union/data?dataStart=2026-11-09&dataEnd=2026-11-15&dataGame=OMAHA&dataStakes=HIGH&dataSearch=River'
  );
  await page.addStyleTag({ content: fixture.css });
  await page.addScriptTag({ content: fixture.javascript });
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await expect(page).toHaveURL(/dataGame=OMAHA&dataStakes=HIGH&dataSearch=River/);
  await expect(page.getByRole('region', { name: 'Report Dates And Definitions' })).toContainText(
    'Nov 9, 2026 Through Nov 15, 2026 Pacific Calendar Dates'
  );
  await page.getByRole('button', { name: 'View Contributing Games', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Games', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page).toHaveURL(/dataTab=games/);
  await page.getByRole('button', { name: 'Cross Day Cash', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Contributing Game Source' })).toContainText(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  await page.getByRole('button', { name: 'Close Source Details' }).click();
  const reads = await page.evaluate(() =>
    (window as any).fixtureReads.filter((r: any) => r.fn === 'ca_club_data_snapshot_v2')
  );
  expect(reads.length).toBeGreaterThan(0);
  for (const r of reads)
    expect(r.args).toMatchObject({
      p_start: '2026-11-09',
      p_end: '2026-11-15',
      p_game: 'OMAHA',
      p_stakes: 'HIGH',
      p_search: 'River',
    });
});
