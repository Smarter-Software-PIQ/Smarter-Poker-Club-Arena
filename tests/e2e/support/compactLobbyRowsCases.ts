import { expect, test } from '@playwright/test';
import { build as buildFixture } from 'esbuild';
import { readFileSync } from 'node:fs';

export function registerCompactLobbyRowsCases() {
  test('premium cash Details is contained by its own row and favorites remain separate', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 812 });
    await page.setContent(
      `<main class="club-home"><div class="lobby-table-wrap"><table class="compact-lobby has-premium-chassis"><tbody>${['first', 'second', 'third'].map((id) => `<tr data-game-heading="${id}" data-kind="cash"><td><span class="lt-tournament-heading"><span class="lt-tournament-icon">Cash Game</span></span></td></tr><tr data-id="${id}" data-kind="cash"><td><button class="lt-fav" aria-label="Favorite ${id}" onclick="document.body.dataset.favorite='${id}'">Star</button><button class="compact-lobby__open" aria-label="Details: ${id}" onclick="document.body.dataset.details='${id}'"><span class="premium-cash-style">Classic</span></button></td><td data-label="Stakes">1/2</td><td>6</td><td>Running</td></tr>`).join('')}</tbody></table></div></main>`
    );
    await page.addStyleTag({
      content: ['LobbyTable.css', 'CompactLobbyRows.css', 'PremiumMttRows.css']
        .map((name) => readFileSync('src/components/lobby/' + name, 'utf8'))
        .join('\n'),
    });
    const details = page.getByRole('button', { name: 'Details: third', exact: true });
    const geometry = await details.evaluate((button) => {
      const row = button.closest('tr')!.getBoundingClientRect();
      const hit = button.getBoundingClientRect();
      return {
        width: hit.width,
        rowWidth: row.width,
        top: hit.top - row.top,
        bottom: hit.bottom - row.bottom,
      };
    });
    expect(geometry.width).toBeCloseTo(geometry.rowWidth, 0);
    expect(Math.abs(geometry.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.bottom)).toBeLessThanOrEqual(1);
    await details.click();
    await expect(page.locator('body')).toHaveAttribute('data-details', 'third');
    await page.getByRole('button', { name: 'Favorite third', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-favorite', 'third');
  });
  test('premium MTT Details and its separate countdown both receive clicks', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setContent(
      `<main class="club-home"><div class="lobby-table-wrap"><table class="compact-lobby has-premium-chassis"><tbody><tr data-id="fixture" data-kind="mtt"><td><button class="compact-lobby__open" aria-label="Details: Tournament" onclick="document.body.dataset.details='opened'">Tournament</button><span class="lt-name__meta"><button class="premium-lobby-start-toggle" onclick="document.body.dataset.clock='toggled'"><strong class="premium-lobby-clock__value">6:23:24</strong></button></span></td><td>10</td><td>20</td><td>Running</td></tr></tbody></table></div></main>`
    );
    await page.addStyleTag({
      content: readFileSync('src/components/lobby/PremiumMttRows.css', 'utf8'),
    });
    const crop = await page.locator('tr[data-id="fixture"]').evaluate((row) => {
      const paint = getComputedStyle(row, '::before');
      const imageHeight = Number.parseFloat(paint.backgroundSize.split(' ')[1]);
      const offset = Number.parseFloat(paint.backgroundPositionY);
      return {
        firstPixel: (-offset / imageHeight) * 793,
        lastPixel: ((row.getBoundingClientRect().height - offset) / imageHeight) * 793,
      };
    });
    expect(crop.firstPixel).toBeCloseTo(407, 0);
    expect(crop.lastPixel).toBeCloseTo(635, 0);
    await page.getByRole('button', { name: 'Details: Tournament', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-details', 'opened');
    await page.locator('.premium-lobby-start-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-clock', 'toggled');
  });
  test('game counts stay centered under Players and row details wrap', async ({
    page,
  }, testInfo) => {
    const bundle = await buildFixture({
      entryPoints: ['tests/e2e/support/compactLobbyRowsFixture.tsx'],
      jsx: 'automatic',
      bundle: true,
      write: false,
      outfile: 'rows.js',
      metafile: true,
      format: 'iife',
      platform: 'browser',
      loader: {
        '.css': 'empty',
        '.webp': 'dataurl',
        '.png': 'dataurl',
        '.svg': 'dataurl',
        '.jpg': 'dataurl',
      },
      define: {
        'import.meta.env': JSON.stringify({
          VITE_SUPABASE_URL: 'https://fixture.invalid',
          VITE_SUPABASE_ANON_KEY: 'local-fixture',
          DEV: true,
        }),
        'process.env.NODE_ENV': '"test"',
      },
      plugins: [
        {
          name: 'no-fixture-transport',
          setup(build) {
            build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
            build.onResolve({ filter: /\/tableWarmup$/ }, () => ({
              path: 'warmup',
              namespace: 'fixture',
            }));
            build.onResolve({ filter: /\/ChunkPreloader$/ }, () => ({
              path: 'prefetch',
              namespace: 'fixture',
            }));
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
              contents:
                args.path === 'prefetch'
                  ? 'export const prefetchIntent=()=>({});'
                  : 'export const warmTable=()=>{}; export const observeLobbyTableWarmups=()=>()=>{};',
            }));
          },
        },
      ],
    });
    const fontStylesheet = readFileSync('index.html', 'utf8').match(
      /href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/
    )?.[1];
    expect(fontStylesheet, 'Load the same approved fonts as the real application').toBeTruthy();
    const sheets = [
      ...new Set([
        'src/components/lobby/LobbyTable.css',
        'src/components/lobby/CompactLobbyRows.css',
        'src/components/lobby/PremiumMttRows.css',
      ]),
    ]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    await page.route('https://fixture.invalid/**', (route) => route.fulfill({ json: null }));
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(
        `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${fontStylesheet}"><style>html,body{margin:0;background:#000}*{box-sizing:border-box}${sheets}</style><div id="root"></div>`
      );
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const table = page.locator(width <= 900 ? '.compact-lobby' : '.lobby-table');
      await expect(table).toBeVisible();
      await expect(table.locator('.lt-seats--game')).toHaveCount(3);
      await page.evaluate(async () => {
        const loaded = await document.fonts.load('600 12px "Roboto Condensed"');
        await document.fonts.ready;
        if (!loaded.length || !loaded.every((face) => face.status === 'loaded')) {
          throw new Error(
            'The actual Roboto Condensed face must load; fallback metrics are not proof'
          );
        }
      });
      const geometry = await table.evaluate((root) => {
        const header = [...root.querySelectorAll('th')].find((el) =>
          el.textContent?.includes('Players')
        )!;
        const center = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.x + r.width / 2;
        };
        return {
          deltas: [
            ...root.querySelectorAll(
              '.lt-seats--game .lt-seats__num, .lt-seats--game .lt-seats__tables'
            ),
          ].map((el) => Math.abs(center(el) - center(header))),
          overflow: root.scrollWidth - root.clientWidth,
          meta: [...root.querySelectorAll('.compact-lobby__meta')].map((el) => ({
            whiteSpace: getComputedStyle(el).whiteSpace,
            height: el.getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(el).lineHeight),
          })),
        };
      });
      expect(
        geometry.deltas.every((delta) => delta <= 1),
        `${width}px player center deltas: ${geometry.deltas}`
      ).toBe(true);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      await testInfo.attach(`compact-rows-${width}px`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      if (width <= 900) {
        expect(geometry.meta.every((meta) => meta.whiteSpace === 'normal')).toBe(true);
        /* Dan 2026-11-08: a Lightning card's style bay prints one word, and
           its rules move under the title. The three-line fit is proven on the
           Classic PLO6 card, which still carries its ante and floor. */
        await expect(
          table.locator('tr[data-id="fixture-madness"] .premium-cash-style > span')
        ).toHaveText(['Lightning']);
        const styleCopy = table.locator('tr[data-id="fixture-classic"] .compact-lobby__meta');
        await expect(styleCopy.locator('.premium-cash-style > span')).toHaveText([
          'Classic',
          'Big Blind Ante',
          '50% Min VPIP',
        ]);
        const readPaintedStack = () =>
          styleCopy.locator('.premium-cash-style').evaluate((glass) => {
            const box = glass.getBoundingClientRect();
            return [...glass.children].map((span) => {
              const lineBox = span.getBoundingClientRect();
              const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
              const ink: { top: number; bottom: number; left: number; right: number }[] = [];
              while (walker.nextNode()) {
                if (!walker.currentNode.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                for (const rect of range.getClientRects())
                  if (rect.width > 0 && rect.height > 0) {
                    ink.push({
                      top: rect.top,
                      bottom: rect.bottom,
                      left: rect.left,
                      right: rect.right,
                    });
                  }
              }
              return {
                text: span.textContent?.trim(),
                top: lineBox.top,
                bottom: lineBox.bottom,
                painted: ink.length > 0,
                insideGlass:
                  ink.length > 0 &&
                  ink.every(
                    (rect) =>
                      rect.left >= box.left - 1 &&
                      rect.right <= box.right + 1 &&
                      rect.top >= box.top - 1 &&
                      rect.bottom <= box.bottom + 1
                  ),
                baselines: [...new Set(ink.map((rect) => Math.round(rect.top * 2) / 2))],
                ink,
              };
            });
          });
        await expect
          .poll(
            async () => {
              const lines = await readPaintedStack();
              return (
                lines.length === 3 &&
                lines.every(
                  (line, index) =>
                    line.painted &&
                    line.insideGlass &&
                    line.baselines.length === 1 &&
                    (!index ||
                      (line.top > lines[index - 1].top && line.top >= lines[index - 1].bottom - 1))
                )
              );
            },
            {
              message: `${width}px fitted cash descriptions must settle inside their native glass`,
              timeout: 5000,
            }
          )
          .toBe(true);
        const paintedStack = await readPaintedStack();
        await testInfo.attach(`cash-style-painted-lines-${width}px`, {
          body: JSON.stringify(paintedStack),
          contentType: 'application/json',
        });
        expect(paintedStack).toHaveLength(3);
        for (const [index, line] of paintedStack.entries()) {
          expect(line.painted, `${width}px ${line.text} must paint its actual text nodes`).toBe(
            true
          );
          expect(
            line.insideGlass,
            `${width}px ${line.text} ink must fit its real style glass`
          ).toBe(true);
          expect(line.baselines).toHaveLength(1);
          if (index) {
            expect(line.top, `${width}px distinct ordered line boxes`).toBeGreaterThan(
              paintedStack[index - 1].top
            );
            expect(
              line.top,
              `${width}px stacked line boxes must not overlap`
            ).toBeGreaterThanOrEqual(paintedStack[index - 1].bottom - 1);
          }
        }
        await expect(styleCopy.getByTitle('50% Minimum VPIP', { exact: true })).toBeVisible();
        await table.locator('.compact-lobby__open').first().click();
        await expect(page.locator('body')).toHaveAttribute('data-selected', 'true');
      }
    }
  });
}
