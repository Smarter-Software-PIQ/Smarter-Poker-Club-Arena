/**
 * Dan 2026-08-19, bug list item 4: "cards glitch once before display - all
 * cards shown at once after being dealt."
 *
 * Two causes, both in one keyframe.
 *
 *  1. THE GLITCH. heroCardPeek started every card at rotateY(90deg). A hole
 *     card is a SINGLE-SIDED element, so edge-on it has no width and nothing to
 *     draw - a flash of nothing, then the card snapping into existence. It then
 *     overshot past its resting size (scale 1.05, rotateY -10deg) and rocked
 *     back through two more keyframes, so the card visibly wobbled before
 *     settling.
 *
 *  2. NOT AT ONCE. Each card carried its own animation-delay - 0.1s, 0.25s,
 *     0.4s, 0.55s, 0.7s, 0.85s - so a PLO6 hand trickled in over most of a
 *     second, one card at a time.
 *
 * The cards now simply arrive: a short rise and fade, no rotation, no
 * overshoot, and no per-card stagger.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(process.cwd(), 'src/components/table/SeatSlot.css'), 'utf8');

const heroSeat = (cardCount: number) => `
  <div class="seat seat--hero seat--in-hand">
    <div class="seat__avatar-wrap"><div class="seat__avatar"></div></div>
    <div class="seat__info"><span class="seat__name">HERO</span></div>
    <div class="seat__cards seat__cards--hero">
      ${Array.from({ length: cardCount }, (_, i) => `<div class="seat__card seat__card--face" id="hc-${i}"></div>`).join('')}
    </div>
  </div>`;

const page = (n: number) => `
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #123; }
    :root { --seat-avatar-size: 112px; }
    .seat { position: relative; width: 128px; margin: 200px auto; }
    .seat__avatar { width: var(--seat-avatar-size); height: var(--seat-avatar-size); border-radius: 50%; background: #444; }
    .seat__info { width: 100%; height: 34px; background: #222; }
    .seat__card--face { background: #fff; }
  </style>
  <style>${css}</style>
  ${heroSeat(n)}`;

async function cardStyles(p: import('@playwright/test').Page, n: number) {
  return p.evaluate((count) => {
    return Array.from({ length: count }, (_, i) => {
      const el = document.getElementById(`hc-${i}`)!;
      const cs = getComputedStyle(el);
      return { delay: cs.animationDelay, name: cs.animationName, duration: cs.animationDuration };
    });
  }, n);
}

test.use({ viewport: { width: 900, height: 800 } });

for (const n of [2, 4, 5, 6]) {
  test(`${n} hole cards all start at the same instant`, async ({ page: p }) => {
    await p.setContent(page(n));
    const styles = await cardStyles(p, n);
    expect(styles).toHaveLength(n);
    const delays = new Set(styles.map((s) => s.delay));
    expect(delays.size).toBe(1); // no per-card stagger
    expect([...delays][0]).toBe('0s');
  });
}

test('the deal animation never turns the card edge-on', async ({ page: p }) => {
  await p.setContent(page(6));
  const [style] = await cardStyles(p, 1);
  expect(style.name).toBe('heroCardDeal');

  // Sample the card's width across the whole animation. A rotateY(90deg) frame
  // collapses it to zero - that is the glitch, and it must never happen.
  const widths = await p.evaluate(async () => {
    const el = document.getElementById('hc-0')!;
    const seen: number[] = [];
    for (let i = 0; i < 24; i++) {
      seen.push(el.getBoundingClientRect().width);
      await new Promise((r) => setTimeout(r, 15));
    }
    return seen;
  });
  expect(Math.min(...widths)).toBeGreaterThan(0);
});

test('the card never overshoots its resting size', async ({ page: p }) => {
  await p.setContent(page(2));
  const resting = await p.evaluate(() => {
    const el = document.getElementById('hc-0')!;
    return parseFloat(getComputedStyle(el).width);
  });
  const widths = await p.evaluate(async () => {
    const el = document.getElementById('hc-0')!;
    const seen: number[] = [];
    for (let i = 0; i < 24; i++) {
      seen.push(el.getBoundingClientRect().width);
      await new Promise((r) => setTimeout(r, 15));
    }
    return seen;
  });
  // Allow a hair for sub-pixel rounding; the old keyframe overshot by 5%.
  expect(Math.max(...widths)).toBeLessThanOrEqual(resting + 0.5);
});

test('the whole hand is on screen quickly, not trickled in', async ({ page: p }) => {
  await p.setContent(page(6));
  const styles = await cardStyles(p, 6);
  for (const s of styles) {
    expect(parseFloat(s.duration)).toBeLessThanOrEqual(0.4);
  }
});

// Complete artwork must survive cold caches and remounts too.
import { createServer, type ViteDevServer } from 'vite';
import { installCardArtworkFrames, cardArtworkFramesEvidence } from './support/cardArtworkFrames';
import { startCardArtworkRaster, CARD_ARTWORK_MAX_GAP_MS } from './support/cardArtworkRaster';

/**
 * WAIT FOR THE REVEAL WITH THE TEST'S OWN BUDGET, AND SAY WHAT WAS PENDING
 * (2026-11-07). Each `toHaveAttribute('data-ready', 'true', { timeout })`
 * below carried a fixed budget, failed once today on a cold runner and passed
 * on the rerun, and its failure said only that the attribute was still
 * "false". data-ready is useTableArt().reveal (see fixtures/cardArtReady.tsx),
 * so what it was waiting on is knowable: the deck, the felt, or the cover
 * expiry. This waits until the test's configured timeout would be reached
 * (less a margin for the assertions that follow), never a second guess at a
 * number, and fails with the fixture's readiness snapshot - which half was
 * still pending and how many deck faces had decoded - instead of a bare
 * timeout. The assertion is unchanged: data-ready must become "true".
 */
