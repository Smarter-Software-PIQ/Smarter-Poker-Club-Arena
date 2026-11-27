/** Render the production roster stylesheet inside a narrower application shell.
 * Document overflow alone misses controls hidden by the page's overflow clip. */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { measureMobileTapTargets } from '../support/mobileTapTargets';
import { rosterCardPitchFor } from '../../../src/lib/rosterCardPitch';

const CSS = readFileSync(resolve(process.cwd(), 'src/pages/ClubMembersPage.css'), 'utf8');
const ADMIN_CSS = readFileSync(
  resolve(process.cwd(), 'src/components/admin/ClubMemberManagement.css'),
  'utf8'
);
const PAGE_BAR_CSS = readFileSync(
  resolve(process.cwd(), 'src/components/help/PageHelp.css'),
  'utf8'
);

const DATA_CSS = readFileSync(
  resolve(process.cwd(), 'src/pages/club/ClubDataSimplePage.module.css'),
  'utf8'
);
const GLOBAL_CSS = ['club-engine.css', 'animations.css', 'metallic-popups.css']
  .map((name) => readFileSync(resolve(process.cwd(), 'src/styles', name), 'utf8'))
  .join('\n');
for (const width of [320, 375, 393]) {
  test(`Club Data total controls retain a full thumb target at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 812 });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;600;700&family=Inter:wght@400;600;700&display=swap"><style>${GLOBAL_CSS}\n${DATA_CSS}
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; background: #000; font-family: Inter, sans-serif; }
      main { padding-top: 60px; }
    </style><main id="main-content" class="page"><dl class="stats">
      <div class="stat"><dt class="statLabel">Games</dt><dd class="statValue">100</dd></div>
      ${['Total Winnings', 'MTT Winnings', 'Fee'].map((label) => `<div class="stat"><dt class="statLabel"><button class="statAction">${label}</button></dt><dd class="statValue">1,000</dd></div>`).join('')}
    </dl><section aria-label="Financial Reconciliation" style="height:80px">Reconciliation</section></main>`);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    expect(
      await page.evaluate(async () => (await document.fonts.load('11px "Roboto Condensed"')).length)
    ).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('club-data-targets.png') });
    const measured = await page.evaluate(measureMobileTapTargets, { REACH: 20 });
    expect(measured.n).toBe(3);
    expect(measured.unmeasured).toEqual([]);
    expect(measured.out).toEqual([]);
  });
}

