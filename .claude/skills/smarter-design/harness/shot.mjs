// Screenshot routes through the harness.
//   node shot.mjs http://127.0.0.1:5199 /tmp/after operations,dashboard-full 393,1280
// A route is the part after /clubs/kings-club/, or an app path starting with
// "/" for pages outside the club (e.g. /wallet, /legal/tos). Each page renders
// at the given widths, waits until it has finished loading, then is captured
// at its full height with fixed bars in their real place (the viewport is grown
// to the page height, not stitched).
import { chromium } from 'playwright-core';

const [base, out, routesArg, widthsArg = '393,1280'] = process.argv.slice(2);
if (!base || !out || !routesArg) {
  console.error('usage: node shot.mjs <base> <outDir> <route,route> [393,1280]');
  process.exit(2);
}
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
// --disable-dev-shm-usage: a container's 64 MB /dev/shm crashes tall captures.
const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

/**
 * Settled = the lazy route chunk has drawn (no PageSkeleton, whose role=status
 * is labelled "Loading content", and no LoadingSpinner left), nothing
 * announces aria-busy, fonts are ready, and the DOM has stopped changing for
 * 1.5 s. The first load after a server start re-optimises dependencies and used
 * to be captured as a grey skeleton under the old fixed 6 s wait.
 */
async function settle(page) {
  await page
    .waitForFunction(
      () =>
        !document.querySelector(
          '[aria-label="Loading content"], .loading-spinner-container, [class*="skeleton" i], [aria-busy="true"]'
        ) && document.fonts.status === 'loaded',
      null,
      { timeout: 45000 }
    )
    .catch(() => console.log(`  ${page.url()}: still loading after 45 s; capturing anyway`));
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let timer = setTimeout(done, 1500);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, 1500);
        });
        function done() {
          observer.disconnect();
          resolve(undefined);
        }
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        setTimeout(done, 12000);
      })
  );
}

for (const w of widthsArg.split(',').map(Number)) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: w < 600 ? 852 : 900 },
    deviceScaleFactor: 2,
  });
  for (const route of routesArg.split(',')) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    // The first-visit welcome modal would cover the page.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('club_arena_welcome_accepted', 'true');
      } catch {
        /* storage unavailable */
      }
    });
    const path = route.startsWith('/') ? route : `/clubs/kings-club/${route}`;
    await page.goto(`${base}/hub/club-arena${path}`, { waitUntil: 'load', timeout: 90000 });
    await settle(page);
    const h = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
    );
    await page.setViewportSize({ width: w, height: Math.min(h, 12000) });
    await page.waitForTimeout(800);
    const name = route.replace(/^\//, '').replace(/[^a-z0-9-]+/gi, '_');
    await page.screenshot({ path: `${out}/${name}-${w}.png` });
    if (errors.length) console.log(route, w, errors.join(' | '));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
