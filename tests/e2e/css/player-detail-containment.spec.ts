import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const recordCSS = readFileSync(resolve('src/pages/MemberManagementPage.css'), 'utf8');
const recordSource = readFileSync(resolve('src/pages/MemberManagementPage.tsx'), 'utf8');
const statsSource = readFileSync(resolve('src/pages/PlayerStatisticsPage.tsx'), 'utf8');
const hint = 'Chicago Time, DST Automatic. Both Dates Included. Custom Dates Need Confirm.';

const statsCSS = readFileSync(resolve('src/pages/PlayerStatisticsPage.css'), 'utf8');

for (const width of [375, 393, 768]) {
  test(`player detail controls fit the application shell at ${width}px`, async ({ page }) => {
    expect(recordSource).toContain(hint);
    expect(statsSource).toContain(hint);
    await page.setViewportSize({ width, height: 812 });
    await page.setContent(`<style>${recordCSS}${statsCSS}
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; }
      .application-shell { width: calc(100% - ${width > 720 ? 97 : 32}px); margin: auto; }
    </style><main class="application-shell">
      <section class="member-mgmt-page">
        <header class="mm-header"><button class="mm-back" aria-label="Go Back">‹</button></header>
        <section class="mm-credential"><div class="mm-credential__content">Player Record</div></section>
        <div class="mm-ledger-grid">
          <section class="mm-range"><div class="mm-range__tabs"><button>Overall</button><button>7 Days</button><button>Custom</button></div>
            <div class="mm-range__custom"><label class="mm-date"><span>From</span><input type="date" value="2026-10-01" /></label><label class="mm-date"><span>To</span><input type="date" value="2026-10-11" /></label><button class="mm-range__confirm">Confirm</button></div><p class="mm-range__caption">${hint}</p></section>
          <section class="mm-card mm-stats"><h2 class="mm-card__title">Downline</h2><div class="mm-downline"><button class="mm-downline__row"><span class="mm-downline__names"><span class="mm-downline__alias">River Shark</span></span><span class="mm-downline__number">No. 2050</span><span class="mm-downline__fees">123,456.78</span><span class="mm-downline__open">›</span></button><p class="mm-downline__more">Showing 60 Of 207<button class="mm-downline__show-more">Show 60 More</button></p></div></section>
          <section class="mm-card mm-roles"><div class="mm-roles__confirm"><p>Change River Shark To Agent?</p><div class="mm-roles__rates"><label class="mm-field"><span class="mm-field__label">Agent Rakeback Percent (0 To 70)</span><input type="number" value="40" /></label><p class="mm-roles__rates-note">This Rate Covers The Agent Account And Every Sub Agent Under Them. The Agent Sets The Rakeback Their Players Receive From Their Agent Dashboard.</p></div><div class="mm-roles__confirm-actions"><button class="mm-roles__confirm-yes">Confirm</button><button class="mm-roles__confirm-no">Cancel</button></div></div></section>
        </div>
      </section>
      <section class="player-stats-page"><header class="ps-hero"><div class="ps-hero__content">Player Statistics</div></header><section class="ps-controls"><label class="ps-variant"><span>Game</span><select><option>No Limit Holdem</option></select></label><div class="ps-range__tabs"><button>Overall</button><button>Week</button><button>Month</button><button>Custom</button></div><div class="ps-range__custom"><label class="ps-date"><span>From</span><input type="date" value="2026-10-01" /></label><label class="ps-date"><span>To</span><input type="date" value="2026-10-11" /></label><button class="ps-range__confirm">Confirm</button></div><p class="ps-range__caption">${hint}</p></section><div class="ps-cards"><section class="ps-card">Volume</section></div></section>
    </main>`);
    await page.evaluate(() => document.fonts.ready);
    for (const caption of await page.locator('.mm-range__caption, .ps-range__caption').all()) {
      await expect(caption).toHaveText(hint);
      expect(await caption.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    for (const root of ['.member-mgmt-page', '.player-stats-page']) {
      const frame = await page.locator(root).boundingBox();
      const shell = await page.locator('.application-shell').boundingBox();
      expect(frame!.x).toBeGreaterThanOrEqual(shell!.x - 0.5);
      expect(frame!.x + frame!.width).toBeLessThanOrEqual(shell!.x + shell!.width + 0.5);
      for (const panel of await page.locator(`${root} > *`).all()) {
        const box = await panel.boundingBox();
        expect(box!.x, `${root} panel clips left`).toBeGreaterThanOrEqual(frame!.x - 0.5);
        expect(box!.x + box!.width, `${root} panel clips right`).toBeLessThanOrEqual(
          frame!.x + frame!.width + 0.5
        );
      }
      for (const control of await page
        .locator(`${root} input, ${root} select, ${root} button`)
        .all()) {
        const box = await control.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(frame!.x - 0.5);
        expect(box!.x + box!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 0.5);
        const containingPanel = await control.evaluate((node) => {
          const panel = node.closest('.mm-range, .mm-card, .ps-controls, .mm-header')!;
          const own = node.getBoundingClientRect();
          const outer = panel.getBoundingClientRect();
          return own.left >= outer.left - 0.5 && own.right <= outer.right + 0.5;
        });
        expect(containingPanel, 'control escapes its own inner panel').toBe(true);
        expect(
          await control.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          await control.evaluate(
            (node) =>
              `${node.outerHTML} clips its own content: ${node.scrollWidth}/${node.clientWidth}`
          )
        ).toBe(true);
      }
    }
  });
}

test('cash and tournament position numbers stay inside their own table viewport', async ({
  page,
}) => {
  const { buildSync } = await import('esbuild');
  const sheet = [
    'src/pages/PlayerStatsPage.css',
    'src/components/stats/PositionWinRates.css',
    'src/components/stats/StatsDataTable.css',
    'src/pages/stats/StatsReadouts.css',
    'src/pages/stats/StatsWorkbench.css',
  ]
    .map((file) => readFileSync(resolve(file), 'utf8'))
    .join('\n');

  // Exercise the shipping table producers, including unmeasured 3-bet opportunities.
  const fixture = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client';
        import Cash from './src/components/stats/PositionWinRates';
        import ChartData from './src/components/stats/StatsDataTable';
        import Tournament from './src/pages/stats/TournamentPlayingStats';
        const sample = [{
          position: 'BB', hands_played: 149, vpip_count: 39, pfr_count: 16,
          three_bet_opps: 0, bb100: -23.7, total_profit: -1200,
        }, {
          position: 'UTG+1', hands_played: 134, vpip_count: 25, pfr_count: 23,
          three_bet_opps: 12, three_bet_count: 3, bb100: 8.1, total_profit: 1234567.89,
        }, {
          position: 'CO', hands_played: 199, vpip_count: 199, pfr_count: 198,
          three_bet_opps: 2, three_bet_count: 2, bb100: -21.1, total_profit: -2189.30,
        }];
        const totals = { tourney_hands: 283, hands_won: 45, showdowns_total: 16 };
        const full = { positions: sample, contract: { quality: { metric_availability: {} }, coverage: {} } };
        createRoot(document.querySelector('main')).render(<>
          <Tournament overall={totals} full={full}/>
          <Cash initialPositions={sample}/>
          <ChartData caption="Exact Figures" rows={[[1, '+12,345,678.90', '-2,189.30', '100.0%']]}
            rowKey={row => String(row[0])} columns={['Hand', 'Actual BB', 'Expected BB', 'Rate'].map((label, i) => ({
              key: label, label, render: row => row[i],
            }))}/>
        </>);
      `,
    },
    loader: { '.css': 'empty' },
    write: false,
    bundle: true,
    jsx: 'automatic',
    jsxImportSource: 'react',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  });
  await page.setContent(`<style>* { box-sizing:border-box } body { margin:0 }
    ${sheet}
    main { margin:auto; width:calc(100% - 32px) }
    @media (min-width:800px) { main { width:calc(100% - 80px) } }
    </style><div class="stats-page arena-workspace"><main class="stats-readouts stats-workbench"></main></div>`);
  await page.addScriptTag({ content: fixture.outputFiles[0].text });
  const disclosures = page.getByText('Show Data Table', { exact: true });
  await expect(disclosures).toHaveCount(2);
  for (const disclosure of await disclosures.all()) {
    await disclosure.click();
  }
  const tournament = page.getByRole('table', { name: 'Tournament Positions' });
  const cash = page.getByRole('table', { name: 'Win Rate By Position' });
  for (const width of [320, 393, 898, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const table of [tournament, cash]) {
      const row = table.getByRole('row').filter({ hasText: /^BB|Big Blind/ });
      await expect(row).toContainText('149');
      await expect(row).toContainText('26.2%');
      await expect(row).toContainText('10.7%');
      const fits = await table.evaluate((node) => {
        const wrap = node.parentElement!;
        const bounds = wrap.getBoundingClientRect();
        return {
          internalOverflow: wrap.scrollWidth - wrap.clientWidth,
          clipped: [...node.querySelectorAll('tbody th, tbody td')]
            .filter((cell) => {
              const box = cell.getBoundingClientRect();
              const text = document.createRange();
              text.selectNodeContents(cell);
              const ink = text.getBoundingClientRect();
              return (
                box.left < bounds.left - 1 ||
                box.right > bounds.right + 1 ||
                ink.left < box.left - 1 ||
                ink.right > box.right + 1
              );
            })
            .map((cell) => cell.textContent),
        };
      });
      expect(fits.internalOverflow, `${width}px internal table overflow`).toBeLessThanOrEqual(1);
      expect(fits.clipped, `${width}px clipped cell values`).toEqual([]);
    }
    const chart = page.getByRole('table', { name: 'Exact Figures' });
    for (const table of [cash, chart, tournament]) {
      const splitNumbers = await table.evaluate((node) => {
        const problems: string[] = [];
        const outer = node.parentElement!.getBoundingClientRect();
        for (const cell of node.querySelectorAll<HTMLTableCellElement>('tbody td')) {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const value = walker.currentNode;
            if (!/^[+\-−]?[\d,.]+%?$/.test(value.textContent?.trim() ?? '')) continue;
            const range = document.createRange();
            range.selectNodeContents(value);
            const lines = [...range.getClientRects()].filter((r) => r.width && r.height);
            if (
              lines.length !== 1 ||
              lines.some((r) => r.left < outer.left - 0.5 || r.right > outer.right + 0.5)
            ) {
              problems.push(
                `${cell.getAttribute('data-label') || cell.cellIndex}: ${value.textContent} (${lines.length} lines)`
              );
            }
          }
        }
        return problems;
      });
      expect(
        splitNumbers,
        `${width}px ${(await table.getAttribute('aria-label')) || (await table.locator('caption').innerText())} values must remain whole and on screen`
      ).toEqual([]);
    }
    await expect(cash.getByRole('row').filter({ hasText: 'Cutoff' })).toContainText('-2,189.30');
    await expect(cash.getByRole('row').filter({ hasText: 'Cutoff' })).toContainText('100.0%');
    await expect(chart).toContainText('+12,345,678.90');
    if (width < 400) {
      const blind = cash.getByRole('row').filter({ hasText: 'Big Blind' });
      const primary = await blind
        .locator(':scope > :nth-child(-n + 4)')
        .evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().top)));
      expect(new Set(primary).size).toBe(1);
      await expect(blind.getByText('3-Bet', { exact: true })).toBeVisible();
      await expect(blind).toContainText('Not Yet Measured');
      await expect(blind.getByText('Profit', { exact: true })).toBeVisible();
    }
  }
});
