/**
 * MEASURE THE VISIBLE HERO AND OPPONENT AVATAR ARTWORK (2026-11-09)
 *
 * Dan, 2026-11-09, item 4: "the 'hero' avatar is smaller then all the other
 * avatars at the table, it should always be the same size."
 *
 * The declared geometry says the opposite - `.seat.seat--hero` multiplies the
 * slot by --seat-avatar-hero-ratio (1.3333), so the hero's SLOT is a third
 * wider than a villain's at every breakpoint. This script measures what is
 * actually on screen instead of what the tokens declare, for the hero and
 * every opponent, across the supported widths and ring sizes, with the hero
 * carrying character art (what every existing e2e scene renders) and with the
 * hero carrying a photo (what a real human player has).
 *
 * It reports, per seat:
 *   disc  - the rendered `.seat__avatar` box: the circle a player sees, after
 *           every ancestor transform including --sp-opponent-art-scale
 *   art   - the painted subject inside it: the decoded alpha box of the
 *           portrait mapped through object-fit/object-position and the bust
 *           transform, then clipped to the disc (`.seat__avatar` is
 *           overflow: hidden, so nothing paints outside it)
 *
 * Read-only. It renders the same isolated rail fixture tests/e2e use, with the
 * repo's own stylesheets and bundled artwork, and touches no live service.
 *
 *   node scripts/dev/measure-seat-avatar-art.mjs
 *   node scripts/dev/measure-seat-avatar-art.mjs --json > /tmp/out.json
 */
import { chromium } from 'playwright';
import { buildSync } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = process.cwd();
const art = (name) => resolve(ROOT, 'tests/e2e/fixtures/table-art', name);
const WIDTHS = (process.env.WIDTHS || '320,375,393,430,480,600,768,1024').split(',').map(Number);
const RINGS = (process.env.RINGS || '2,6,9').split(',').map(Number);
const asJson = process.argv.includes('--json');
const HERO_KINDS = (process.env.HERO_KINDS || 'character-art,photo').split(',');

const readStyle = (file) =>
  readFileSync(resolve(ROOT, file), 'utf8').replace(
    /^\s*@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/gm,
    (_, imported) => readStyle(resolve(dirname(file), imported))
  );

const bundled = buildSync({
  entryPoints: ['tests/e2e/support/portraitRailFixture.tsx'],
  jsx: 'automatic',
  outfile: 'rail-fixture.js',
  bundle: true,
  write: false,
  metafile: true,
  format: 'iife',
  platform: 'browser',
  loader: { '.css': 'empty', '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl' },
  define: {
    'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://kuklfnapbkmacvwxktbh.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'local-fixture',
      VITE_MEDIA_BASE: 'https://smarter.poker/hub/club-arena/',
      DEV: true,
    }),
    'process.env.NODE_ENV': '"test"',
  },
});
const bundle = bundled.outputFiles.find((f) => f.path.endsWith('.js')).text;
const realCss = [
  'src/styles/club-engine.css',
  'src/styles/animations.css',
  'src/styles/metallic-popups.css',
  'src/styles/reducedMotion.css',
  'src/pages/MultiTablePage.css',
  'src/components/table/TableTabBar.css',
  'src/pages/TablePage.css',
  'src/components/table/ActionPanel.css',
  ...Object.keys(bundled.metafile.inputs).filter((f) => f.endsWith('.css')),
  'src/components/table/TableChat.css',
  'src/components/table/TableVisualHotfix.css',
]
  .filter((f, i, all) => all.indexOf(f) === i)
  .map(readStyle)
  .join('\n');

const avatarBytes = readFileSync(art('vip_wolf@2x.webp'));
const wideAvatarBytes = readFileSync(art('vip_aztec_warrior@2x.webp'));

/* A stand-in for a player's own uploaded portrait: opaque edge to edge, which
   is what a photograph is, so the painted subject fills whatever slot it gets.
   Square, so object-fit: cover neither crops nor letterboxes it. */
