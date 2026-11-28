// Screenshot club routes through the harness.
//   node shot.mjs http://127.0.0.1:5199 /tmp/after operations,dashboard-full 393,1280
// A route is the part after /clubs/kings-club/. Each page renders at the given
// widths, waits for data, then is captured at its full height with fixed bars in
// their real place (the viewport is grown to the page height, not stitched).
import { chromium } from 'playwright-core';

const [base, out, routesArg, widthsArg = '393,1280'] = process.argv.slice(2);
if (!base || !out || !routesArg) {
  console.error('usage: node shot.mjs <base> <outDir> <route,route> [393,1280]');
  process.exit(2);
}
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
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
    await page.goto(`${base}/hub/club-arena/clubs/kings-club/${route}`, {
      waitUntil: 'load',
      timeout: 90000,
    });
    await page.waitForTimeout(6000);
    const h = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
    );
    await page.setViewportSize({ width: w, height: Math.min(h, 12000) });
    await page.waitForTimeout(800);
    const name = route.replace(/[^a-z0-9-]+/gi, '_');
    await page.screenshot({ path: `${out}/${name}-${w}.png` });
    if (errors.length) console.log(route, w, errors.join(' | '));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