// The real PageBar prints controls before its title. Include its owning sheet:
// roster-only fixtures cannot detect a title painted over the Advanced button.
for (const width of [320, 375, 393, 568, 1440]) {
  for (const textScale of [100, 200]) {
    test(`page titles and live actions remain reachable at ${width}px and ${textScale}% text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.setContent(`
        <style>${CSS}\n${PAGE_BAR_CSS}
          *, *::before, *::after { box-sizing: border-box; }
          html { font-size: ${textScale}%; }
          body { margin: 0; background: #000; color: #fff; }
          main { width: calc(100% - 32px); margin: auto; }
        </style>
        <main><header class="ca-page-bar members-page-bar">
          <div class="ca-page-bar__live"><div class="members-mode-toggle">
            <button type="button">Simple</button><button type="button">Advanced</button>
          </div></div>
          <h1 class="ca-page-bar__title">Player Management</h1>
          <button type="button" class="ca-page-help" aria-label="Page Help">?</button>
        </header></main>`);
      const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
      await advanced.click({ timeout: 1500 });
      await page.getByRole('button', { name: 'Page Help', exact: true }).click({ timeout: 1500 });
      for (const title of ['Player Management', 'Monthly Challenges']) {
        await page.locator('h1').evaluate((heading, text) => {
          heading.textContent = text;
        }, title);
        const geometry = await page.locator('h1').evaluate((heading) => {
          const box = heading.getBoundingClientRect();
          const bar = heading.parentElement!.getBoundingClientRect();
          return {
            inside: box.left >= bar.left - 1 && box.right <= bar.right + 1,
            readable: heading.scrollWidth <= heading.clientWidth + 1,
            centerError: Math.abs((box.left + box.right - bar.left - bar.right) / 2),
          };
        });
        expect(geometry.inside, `${title} escapes its page at enlarged text`).toBe(true);
        expect(geometry.readable, `${title} clips its text`).toBe(true);
        expect(geometry.centerError, `${title} is not centered`).toBeLessThanOrEqual(1);
      }
      await page.locator('h1').evaluate((heading) => heading.remove());
      await advanced.click({ timeout: 1500 });
      const [live, help] = await Promise.all([
        page.locator('.ca-page-bar__live').boundingBox(),
        page.getByRole('button', { name: 'Page Help', exact: true }).boundingBox(),
      ]);
      expect(live).not.toBeNull();
      expect(help).not.toBeNull();
      expect(live!.y, 'mode controls must sit below Page Help').toBeGreaterThanOrEqual(
        help!.y + help!.height
      );
      const mode = await page.locator('.members-mode-toggle').boundingBox();
      expect(mode).not.toBeNull();
      expect(
        Math.abs(mode!.x + mode!.width - help!.x - help!.width),
        'mode controls must align with the right edge of Page Help'
      ).toBeLessThanOrEqual(1);
    });
  }
}

for (const width of [375, 393]) {
  test(`Simple roster fields avoid phone zoom and fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.setContent(`
      <style>${CSS}
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; background: #000; }
        .application-shell { width: calc(100% - 32px); margin: auto; }
      </style>
      <main class="application-shell"><section class="club-members-page members-simple">
        <section class="members-console">
          <label class="members-search"><input type="search" aria-label="Search Club Members" /></label>
          <div class="members-toolbar">
            <button class="members-group-role">Group By Role</button>
            <label class="members-sort members-winloss-period"><span class="members-sort__label">Win / Loss</span>
              <select aria-label="Win And Loss Period"><option>Win / Loss This Week</option></select></label>
            <label class="members-sort"><span class="members-sort__label">Sort By</span>
              <select aria-label="Sort Players"><option>Active Now</option></select></label>
          </div>
        </section>
      </section></main>`);
    for (const field of [
      page.getByRole('searchbox'),
      ...(await page.getByRole('combobox').all()),
    ]) {
      expect(
        await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
      ).toBe(16);
    }
    const toolbar = await page.locator('.members-toolbar').boundingBox();
    expect(toolbar).not.toBeNull();
    for (const control of [
      page.getByRole('button', { name: 'Group By Role' }),
      ...(await page.getByRole('combobox').all()),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(toolbar!.x - 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(toolbar!.x + toolbar!.width + 0.5);
      expect(
        await control.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
  });
}

for (const width of [1449, 375, 393]) {
  test(`roster surfaces and controls fit their containing page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.setContent(`
      <style>
        ${CSS}
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; background: #000; }
        .application-shell { width: calc(100% - ${width > 720 ? 97 : 32}px); margin: auto; }
      </style>
      <main class="application-shell"><section class="club-members-page">
        <header class="ca-page-bar members-page-bar"><h1 class="ca-page-bar__title">Player Management</h1><div class="ca-page-bar__live"><div class="members-mode-toggle"><button>Simple</button><button>Advanced</button></div></div><button class="ca-page-help" aria-label="Page Help"></button></header>
        <button class="members-export">Club Transaction History</button>
        <section class="members-console">
          <div class="members-console__heading"><h2>Find A Player</h2></div>
          <label class="members-search"><span>Search Players</span>
            <input type="search" aria-label="Search Club Members" placeholder="Search Name, Number, Club, Or Upline" /></label>
          <div class="members-toolbar">
            <label class="members-sort"><span class="members-sort__label">Sort</span>
              <select aria-label="Sort Players"><option>Role Hierarchy</option></select></label>
            <button class="members-select-loaded">Select Loaded</button>
            <details class="members-columns"><summary>Columns</summary></details>
            <button class="members-export">Export CSV</button>
          </div>
        </section>
        <div class="members-bulk"><strong>1 Player Selected</strong><button>Clear</button></div>
        <section class="members-list" role="list" aria-label="Club Member Directory">
          <div class="member-row" role="listitem"><div class="member-row__open"><button class="member-row__record" aria-label="Open Alice"></button><span class="member-avatar">A</span><span class="member-main"><span class="member-identity"><span class="member-alias">Alice</span></span><span class="member-subline"><button class="member-seated member-seated--table">Watch At Table</button></span></span><span class="member-chevron">&rsaquo;</span></div></div>
        </section>
        <div class="members-count">Loaded 1 Of 1 Players</div>
      </section></main>`);
    const frame = await page.locator('.club-members-page').boundingBox();
    expect(frame).not.toBeNull();
    const shell = await page.locator('.application-shell').boundingBox();
    expect(shell).not.toBeNull();
    expect(
      frame!.x,
      'the roster page escapes its application shell on the left'
    ).toBeGreaterThanOrEqual(shell!.x - 0.5);
    expect(
      frame!.x + frame!.width,
      'the roster page escapes its application shell on the right'
    ).toBeLessThanOrEqual(shell!.x + shell!.width + 0.5);
    // Old CSS still reports zero document overflow because the page clips it.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
    for (const selector of [
      '.members-page-bar',
      '.members-console',
      '.members-bulk',
      '.members-list',
      '.members-count',
      '.members-search',
      '.members-search input',
      '.members-sort',
      '.members-columns',
      '.members-select-loaded',
      '.members-export',
      '.member-row__open',
    ]) {
      const elements = await page.locator(selector).all();
      expect(elements.length).toBeGreaterThan(0);
      for (const element of elements) {
        const box = await element.boundingBox();
        expect(box, `${selector} must render`).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.x, `${selector} is clipped at the left page edge`).toBeGreaterThanOrEqual(
          frame!.x - 0.5
        );
        expect(
          box!.x + box!.width,
          `${selector} is clipped at the right page edge`
        ).toBeLessThanOrEqual(frame!.x + frame!.width + 0.5);
      }
    }
    const consoleBox = await page.locator('.members-console').boundingBox();
    for (const selector of [
      '.members-search input',
      '.members-sort',
      '.members-columns',
      '.members-select-loaded',
      '.members-export',
    ]) {
      const control = page.locator('.members-console').locator(selector);
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(consoleBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(consoleBox!.x + consoleBox!.width);
      const readable = await control.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1
      );
      expect(readable, `${selector} clips its own control content`).toBe(true);
    }
    expect(await page.locator('.members-export').count()).toBe(2);
    expect(await page.locator('.members-console .members-export').count()).toBe(1);
    await page.getByRole('button', { name: 'Open Alice', exact: true }).click();
    await page.getByRole('button', { name: 'Watch At Table', exact: true }).click();
  });
}

/* THE CONSOLE SCROLLS AWAY ON A PHONE (2026-10-12).
 *
 * The Find A Player console was `position: sticky; top: 0` at every width up
 * to 720px. On 2026-10-11 #6693 added the Export Scope note and the Metric
 * Definitions disclosure to it, and at 375 x 812 the pinned console grew to
 * roughly 570px: the roster beneath it showed one partial row, and opening
 * Metric Definitions made the console taller than the screen, so its last
 * definitions sat under the bottom navigation where no scroll could reach
 * them. Post-Deploy E2E run 38203364589 caught it in production
 * (mobile-chrome-occlusion: "Wallets And Fees Are In Club Chips" 74px under
 * the bar). On a phone the console scrolls with the page; the roster and every
 * definition must be reachable by scrolling. */
const DEFINITIONS = [
  'Downlines: Players In The Recursive Downline, Excluding This Player.',
  'Player Wallet: Current Club Member Chip Balance. Agent Wallet: Current Active Agent Chip Balance. Wallets Are An Optional Column And Never Replace Fees.',
  'Fees Generated (Indiv. Fees): Cash Game Rake Attributed To This Player Plus Their Tournament Entry Fees. Downline Fees: Fees Generated By The Recursive Downline Only, Excluding This Player.',
  'Fees Are Read From The Club Fee Ledgers That Pay Agents And Rakeback. They Count From The Week Of October 12, 2026 (Monday Midnight Pacific) And Keep Accumulating From Then On, With No Weekly Reset. Wallets And Fees Are In Club Chips.',
  'Recent Activity Uses Login Time When Available, Otherwise Presence Or Club Activity Time. Online Includes Players At A Live Table Or With Fresh Presence.',
  'Select Loaded Selects Only Players Already Loaded. Export Without A Selection Reads All Authorized Matches Across Every Page. A Selection Is Further Limited By The Current Filter And Search.',
];

for (const width of [375, 393]) {
  for (const definitionsOpen of [false, true]) {
    test(`the roster and every metric definition are reachable at ${width}px with definitions ${
      definitionsOpen ? 'open' : 'closed'
    }`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      const rows = Array.from(
        { length: 40 },
        (_, i) =>
          `<div class="member-row" role="listitem" style="min-height:64px"><button class="member-row__open">Player ${
            i + 1
          }</button></div>`
      ).join('');
      await page.setContent(`
        <style>
          ${CSS}
          *, *::before, *::after { box-sizing: border-box; }
          html, body { margin: 0; background: #000; color: #fff; }
          .application-shell { width: calc(100% - 32px); margin: auto; padding-bottom: 96px; }
          .bottom-nav { position: fixed; left: 0; right: 0; bottom: 0; height: 72px; background: #111; z-index: 50; }
        </style>
        <main class="application-shell"><section class="club-members-page">
          <header class="ca-page-bar members-page-bar"><h1 class="ca-page-bar__title">Player Management</h1><div class="ca-page-bar__live"><div class="members-mode-toggle"><button>Simple</button><button>Advanced</button></div></div><button class="ca-page-help" aria-label="Page Help"></button></header>
          <section class="members-console">
            <div class="members-console__heading"><h2>Find A Player</h2></div>
            <label class="members-search"><span>Search The Roster</span>
              <input type="search" aria-label="Search Club Members" /></label>
            <div class="members-filter-rail"><div class="members-filters">
              <button>All Players</button><button>At Tables</button><button>Online</button>
            </div></div>
            <div class="members-toolbar">
              <label class="members-sort"><span class="members-sort__label">Sort By</span>
                <select aria-label="Sort Players"><option>Role Hierarchy</option></select></label>
              <details class="members-columns"><summary>Columns</summary></details>
              <button class="members-select-loaded">Select Loaded</button>
                <button class="members-export">Export CSV</button>
            </div>
            <p class="members-count" role="note" aria-label="Export Scope"><strong>Export Scope: </strong>
              <span>All Matching Players Across Every Page</span> Includes Authorized Fields Regardless Of Visible Columns.</p>
            <details class="members-columns" ${definitionsOpen ? 'open' : ''}>
              <summary>Metric Definitions</summary>
              <div class="members-count">${DEFINITIONS.map((d) => `<p>${d}</p>`).join('')}</div>
            </details>
          </section>
          <section class="members-list" role="list" aria-label="Club Member Directory">
            <div class="members-viewport">${rows}</div>
          </section>
          <div class="members-count" role="status">Loaded 40 Of 40 Players</div>
        </section></main>
        <nav class="bottom-nav" aria-label="Club"></nav>`);

      // Every probe asks the browser what a finger would actually land on.
      const reachable = (selector: string, block: 'center') =>
        page.locator(selector).evaluate((element, b) => {
          element.scrollIntoView({ block: b as ScrollLogicalPosition, behavior: 'instant' });
          const navTop = document.querySelector('.bottom-nav')!.getBoundingClientRect().top;
          const r = element.getBoundingClientRect();
          const x = r.left + Math.min(r.width / 2, 40);
          const y = Math.min(r.top + r.height / 2, navTop - 2);
          const hit = document.elementFromPoint(x, y);
          return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            navTop: Math.round(navTop),
            onIt: Boolean(hit && (hit === element || element.contains(hit))),
            hit: hit ? hit.className || hit.tagName : null,
          };
        }, block);

      const firstRow = await reachable('.member-row >> nth=0', 'center');
      expect(
        firstRow.onIt,
        `the first roster row is covered at ${width}px: ${JSON.stringify(firstRow)}`
      ).toBe(true);
      const tenthRow = await reachable('.member-row >> nth=9', 'center');
      expect(
        tenthRow.onIt,
        `a roster row is covered at ${width}px: ${JSON.stringify(tenthRow)}`
      ).toBe(true);

      if (definitionsOpen) {
        for (let i = 0; i < DEFINITIONS.length; i += 1) {
          const definition = await reachable(
            `.members-columns[open] .members-count p >> nth=${i}`,
            'center'
          );
          expect(
            definition.onIt && definition.bottom <= definition.navTop,
            `metric definition ${i + 1} cannot be scrolled clear of the bottom bar at ${width}px: ${JSON.stringify(definition)}`
          ).toBe(true);
        }
      }
    });
  }
}

/* THE PLAYERS LIST FITS A PHONE (Dan, 2026-10-25): "PLAYER MANAGEMENT ON
 * MOBILE NEEDS TO BE OPTIMIZED FOR MOBILE. DATA IS CUT OFF, FONTS ARE TOO
 * LARGE ITS A MESS." At 320px (an iPhone with Display Zoom) the name, upline,
 * PlayerID and last-seen were each clipped mid-word and the last line fell out
 * of the fixed-height row. Every ordinary name, upline, PlayerID, role and
 * status prints in full and inside its row at every phone width. */
const PHONE_ROWS = [
  {
    alias: 'Burls',
    upline: 'KingFish',
    role: 'Super Agent',
    id: '1004278',
    status: 'Seen 2 Hours Ago',
    downline: '23.80',
  },
  { alias: 'PostDealerDelux', role: 'Admin', id: '1004114', status: 'Online' },
  {
    alias: 'CoachTimTheGreat',
    upline: 'TrustedAgentMike',
    id: '4418820931',
    status: 'Seen 23 Hours Ago',
  },
  {
    alias: 'Bhrine',
    upline: 'KingFishSupreme',
    role: 'Agent',
    id: '2299001845',
    status: 'At Table',
    downline: '154,321.9875',
  },
];
const ARENA_CSS = readFileSync(
  resolve(process.cwd(), 'src/components/lobby/ArenaWorkspace.css'),
  'utf8'
);
test('the open Columns menu keeps every checkbox inside the roster at desktop and phone widths', async ({
  page,
}) => {
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${CSS}
${ARENA_CSS}</style>
    <main class="club-members-page members-simple arena-workspace"><section class="members-console">
    <div class="arena-roster-tools"><div class="members-toolbar">
    <button class="members-group-role">Group By Role</button>
    <label class="members-sort members-winloss-period"><select><option>This Week</option></select></label>
    <label class="members-sort"><select><option>Name</option></select></label>
    <details class="members-columns"><summary>Columns</summary><div class="members-columns__menu">
    ${['Fees', 'Downlines', 'Activity', 'Wallets'].map((name) => `<label><input type="checkbox" checked>${name}</label>`).join('')}
    </div></details><button class="members-select-loaded">Select Loaded</button>
    <button class="members-export">Export CSV</button></div></div></section></main>`);
  for (const width of [1440, 768, 393, 320]) {
    await page.setViewportSize({ width, height: 812 });
    await page.getByText('Columns', { exact: true }).click();
    for (const box of await page.getByRole('checkbox').all()) {
      await expect(box).toBeInViewport({ ratio: 1 });
      await box.uncheck({ timeout: 2000 });
      await box.check({ timeout: 2000 });
    }
    await page.getByText('Columns', { exact: true }).click();
  }
});
for (const rosterLoadsLast of [false, true]) {
  for (const width of [320, 360, 375, 393, 430, 568, 751, 1024, 1440]) {
    test(`every arena player row prints its name, upline, PlayerID and status in full at ${width}px (roster CSS ${rosterLoadsLast ? 'last' : 'first'})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      const rows = PHONE_ROWS.map(
        (
          m
        ) => `<div class="member-row" role="listitem"><label class="member-select"><input type="checkbox" aria-label="Select player"></label><div class="member-row__open"><button type="button" class="member-row__record" aria-label="Open Player"></button>
        <span class="member-avatar"><span>${m.alias[0]}</span></span>
        <span class="member-main"><span class="member-identity"><span class="member-alias">${m.alias}</span>${
          m.upline ? `<span class="member-upline">Upline: ${m.upline}</span>` : ''
        }</span><span class="member-subline">${m.role ? `<span class="member-role">${m.role}</span>` : ''}<span class="member-number">PlayerID: ${m.id}</span>${
          m.status === 'At Table'
            ? '<button type="button" class="member-seated member-seated--table">Prime Time Free Buy (NLH) · Table 28 · 500/1000</button>'
            : `<span class="${m.status === 'Online' ? 'member-online' : 'member-seen'}">${m.status}</span>`
        }</span>
        <span class="member-simple-balance"><strong>585.67</strong><span>Fees This Week</span><span class="member-simple-balance__wallet">Wallet Balance 18,251.59</span>${
          m.downline ? '<span>Agent Wallet 12,345,678.9012</span><span>Downlines 123</span>' : ''
        }<span class="member-simple-balance__secondary member-winloss--up">Today +12,345.6789</span>${
          m.downline
            ? `<span class="member-simple-balance__downline">Downline ${m.downline}</span>`
            : ''
        }<strong class="member-simple-balance__winloss">-1,234,567.8901</strong></span></span>
        <span class="member-chevron" aria-hidden="true">&rsaquo;</span></div></div>`
      ).join('');
      await page.setContent(`
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>${rosterLoadsLast ? ARENA_CSS + ADMIN_CSS + CSS : CSS + ADMIN_CSS + ARENA_CSS}
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; background: #000; color: #fff; font-family: sans-serif; line-height: 1.6; }
        .application-shell { width: calc(100% - 32px); margin: auto; }
        /* Reproduce the ordinary sans-serif fallback when condensed fonts are
           unavailable, as on the hosted Chromium runner. */
        @media (max-width: 320px) { .application-shell .member-subline { font-family: Arial, sans-serif; } }
      </style>
      <main class="application-shell"><section class="club-members-page members-simple arena-workspace" style="--member-row-pitch:${rosterCardPitchFor(width)}px">
        <header class="arena-workspace-mast"></header>
        <section class="members-console"><div class="members-console__heading"><h2>Find A Player</h2><span class="members-result-count">168 Results</span></div></section>
        <section class="members-live-now">Live Now</section>
        <section class="members-list" role="list">${rows}</section>
      </section></main>`);
      expect(await page.evaluate(() => innerWidth)).toBe(width);
      const problems = await page.evaluate(() => {
        const found: string[] = [];
        const bounds = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const mast = bounds('.arena-workspace-mast');
        for (const selector of ['.members-console', '.members-list', '.members-live-now']) {
          const rect = bounds(selector);
          if (Math.abs(rect.left - mast.left) > 1 || Math.abs(rect.right - mast.right) > 1)
            found.push(selector + ' misses shell edge');
        }
        const frame = bounds('.members-console');
        const textBounds = (selector: string) => {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector(selector)!);
          return range.getBoundingClientRect();
        };
        const title = textBounds('.members-console__heading h2');
        const count = textBounds('.members-result-count');
        if (title.left < frame.left + 14 || count.right > frame.right - 14)
          found.push('directory heading or result count intrudes into the chrome inset');
        if (title.right > count.left && title.bottom > count.top)
          found.push('heading overlaps results');
        document.querySelectorAll('.member-row').forEach((row) => {
          const avatar = row.querySelector('.member-avatar')!.getBoundingClientRect();
          const name = row.querySelector('.member-alias')!.getBoundingClientRect();
          const r = row.getBoundingClientRect();
          /* Dan, 2026-11-27: the portrait sits in the upper left corner at
             double its old size, with the name and every other line below
             it, never floated to the middle of the card. */
          if (avatar.bottom > name.top + 0.5 || !name.width)
            found.push('player name is not below the portrait');
          if (avatar.left - r.left > 16 || avatar.top - r.top > 16)
            found.push('portrait is not in the upper left corner');
          if (avatar.width < 64 || Math.abs(avatar.width - avatar.height) > 1)
            found.push(`portrait is not double size: ${avatar.width}x${avatar.height}`);
          row
            .querySelectorAll(
              '.member-alias, .member-upline, .member-number, .member-role, .member-seen, .member-online, .member-seated, .member-simple-balance > *'
            )
            .forEach((e) => {
              const b = e.getBoundingClientRect();
              if (e.scrollWidth > e.clientWidth + 1) found.push(`clipped: ${e.textContent}`);
              if (b.top < r.top || b.bottom > r.bottom || b.right > r.right)
                found.push(`outside its row: ${e.textContent}`);
            });
          const selection = row.querySelector('.member-select')!.getBoundingClientRect();
          const identity = row.querySelector('.member-identity')!.getBoundingClientRect();
          if (
            identity.left < selection.right &&
            identity.right > selection.left &&
            identity.top < selection.bottom &&
            identity.bottom > selection.top
          )
            found.push('selection covers player identity');
          const subline = row.querySelector('.member-subline')!.getBoundingClientRect();
          for (const field of row.querySelectorAll('.member-subline > *')) {
            const text = document.createRange();
            text.selectNodeContents(field);
            for (const line of text.getClientRects()) {
              if (
                line.left < subline.left - 1 ||
                line.right > subline.right + 1 ||
                line.top < subline.top - 1 ||
                line.bottom > subline.bottom + 1
              )
                found.push(`identity text crosses its column: ${field.textContent}`);
              if (
                line.left < selection.right &&
                line.right > selection.left &&
                line.top < selection.bottom &&
                line.bottom > selection.top
              ) {
                found.push(`selection covers text: ${field.textContent}`);
              }
            }
          }
          const ledger = row.querySelector('.member-simple-balance')!;
          const limit = ledger.getBoundingClientRect();
          for (const field of ledger.children) {
            const text = document.createRange();
            text.selectNodeContents(field);
            // A flex item can fit even while right-aligned text paints into the
            // name on its left. Check the painted lines, including sign and cents.
            for (const line of text.getClientRects()) {
              if (
                line.left < selection.right &&
                line.right > selection.left &&
                line.top < selection.bottom &&
                line.bottom > selection.top
              )
                found.push(`selection covers financial text: ${field.textContent}`);
              if (
                line.left < limit.left - 1 ||
                line.right > limit.right + 1 ||
                line.top < r.top ||
                line.bottom > r.bottom
              ) {
                found.push(`ledger text crosses its column: ${field.textContent}`);
              }
            }
          }
          const alias = row.querySelector('.member-alias')!;
          if (
            alias.getBoundingClientRect().height >
            parseFloat(getComputedStyle(alias).fontSize) * 1.6
          )
            found.push(`name broke over two lines: ${alias.textContent}`);
        });
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
          found.push('page scrolls sideways');
        return found;
      });
      expect(problems, `player rows at ${width}px`).toEqual([]);
    });
  }
}
