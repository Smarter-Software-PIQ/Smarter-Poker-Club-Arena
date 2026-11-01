import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

export function registerLobbyGameSectionsCases(lobbyGameSectionsFixture: () => Promise<string>) {
  for (const width of [375, 393, 1280]) {
    test(`Find Your Game separates two large doors at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      // ClubHomePage imports LobbyGameSections before its own stylesheets.
      // The component's CSS must precede the page, command top and mobile pass,
      // as it does in the production bundle; loading it last hides overrides.
      const css = [
        'src/components/lobby/LobbyFilterLabel.css',
        'src/components/lobby/LobbyGameSections.css',
        'src/pages/ClubHomePage.css',
        'src/components/lobby/ClubLobbyCommandTop.css',
        'src/pages/ClubHomeMobilePremium.css',
      ]
        .map((p) => readFileSync(p, 'utf8'))
        .join('\n');
      await page.route(
        '**/assets/club-buttons/game-cards/nlh/spade-nlh-premium-v1/buttons/*.png',
        async (route) => {
          const name = new URL(route.request().url()).pathname.split('/').pop();
          await route.fulfill({
            contentType: 'image/png',
            body: readFileSync(
              `public/assets/club-buttons/game-cards/nlh/spade-nlh-premium-v1/buttons/${name}`
            ),
          });
        }
      );
      await page.route('**/assets/club-buttons/club-utility-shell.png', (route) =>
        route.fulfill({
          contentType: 'image/png',
          body: readFileSync('public/assets/club-buttons/club-utility-shell.png'),
        })
      );
      await page.route(
        '**/assets/club-buttons/lobby/chrome-arena-controls-v1/filter-plate.png',
        (route) =>
          route.fulfill({
            contentType: 'image/png',
            body: readFileSync(
              'public/assets/club-buttons/lobby/chrome-arena-controls-v1/filter-plate.png'
            ),
          })
      );
      await page.setContent(
        `<meta name="viewport" content="width=device-width,initial-scale=1"><base href="https://fixture.invalid/"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;800&display=swap"><style>body{margin:0;background:#000;color:#e4e7ec}.club-home{width:100%;padding:0}.club-lobby-command-top{display:block!important;min-height:0!important;padding:0!important}${css}</style><div id="root"></div>`
      );
      // Match the production document: iPhone WebKit otherwise lays out at 980px.
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      await page.addScriptTag({ content: await lobbyGameSectionsFixture() });
      const cash = page.getByRole('button', { name: 'Cash Games', exact: true });
      const tournaments = page.getByRole('button', { name: 'Tournaments', exact: true });
      await expect(cash).toHaveAttribute('aria-expanded', 'false');
      await expect(tournaments).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('tablist')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      for (const button of [cash, tournaments]) {
        const rect = await button.boundingBox();
        expect(rect!.height).toBeGreaterThanOrEqual(60);
        expect(rect!.width).toBeGreaterThanOrEqual(140);
        expect(Math.abs(rect!.width - rect!.height)).toBeLessThan(1);
        const text = await button
          .locator('.lobby-game-sections__well > span')
          .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        expect(text.scroll).toBeLessThanOrEqual(text.width + 1);
      }
      const cashBox = await cash.boundingBox();
      const tournamentBox = await tournaments.boundingBox();
      expect(Math.abs(cashBox!.y - tournamentBox!.y)).toBeLessThan(1);
      expect(tournamentBox!.x).toBeGreaterThan(cashBox!.x + cashBox!.width);
      const title = await page.locator('.lobby-controls__title').boundingBox();
      const heading = await page.locator('.lobby-controls__heading').boundingBox();
      expect(Math.abs(title!.x + title!.width / 2 - heading!.x - heading!.width / 2)).toBeLessThan(
        1
      );
      if (width === 393) await page.screenshot({ path: testInfo.outputPath('closed.png') });
      await cash.click();
      await expect(page.getByRole('tab')).toHaveText(['ALL', 'NLH', 'PLO', 'LIMIT']);
      const expectFittedKeys = async () => {
        for (const label of await page
          .locator('#lobby-game-section-controls .lobby-filter-label__text')
          .all()) {
          const geometry = await label.evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const ink = range.getBoundingClientRect();
            const zone = el.parentElement!.getBoundingClientRect();
            const face = zone.width ? zone : el.closest('button')!.getBoundingClientRect();
            return {
              left: ink.left,
              right: ink.right,
              top: ink.top,
              bottom: ink.bottom,
              faceLeft: face.left,
              faceRight: face.right,
              faceTop: face.top,
              faceBottom: face.bottom,
            };
          });
          expect(geometry.left).toBeGreaterThanOrEqual(geometry.faceLeft - 1);
          expect(geometry.right).toBeLessThanOrEqual(geometry.faceRight + 1);
          expect(geometry.top).toBeGreaterThanOrEqual(geometry.faceTop - 1);
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.faceBottom + 1);
        }
      };
      await expectFittedKeys();
      if (width === 393) await page.screenshot({ path: testInfo.outputPath('cash.png') });
      await tournaments.click();
      await expect(page.getByRole('tab')).toHaveText([
        "MTT'S",
        'SPINS',
        "SIT N GO'S",
        'SATELLITES',
      ]);
      await expectFittedKeys();
      await expect(cash).toHaveAttribute('aria-expanded', 'false');
      if (width === 393) await page.screenshot({ path: testInfo.outputPath('tournaments.png') });
      await tournaments.click();
      await expect(page.getByRole('tablist')).toHaveCount(0);
    });
  }
}