const PHOTO = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#6b4f2a"/><circle cx="128" cy="100" r="54" fill="#d8b48a"/><rect x="58" y="168" width="140" height="88" rx="24" fill="#2b3a5c"/></svg>`
).toString('base64')}`;

const browser = await chromium.launch();
const results = [];

for (const heroKind of HERO_KINDS) {
  for (const seats of RINGS) {
    for (const width of WIDTHS) {
      const page = await browser.newPage({
        viewport: { width, height: width < 500 ? 780 : 900 },
        deviceScaleFactor: 1,
      });
      await page.route('**/avatars/table/**', (route) =>
        route.fulfill({
          body: route.request().url().includes('vip_aztec_warrior') ? wideAvatarBytes : avatarBytes,
          contentType: 'image/webp',
        })
      );
      await page.route('**/cards/**', async (route) => {
        const path = new URL(route.request().url()).pathname.split('/cards/')[1];
        const png = resolve(ROOT, 'public/cards', path.replace(/\.webp$/, '.png'));
        const webp = resolve(ROOT, 'public/cards', path);
        const file = existsSync(webp) ? webp : png;
        if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
        await route.fulfill({
          body: readFileSync(file),
          contentType: file.endsWith('.png') ? 'image/png' : 'image/webp',
        });
      });
      await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
      await page.route('https://smarter.poker/hub/club-arena/__measure_avatars', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body:
            `<html data-seats="${seats}" data-cards="4" data-revealed="false" data-jackpot="none"` +
            (heroKind === 'photo' ? ` data-hero-avatar="${PHOTO}"` : '') +
            `><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
            `<style>${realCss}</style></head><body><div id="root"></div></body></html>`,
        })
      );
      await page.goto('https://smarter.poker/hub/club-arena/__measure_avatars', {
        waitUntil: 'domcontentloaded',
      });
      await page.addScriptTag({ content: bundle });
      await page.waitForFunction(
        (n) => document.querySelectorAll('.seat__avatar-img').length === n,
        seats
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.seat__avatar-img')].every(
          (i) => i.complete && i.naturalWidth > 0
        )
      );
      // The opponent-spacing allocator decodes every portrait before it sets a
      // scale. Give it its microtasks and two frames to settle.
      await page.waitForTimeout(600);

      const measured = await page.evaluate(async () => {
        const alphaBox = async (image) => {
          const probe = new Image();
          probe.src = image.currentSrc || image.src;
          await probe.decode();
          const canvas = document.createElement('canvas');
          canvas.width = probe.naturalWidth;
          canvas.height = probe.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(probe, 0, 0);
          const { data, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let left = w, top = h, right = 0, bottom = 0;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
              if (data[(y * w + x) * 4 + 3] > 128) {
                if (x < left) left = x;
                if (y < top) top = y;
                if (x + 1 > right) right = x + 1;
                if (y + 1 > bottom) bottom = y + 1;
              }
          return right > left
            ? { left: left / w, top: top / h, right: right / w, bottom: bottom / h }
            : { left: 0, top: 0, right: 1, bottom: 1 };
        };
        const out = [];
        for (const image of document.querySelectorAll('.seat__avatar-img')) {
          const seat = image.closest('.seat');
          const disc = image.closest('.seat__avatar');
          const discRect = disc.getBoundingClientRect();
          const imgRect = image.getBoundingClientRect();
          const style = getComputedStyle(image);
          const a = await alphaBox(image);
          // object-fit maps the natural box into the (already transformed,
          // uniformly scaled) image box; object-position picks the anchor.
          const fit =
            style.objectFit === 'contain'
              ? Math.min(imgRect.width / image.naturalWidth, imgRect.height / image.naturalHeight)
              : Math.max(imgRect.width / image.naturalWidth, imgRect.height / image.naturalHeight);
          const w = image.naturalWidth * fit;
          const h = image.naturalHeight * fit;
          const x = imgRect.left + (imgRect.width - w) / 2;
          const y =
            imgRect.top + (imgRect.height - h) * (style.objectPosition.endsWith('100%') ? 1 : 0.5);
          // `.seat__avatar` is overflow: hidden, so the disc is the clip.
          const top = Math.max(y + a.top * h, discRect.top);
          const bottom = Math.min(y + a.bottom * h, discRect.bottom);
          const left = Math.max(x + a.left * w, discRect.left);
          const right = Math.min(x + a.right * w, discRect.right);
          const cs = getComputedStyle(seat);
          out.push({
            hero: seat.classList.contains('seat--hero'),
            tokenBase: cs.getPropertyValue('--seat-avatar-base').trim(),
            tokenSize: cs.getPropertyValue('--seat-avatar-size').trim(),
            tokenRatio: cs.getPropertyValue('--seat-avatar-hero-ratio').trim(),
            bust: Boolean(image.closest('.seat__avatar--bust')),
            discW: +discRect.width.toFixed(2),
            discH: +discRect.height.toFixed(2),
            artW: +Math.max(0, right - left).toFixed(2),
            artH: +Math.max(0, bottom - top).toFixed(2),
            oppScale: +(
              parseFloat(disc.style.getPropertyValue('--sp-opponent-art-scale')) || 1
            ).toFixed(4),
          });
        }
        return out;
      });
      await page.close();

      const hero = measured.find((m) => m.hero);
      const villains = measured.filter((m) => !m.hero);
      results.push({ heroKind, seats, width, hero, villains });
    }
  }
}
await browser.close();

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const n = (v) => String(v).padStart(7);
  for (const heroKind of HERO_KINDS) {
    console.log(`\n=== HERO PORTRAIT: ${heroKind} ===`);
    console.log(
      'seats width | hero disc  hero art | villain disc (min..max) | villain art (min..max) | art ratio hero/villain-max'
    );
    for (const r of results.filter((r) => r.heroKind === heroKind)) {
      const dd = r.villains.map((v) => v.discH);
      const aa = r.villains.map((v) => v.artH);
      const ratio = Math.max(...aa) ? r.hero.artH / Math.max(...aa) : NaN;
      console.log(
        `${String(r.seats).padStart(5)} ${n(r.width)} |${n(r.hero.discH)} ${n(r.hero.artH)} |` +
          `${n(Math.min(...dd).toFixed(1))}..${Math.max(...dd).toFixed(1)} |` +
          `${n(Math.min(...aa).toFixed(1))}..${Math.max(...aa).toFixed(1)} |` +
          `  ${ratio.toFixed(3)}`
      );
    }
  }
}
