import { expect, test } from '@playwright/test';
import { build as buildFixture } from 'esbuild';
import { readFileSync } from 'node:fs';

export function registerCompactLobbyRowsCases() {
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
        const styleCopy = table.locator('.compact-lobby__meta').nth(1);
        await expect(styleCopy.locator('.premium-cash-style > span')).toHaveText([
          'Lightning Games',
          'Big Blind Ante',
          '40% Min VPIP',
        ]);
        const paintedStack = await styleCopy.locator('.premium-cash-style').evaluate((glass) => {
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
        await expect(styleCopy.getByTitle('40% Minimum VPIP', { exact: true })).toBeVisible();
        await table.locator('.compact-lobby__open').first().click();
        await expect(page.locator('body')).toHaveAttribute('data-selected', 'true');
      }
    }
  });
}
