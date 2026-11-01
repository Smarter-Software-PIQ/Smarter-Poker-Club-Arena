import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/** Real seat components, decoded mixed artwork and production CSS. No player
 * is labelled Hero and no account, seating or gameplay operation is involved. */
export function registerObserverAvatarSizingCases() {
  for (const [width, height, emptyBottom] of [
    [467, 994, false],
    [600, 1277, false], // The production phone's desktop-reference viewport.
    [652, 996, false],
    [652, 996, true],
  ] as const)
    test(`spectators match avatar artwork and retain fixed chairs at ${width}px${emptyBottom ? ' with an empty bottom chair' : ''}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(60_000);
      const root = process.cwd();
      const built = buildSync({
        entryPoints: ['tests/e2e/support/portraitRailFixture.tsx'],
        jsx: 'automatic',
        outfile: 'observer-fixture.js',
        bundle: true,
        write: false,
        metafile: true,
        format: 'iife',
        platform: 'browser',
        loader: {
          '.css': 'empty',
          '.png': 'dataurl',
          '.webp': 'dataurl',
          '.svg': 'dataurl',
          '.jpg': 'dataurl',
        },
        define: {
          'import.meta.env': JSON.stringify({
            VITE_SUPABASE_URL: 'https://dummy.supabase.co',
            VITE_SUPABASE_ANON_KEY: 'local-fixture',
            DEV: true,
          }),
          'process.env.NODE_ENV': '"test"',
        },
      });
      const readStyle = (file: string): string =>
        readFileSync(resolve(root, file), 'utf8').replace(
          /^\s*@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/gm,
          (_, imported: string) => readStyle(resolve(dirname(file), imported))
        );
      const sheets = [
        ...new Set([
          'src/styles/club-engine.css',
          'src/styles/animations.css',
          'src/styles/metallic-popups.css',
          'src/styles/reducedMotion.css',
          'src/pages/MultiTablePage.css',
          'src/components/table/TableTabBar.css',
          'src/pages/TablePage.css',
          'src/components/table/ActionPanel.css',
          ...Object.keys(built.metafile!.inputs).filter((file) => file.endsWith('.css')),
          'src/components/table/TableVisualHotfix.css',
        ]),
      ];
      const fontSheet = await page.request.get('https://ca-static.smarter.poker/fonts/fonts.css');
      expect(fontSheet.ok()).toBe(true);
      const inter = [...(await fontSheet.text()).matchAll(/@font-face\s*\{[^}]+\}/g)]
        .map((m) => m[0])
        .find((face) => face.includes("font-family: 'Inter'") && face.includes('U+0000-00FF'))!;
      const fontPath = /url\(([^)]+)\)/.exec(inter)![1];
      const fontResponse = await page.request.get(
        new URL(fontPath.replace('/hub/club-arena/', '/'), 'https://ca-static.smarter.poker').href
      );
      expect(fontResponse.ok()).toBe(true);
      const css =
        inter
          .replace(/font-weight:\s*\d+;/, 'font-weight: 100 900;')
          .replace(
            fontPath,
            `data:font/woff2;base64,${(await fontResponse.body()).toString('base64')}`
          ) +
        '\n' +
        sheets.map(readStyle).join('\n');
      await page.route('**/avatars/table/**', (route) =>
        route.fulfill({
          body: readFileSync(
            resolve(
              root,
              'tests/e2e/fixtures/table-art',
              route.request().url().includes('vip_aztec_warrior')
                ? 'vip_aztec_warrior@2x.webp'
                : 'vip_wolf@2x.webp'
            )
          ),
          contentType: 'image/webp',
          headers: { 'access-control-allow-origin': '*' },
        })
      );
      await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
      await page.route('**/cards/**', (route) => {
        const card = new URL(route.request().url()).pathname.split('/cards/')[1];
        const file = resolve(root, 'public/cards', card);
        const source = existsSync(file) ? file : file.replace(/\.webp$/, '.png');
        return route.fulfill({
          body: readFileSync(source),
          contentType: source.endsWith('.webp') ? 'image/webp' : 'image/png',
        });
      });
      await page.route('**/buttons/black/icon-*.webp', (route) =>
        route.fulfill({
          body: readFileSync(
            resolve(
              root,
              'tests/e2e/fixtures/table-art',
              new URL(route.request().url()).pathname.split('/').pop()!
            )
          ),
          contentType: 'image/webp',
        })
      );
      await page.setViewportSize({ width, height });
      await page.route('http://observer.fixture/', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html data-seats="9" data-tournament="true" data-spectator="true" data-avatar-mix="true" data-empty-bottom="${emptyBottom}" data-revealed="false" data-jackpot="none"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head><body><div id="root"></div></body></html>`,
        })
      );
      await page.goto('http://observer.fixture/');
      await page.addScriptTag({
        content: built.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
      });
      const count = emptyBottom ? 8 : 9;
      await expect(page.locator('.seat__avatar-img')).toHaveCount(count);
      await page.evaluate(async () => {
        await document.fonts.load('600 14px Inter');
        await document.fonts.ready;
      });
      // Read independent opaque row counts from the actual shipped bytes, not
      // the normalization helper's projection or its own expected scale.
      const alphaRows = await page.evaluate(async () => {
        const rows: Record<string, number> = {};
        for (const source of new Set(
          [...document.querySelectorAll<HTMLImageElement>('.seat__avatar-img')].map(
            (image) => image.currentSrc || image.src
          )
        )) {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.src = source;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let top = canvas.height,
            bottom = 0;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++)
              if (pixels[(y * canvas.width + x) * 4 + 3] > 12) {
                top = Math.min(top, y);
                bottom = Math.max(bottom, y + 1);
              }
          rows[source] = (bottom - top) / canvas.height;
        }
        return rows;
      });
      await page.waitForFunction((alphas) => {
        const images = [...document.querySelectorAll<HTMLImageElement>('.seat__avatar-img')];
        const heights = images.map(
          (image) => image.getBoundingClientRect().height * alphas[image.currentSrc || image.src]
        );
        return heights.length > 0 && Math.max(...heights) - Math.min(...heights) < 0.05;
      }, alphaRows);
      await page.evaluate(async () => {
        for (let phase = 0; phase < 3; phase++) {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === 'running' &&
                  Number.isFinite(animation.effect?.getComputedTiming().iterations)
              )
              .map((animation) => animation.finished.catch(() => {}))
          );
          await new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
          );
        }
      });
      const measure = () =>
        page.evaluate((alphas) => {
          const images = [...document.querySelectorAll<HTMLImageElement>('.seat__avatar-img')];
          const rect = (element: Element) => {
            const r = element.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          };
          return {
            artwork: images.map(rect),
            heights: images.map(
              (image) =>
                image.getBoundingClientRect().height * alphas[image.currentSrc || image.src]
            ),
            panels: [...document.querySelectorAll('.seat__info')].map(rect),
            fixed: [
              ...document.querySelectorAll('.table-scaler,.community-area,.spectator-footer-bar'),
            ].map(rect),
          };
        }, alphaRows);
      const before = await measure();
      expect(Math.max(...before.heights) - Math.min(...before.heights)).toBeLessThan(0.05);
      await expect(page.locator('.seat--hero')).toHaveCount(0);
      await expect(page.locator('.spectator-footer-bar')).toHaveText('Spectating');
      await expect(page.locator('.action-btn')).toHaveCount(0);
      if (!emptyBottom)
        expect(
          await page
            .locator('.seat-wrapper--hero .seat__avatar')
            .evaluate((avatar) =>
              (avatar as HTMLElement).style.getPropertyValue('--sp-opponent-art-scale')
            )
        ).toBe('');
      for (const acting of [emptyBottom ? 1 : 0, 7]) {
        await page.evaluate(
          (index) => document.dispatchEvent(new CustomEvent('fixture-focus', { detail: index })),
          acting
        );
        await page.waitForFunction(
          (index) =>
            document.querySelector('.seat--active')?.getAttribute('data-seat-num') ===
            String(index + 1),
          acting
        );
      }
      await page.evaluate(async () => {
        document
          .querySelectorAll('.seat')
          .forEach((seat) =>
            seat.classList.add('seat--folded', 'seat--winner-pop', 'seat--allin-shake')
          );
        document
          .querySelectorAll('.seat__avatar-wrap')
          .forEach((wrap) => wrap.classList.add('seat__avatar-wrap--fold'));
        document.documentElement.dataset.betAmount = '120000';
        document.dispatchEvent(new Event('fixture-next-hand'));
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        );
      });
      const after = await measure();
      for (const name of ['artwork', 'panels', 'fixed'] as const)
        for (let item = 0; item < after[name].length; item++)
          for (let axis = 0; axis < 4; axis++)
            expect(
              after[name][item][axis],
              `${name} remains fixed through turns, actions and new hands`
            ).toBeCloseTo(before[name][item][axis], 3);
      await expect(page.locator('.seat--hero')).toHaveCount(0);
      await expect(page.locator('.spectator-footer-bar')).toHaveText('Spectating');
      await page.screenshot({
        path: testInfo.outputPath(`observer-${width}${emptyBottom ? '-empty-bottom' : ''}.png`),
      });
    });
}
