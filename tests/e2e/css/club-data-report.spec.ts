import { expect, test } from '@playwright/test';
import { clubDataReportFixture } from '../helpers/club-data-report-fixture.mjs';

const dates = 'dataStart=2026-11-09&dataEnd=2026-11-15';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
for (const entry of [
  'Open Club Report',
  'club bookmark',
  'union slug bookmark',
  'union UUID bookmark',
]) {
  test(`union ${entry} opens the inline report with its inclusive dates and BBJ`, async ({
    page,
  }) => {
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
      entry === 'Open Club Report'
        ? '/clubs/fixture-union/data'
        : entry === 'club bookmark'
          ? '/clubs/fixture-union/data/advanced'
          : `/unions/${entry.includes('UUID') ? id : 'fixture-union'}/data/advanced`;
    await page.goto(`http://club-data.fixture${path}?${dates}#reconciliation`);
    await page.addStyleTag({ content: fixture.css });
    await page.addScriptTag({ content: fixture.javascript });
    if (entry === 'Open Club Report') {
      const openReport = page.getByRole('button', { name: 'Open Club Report', exact: true });
      await expect(openReport).toBeVisible();
      await expect(page.getByRole('button', { name: /^(Simple|Advanced)$/ })).toHaveCount(0);
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 850 });
        const edges = await page.locator('.arena-workspace').evaluate((workspace) => {
          const shell = workspace.parentElement!.getBoundingClientRect();
          const mast = workspace.querySelector('.arena-workspace-mast')!.getBoundingClientRect();
          const cases = [...workspace.querySelectorAll('.arena-case')].map((section) =>
            section.getBoundingClientRect()
          );
          return {
            available: shell.width,
            used: workspace.getBoundingClientRect().width,
            cases: cases.map((r) =>
              Math.max(Math.abs(r.left - mast.left), Math.abs(r.right - mast.right))
            ),
          };
        });
        expect(Math.abs(edges.available - edges.used)).toBeLessThanOrEqual(1);
        expect(edges.cases).toHaveLength(3);
        for (const error of edges.cases) expect(error).toBeLessThanOrEqual(1);
      }
      await openReport.click();
    }
    const report = page.getByRole('region', { name: 'Club Report', exact: true });
    await expect(page).toHaveURL(/\/clubs\/fixture-union\/data\?/);
    const opened = new URL(page.url());
    expect(opened.searchParams.get('report')).toBe('open');
    expect(opened.searchParams.get('dataEnd')).toBe('2026-11-15');
    expect(opened.hash).toBe(entry === 'Open Club Report' ? '' : '#reconciliation');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Club Data', exact: true })
    ).toHaveCount(1);
    await expect(report.locator('dl[aria-label="BBJ Totals"]')).toBeVisible();
    await expect(report.getByRole('region', { name: 'Financial Reconciliation' })).toContainText(
      '639.04'
    );
    await page.getByRole('button', { name: 'Close Club Report' }).click();
    await expect(report).toHaveCount(0);
    await expect(page).not.toHaveURL(/report=open/);
    await page.goBack();
    await expect(report.locator('dl[aria-label="BBJ Totals"]')).toBeVisible();
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
  await page.getByRole('button', { name: 'Open Club Report', exact: true }).click();
  await expect(page).toHaveURL(/dataGame=OMAHA&dataStakes=HIGH&dataSearch=River/);
  const report = page.getByRole('region', { name: 'Club Report', exact: true });
  await expect(report.getByRole('region', { name: 'Report Dates And Definitions' })).toContainText(
    'Nov 9, 2026 Through Nov 15, 2026 Pacific Calendar Dates'
  );
  await report.getByRole('button', { name: 'View Contributing Games', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Games', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page).toHaveURL(/dataTab=games/);
  await report.getByRole('button', { name: 'Cross Day Cash', exact: true }).click();
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

test('daily and inline report share rolling presets and saved filters through reload', async ({
  page,
}) => {
  const fixture = await clubDataReportFixture();
  await page.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' })
  );
  await page.addInitScript(() => {
    (window as any).fixturePreferences = {
      'club/ClubDataSimplePage:game': 'OMAHA',
      'club/ClubDataPage:game': 'HOLDEM',
    };
  });
  await page.goto('http://club-data.fixture/clubs/fixture-union/data/advanced');
  const mount = async () => {
    await page.addStyleTag({ content: fixture.css });
    await page.addScriptTag({ content: fixture.javascript });
  };
  const windows = () =>
    page.evaluate(() => {
      const reads = (window as any).fixtureReads ?? [];
      return ['ca_club_data_screen', 'ca_club_data_snapshot_v2'].map((fn) => {
        const a = reads.filter((r: any) => r.fn === fn).at(-1)?.args;
        return a ? [1 + (Date.parse(a.p_end) - Date.parse(a.p_start)) / 86400000, a.p_game] : null;
      });
    });
  await mount();
  const report = page.getByRole('region', { name: 'Club Report', exact: true });
  await report.getByRole('button', { name: '30 Days', exact: true }).click();
  await expect.poll(windows).toEqual([
    [30, 'OMAHA'],
    [30, 'OMAHA'],
  ]);
  const daily = page
    .locator('section.arena-case')
    .filter({ has: page.getByRole('group', { name: 'Date Range', exact: true }) })
    .last();
  await daily.getByRole('button', { name: '7 Days', exact: true }).click();
  await expect.poll(windows).toEqual([
    [7, 'OMAHA'],
    [7, 'OMAHA'],
  ]);
  await page.goBack();
  await expect.poll(windows).toEqual([
    [30, 'OMAHA'],
    [30, 'OMAHA'],
  ]);
  await page.reload();
  await mount();
  await expect.poll(windows).toEqual([
    [30, 'OMAHA'],
    [30, 'OMAHA'],
  ]);
});

test('opening the report keeps Today live while dated bookmarks stay pinned at Pacific midnight', async ({
  page,
}) => {
  const fixture = await clubDataReportFixture();
  await page.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' })
  );
  const lastEnds = () =>
    page.evaluate(() =>
      ['ca_club_data_screen', 'ca_club_data_snapshot_v2'].map(
        (fn) => (window as any).fixtureReads?.filter((r: any) => r.fn === fn).at(-1)?.args.p_end
      )
    );
  for (const pinned of [false, true]) {
    await page.clock.setFixedTime(new Date('2026-11-24T18:00:00Z'));
    await page.goto(
      'http://club-data.fixture/clubs/fixture-union/data' + (pinned ? '?dataEnd=2026-11-24' : '')
    );
    await page.addStyleTag({ content: fixture.css });
    await page.addScriptTag({ content: fixture.javascript });
    await page.getByRole('button', { name: 'Open Club Report', exact: true }).click();
    await expect.poll(lastEnds).toEqual(['2026-11-24', '2026-11-24']);
    await page.clock.setFixedTime(new Date('2026-11-25T08:00:01Z'));
    await page.evaluate(() => {
      (window as any).fixtureReads = [];
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const end = pinned ? '2026-11-24' : '2026-11-25';
    await expect.poll(lastEnds).toEqual([end, end]);
  }
});