async function expectTableRevealed(
  page: import('@playwright/test').Page,
  startedAt: number,
  what: string
) {
  const configured = test.info().timeout;
  const margin = 5_000;
  const remaining = configured - (Date.now() - startedAt) - margin;
  const deadline = Date.now() + Math.max(remaining, 1_000);
  const ready = page.locator('[data-ready]');
  let attribute = await ready.getAttribute('data-ready');
  while (attribute !== 'true' && Date.now() < deadline) {
    await page.waitForTimeout(100);
    attribute = await ready.getAttribute('data-ready');
  }
  if (attribute === 'true') return;
  const readiness = await page
    .evaluate(() => (window as any).cardArtReadiness?.() ?? 'fixture exposes no readiness')
    .catch((error: Error) => `readiness unavailable: ${error.message}`);
  expect(
    attribute,
    `${what}: data-ready stayed ${JSON.stringify(attribute)} for ${Math.round(
      (Date.now() - startedAt) / 1000
    )}s of a ${configured / 1000}s test budget; still pending: ${JSON.stringify(readiness)}`
  ).toBe('true');
}

test.describe('decoded card artwork', () => {
  // Reuse this group's one Vite server; concurrent optimizers are not card-load work.
  test.describe.configure({ mode: 'default' });
  let server: ViteDevServer;
  let address: string;
  test.beforeAll(async () => {
    expect(fs.existsSync(path.resolve('dist/cards/4color/clubs_2.webp'))).toBe(true);
    server = await createServer({
      // CI already seals this build. Raw public/ has no generated WebP media.
      publicDir: path.resolve('dist'),
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'error',
      optimizeDeps: { entries: ['tests/e2e/fixtures/cardArtReady.tsx'] },
      // Same non-secret isolated configuration as the existing CI browser build.
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://example.supabase.co'),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('card-art-fixture'),
      },
    });
    const html = await server.transformIndexHtml(
      '/hub/club-arena/__card-art-test',
      `
<div id="root"></div><script type="module" src="/tests/e2e/fixtures/cardArtReady.tsx"></script>`
    );
    (server as any).__cardTestHtml = html;
    await server.listen();
    const info = server.httpServer!.address() as { port: number };
    address = `http://127.0.0.1:${info.port}/hub/club-arena/__card-art-test`;
  });
  test.afterAll(async () => {
    await server?.close();
  });

  test('cold cards are complete on first paint, subsequent hands and a deck change', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const startedAt = Date.now();
    await page.route('**/cards/*/*.webp', async (route) => {
      await new Promise((resolve) =>
        setTimeout(resolve, route.request().resourceType() === 'image' ? 6000 : 80)
      );
      await route.continue();
    });
    await page.route('**/__card-art-test', (route) =>
      route.fulfill({ contentType: 'text/html', body: (server as any).__cardTestHtml })
    );
    page.on('pageerror', (error) => console.log(error.message));
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-ready]')).toHaveAttribute('data-ready', 'false');
    await expectTableRevealed(page, startedAt, 'cold first paint');
    const complete = () =>
      page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        return Array.from(document.querySelectorAll<HTMLImageElement>('.card-image__img')).map(
          (img) => ({
            complete: img.complete && img.naturalWidth > 0,
            decoding: img.decoding,
            local: img.src.startsWith('blob:'),
          })
        );
      });
    expect(await complete()).toEqual(
      Array(7).fill({ complete: true, decoding: 'sync', local: true })
    );
    await page.context().setOffline(true);
    await page.evaluate(() => (window as any).nextHand());
    expect(await complete()).toEqual(
      Array(7).fill({ complete: true, decoding: 'sync', local: true })
    );
    await page.context().setOffline(false);
    await page.evaluate(() => (window as any).changeDeck());
    await expect(page.locator('[data-ready]')).toHaveAttribute('data-ready', 'false');
    await expectTableRevealed(page, startedAt, 'deck change');
    expect(await complete()).toEqual(
      Array(7).fill({ complete: true, decoding: 'sync', local: true })
    );
  });

  test('remounted board and public hole faces retain exact decoded pixels while their new images are pending', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const startedAt = Date.now();
    await page.route('**/__card-art-test', (route) =>
      route.fulfill({ contentType: 'text/html', body: (server as any).__cardTestHtml })
    );
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await expectTableRevealed(page, startedAt, 'remount pixels');
    const before = await page
      .locator('canvas.card-image__artwork')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLCanvasElement).toDataURL()));
    expect(before).toHaveLength(7);
    const first = await page.evaluate(async () => {
      // Reproduce the measured per-element pending state independently of the
      // decoded cache. The actual canvas pixels still come from real deck media.
      for (const key of ['complete', 'naturalWidth', 'naturalHeight'] as const) {
        const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, key)!;
        Object.defineProperty(HTMLImageElement.prototype, key, {
          configurable: true,
          get() {
            if (this.classList.contains('card-image__img')) return key === 'complete' ? false : 0;
            return original.get!.call(this);
          },
        });
      }
      (window as any).nextHand();
      await new Promise(requestAnimationFrame);
      return [...document.querySelectorAll<HTMLCanvasElement>('canvas.card-image__artwork')].map(
        (canvas) => ({
          ready: canvas.dataset.cardArtworkReady,
          width: canvas.width,
          targetWidth: Math.round(canvas.clientWidth * window.devicePixelRatio),
          pixels: canvas.toDataURL(),
          alpha: canvas
            .getContext('2d')!
            .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
            .data[3],
          pending: !canvas.parentElement!.querySelector<HTMLImageElement>('img')!.complete,
        })
      );
    });
    expect(first).toHaveLength(7);
    first.forEach((entry, index) => {
      expect(entry.ready).toBe('true');
      expect(Math.abs(entry.width - entry.targetWidth)).toBeLessThanOrEqual(1);
      expect(entry.pending).toBe(true);
      expect(entry.alpha).toBe(255);
      expect(entry.pixels).toBe(before[index]);
    });
    const lazy = await page.evaluate(async () => {
      (window as any).setCardLoading('lazy');
      await new Promise(requestAnimationFrame);
      return [...document.querySelectorAll<HTMLCanvasElement>('canvas.card-image__artwork')].map(
        (canvas) => ({
          width: canvas.width,
          height: canvas.height,
          ready: canvas.dataset.cardArtworkReady,
        })
      );
    });
    expect(lazy).toEqual(Array(7).fill({ width: 0, height: 0, ready: undefined }));
  });

  test('court artwork stays filtered after resizing and returning to a hidden table', async ({
    page,
  }) => {
    await page.route('**/__card-art-test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: (server as any).__cardTestHtml,
      })
    );
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await expectTableRevealed(page, Date.now(), 'filtered courts');
    for (const width of [65, 32, 80]) {
      await page.locator('.card-image').evaluateAll((nodes, width) => {
        for (const node of nodes)
          Object.assign((node as HTMLElement).style, {
            width: `${width}px`,
            height: `${width * 1.4}px`,
          });
      }, width);
      await expect
        .poll(() =>
          page
            .locator('canvas.card-image__artwork')
            .first()
            .evaluate((node) => node.width)
        )
        .toBe(Math.round(width * (await page.evaluate(() => devicePixelRatio))));
      const filtered = await page
        .locator('canvas.card-image__artwork')
        .evaluateAll(async (nodes) => {
          return Promise.all(
            nodes.map(async (node) => {
              const canvas = node as HTMLCanvasElement;
              const image = new Image();
              image.src = canvas.parentElement!.querySelector('img')!.src;
              await image.decode();
              const reference = document.createElement('canvas');
              reference.width = canvas.width;
              reference.height = canvas.height;
              const context = reference.getContext('2d')!;
              context.imageSmoothingQuality = 'high';
              context.drawImage(image, 0, 0, reference.width, reference.height);
              return canvas.toDataURL() === reference.toDataURL();
            })
          );
        });
      expect(filtered).toEqual(Array(7).fill(true));
      await page
        .locator('.table-page')
        .evaluate((node) => ((node as HTMLElement).style.display = 'none'));
      await page
        .locator('.table-page')
        .evaluate((node) => ((node as HTMLElement).style.display = 'block'));
    }
  });

  test('first-visible observer correlates real board and public hole artwork with compositor crops', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const startedAt = Date.now();
    await page.addInitScript(installCardArtworkFrames, {
      tableId: 'fixture',
      deadline: Date.now() + 50_000,
      maxFrameGapMs: CARD_ARTWORK_MAX_GAP_MS,
    });
    const raster = await startCardArtworkRaster(page);
    let passed = false;
    try {
      await page.route('**/__card-art-test', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: (server as any).__cardTestHtml,
        })
      );
      await page.goto(address, { waitUntil: 'domcontentloaded' });
      await expectTableRevealed(page, startedAt, 'first-visible observer');
      await expect
        .poll(() =>
          page.evaluate(() => window.__cardArtworkFrames?.snapshot().eligibleTableFrames ?? 0)
        )
        .toBeGreaterThan(2);
      await page.evaluate(() => (window as any).nextHand());
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__cardArtworkFrames?.snapshot().exposures.filter((e) => e.natural).length ?? 0
          )
        )
        .toBe(7);
      const snapshot = await page.evaluate(() => window.__cardArtworkFrames!.stop());
      const readiness = cardArtworkFramesEvidence(snapshot);
      expect(readiness.verdict, JSON.stringify(readiness)).toBe('qualified');
      const captures = await raster.capture(
        snapshot.exposures
          .filter((e) => e.natural)
          .map((e) => ({
            id: `${e.kind}-${e.id}-${e.sourceEpoch}-${e.visibilityEpoch}`,
            firstEligibleAt: e.firstEligibleAt,
            previousFrameAt: e.previousFrameAt,
            bounds: e.rasterBounds ?? e.bounds,
          }))
      );
      expect(captures).toHaveLength(7);
      for (const capture of captures) {
        expect(capture.verdict, capture.reason).toBe('captured');
        expect(capture.image!.subarray(1, 4).toString()).toBe('PNG');
      }
      passed = true;
    } finally {
      await page.evaluate(() => window.__cardArtworkFrames?.stop()).catch(() => undefined);
      await raster.stop().catch((error) => {
        if (passed) throw error; // Preserve the original failure if Playwright already closed the page.
      });
    }
  });
});
