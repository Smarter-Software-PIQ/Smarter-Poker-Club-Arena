// Print a route's console errors through the harness, for when a page renders its error boundary.
//   node probe.mjs 5199 dashboard-full 393
import { chromium } from 'playwright-core';
const [port, route, w] = process.argv.slice(2);
const b = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: Number(w), height: 900 } });
p.on('console', (m) => {
  if (m.type() === 'error') console.log('ERR', m.text().slice(0, 1500));
});
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 1500)));
await p.addInitScript(() => localStorage.setItem('club_arena_welcome_accepted', 'true'));
await p.goto(`http://127.0.0.1:${port}/hub/club-arena/clubs/kings-club/${route}`);
await p.waitForTimeout(8000);
await b.close();
