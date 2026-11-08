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
      const leatherPlate =
        'assets/club-buttons/lobby/chrome-arena-controls-v1/table-leather-v1.webp';
      await page.route(`**/${leatherPlate}`, (route) =>
        route.fulfill({ contentType: 'image/webp', body: readFileSync(`public/${leatherPlate}`) })
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
      await page.evaluate(async () => {
        const faces = await document.fonts.load('800 20px "Roboto Condensed"');
        await document.fonts.ready;
        if (!faces.length || !faces.every((face) => face.status === 'loaded'))
          throw new Error('The approved font must load before measuring the compact frames');
      });
      for (const button of [cash, tournaments]) {
        const rect = await button.boundingBox();
        expect(rect!.height).toBeGreaterThanOrEqual(44);
        expect(rect!.width).toBeGreaterThanOrEqual(140);
        const paint = await button.evaluate(async (el) => {
          const { backgroundImage, backgroundPosition, backgroundSize } = getComputedStyle(el);
          const plate = new Image();
          plate.src = backgroundImage.slice('url("'.length, -2);
          await plate.decode();
          return {
            source: plate.src,
            width: plate.naturalWidth,
            height: plate.naturalHeight,
            position: backgroundPosition,
            size: backgroundSize,
          };
        });
        expect(paint.source).toContain(leatherPlate);
        expect(paint.width / paint.height).toBeCloseTo(1566 / 504, 2);
        expect(rect!.width / rect!.height).toBeCloseTo(paint.width / paint.height, 2);
        expect(paint.position).toBe('50% 50%');
        expect(paint.size).toBe('contain');
        await expect
          .poll(
            () =>
              button.evaluate((el) => {
                const box = el.getBoundingClientRect();
                const text = el.querySelector('.lobby-game-sections__well > span')!;
                const range = document.createRange();
                range.selectNodeContents(text);
                const ink = range.getBoundingClientRect();
                return (
                  ink.width > 0 &&
                  ink.height > 0 &&
                  ink.left >= box.left + box.width * 0.185 - 1 &&
                  ink.right <= box.right - box.width * 0.185 + 1 &&
                  ink.top >= box.top + box.height * 0.22 - 1 &&
                  ink.bottom <= box.top + box.height * 0.78 + 1 &&
                  Math.abs((ink.left + ink.right - box.left - box.right) / 2) <= 1 &&
                  Math.abs((ink.top + ink.bottom - box.top - box.bottom) / 2) <= 1
                );
              }),
            { message: 'Full labels must fit and center inside the quilted face' }
          )
          .toBe(true);
        await testInfo.attach(`family-frame-${width}-${await button.textContent()}.json`, {
          body: JSON.stringify(paint),
          contentType: 'application/json',
        });
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
      await page.screenshot({ path: testInfo.outputPath(`compact-family-frames-${width}px.png`) });
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
      await expect(page.getByRole('tablist')).toHaveCount(1);
      await expect(tournaments).toHaveAttribute('aria-expanded', 'true');
    });
  }
}
