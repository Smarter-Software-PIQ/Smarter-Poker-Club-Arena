/**
 * THE TABLE'S #SMARTERDESIGN, MEASURED ON WHAT THE BROWSER PAINTS (2026-11-28).
 *
 * Source-text tests missed three real regressions in one week:
 *   - gold that lived only in a skin-scoped rule (`.sc.sc--sd.sc--sd ...`),
 *     so the file a test read for the component held no gold at all;
 *   - uppercase that arrived from a shared console class, not the
 *     component's own stylesheet;
 *   - near-invisible #4a5462 ink on navy, which no grep for banned colours
 *     can see because the colour itself is legal.
 *
 * So this spec mounts the REAL components the table renders, offline, inside
 * the same `ConsoleSkinProvider value="smarterdesign"` MultiTableSurface gives
 * the table layer, with the app's real stylesheets in cascade order
 * (tests/e2e/support/tableSurfaces/). It opens each surface in turn at a phone
 * and a desktop size and reads every visible element's COMPUTED style:
 *
 *   1. no colour, fill, border, glow or gradient stop in a banned hue band
 *      (orange/gold/yellow 20-70 deg, purple/violet/pink 260-345 deg, above a
 *      saturation floor), artwork exempted by an explicit short list;
 *   2. no computed `text-transform: uppercase` on any text;
 *   3. text contrast against its effective backdrop of at least 4.5:1, or
 *      3:1 for 18px+ / bold 14px+ (WCAG AA), disabled controls excepted.
 *
 * Every surface must yield a floor of text elements and contrast checks, so
 * the spec can never pass by reading nothing. Animations and transitions are
 * stopped before reading, which exempts keyframe frames by construction: the
 * audit judges the resting style a player reads.
 *
 * No network: the page is a routed fixture origin; repository assets under
 * public/ are served from disk and every other request is aborted. Supabase
 * and the signed-in user are offline stand-ins.
 */
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { buildInkAudit, buildTableSurfaces } from '../support/tableSurfaces/buildTableSurfaces.mjs';
import {
  contrastFindings,
  type InkFinding,
  type SurfaceScan,
} from '../support/tableSurfaces/inkAudit';

const ROOT = resolve(process.cwd());
const ORIGIN = 'http://table-surfaces.fixture';
const PUBLIC = resolve(ROOT, 'public');

const VIEWPORTS = [
  { name: 'phone', width: 393, height: 852 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

type Surface = {
  id: string;
  label: string;
  /** Where the surface's own DOM lives once open (portals included). */
  root: string;
  /** Interaction after mount: expand a row, switch a tab. */
  open?: (page: Page) => Promise<void>;
  /** The least the audit must read, so an empty mount cannot pass. */
  minText: number;
};

const SURFACES: Surface[] = [
  { id: 'drawer', label: 'Table Drawer', root: '.table-menu__dropdown', minText: 10 },
  {
    id: 'hand-history',
    label: 'Hand History',
    root: '[role="dialog"], .hh-panel',
    minText: 6,
    open: async (page) => {
      await page.locator('[aria-expanded="false"]').first().click();
      await expect(page.locator('[aria-expanded="true"]').first()).toBeVisible();
    },
  },
  {
    id: 'hand-detail',
    label: 'Hand Detail',
    root: '[role="dialog"], .hdm-overlay',
    minText: 8,
    open: async (page) => {
      await page.getByRole('tab', { name: 'Hand Detail' }).click();
    },
  },
  { id: 'leaderboard', label: 'Leaderboard', root: '[role="dialog"], .sc--sd', minText: 6 },
  {
    id: 'session-stats',
    label: 'Session Stats (Real Time Result)',
    root: '[role="dialog"], .sc--sd',
    minText: 4,
  },
  { id: 'game-rules', label: 'Game Rules', root: '[role="dialog"], .sc--sd', minText: 8 },
  { id: 'table-studio', label: 'Table Studio', root: '[role="dialog"], .sc--sd', minText: 4 },
  { id: 'invite', label: 'Invite Online Friends', root: '[role="dialog"], .sc--sd', minText: 3 },
  {
    id: 'leave',
    label: 'Leave Table Confirm',
    root: '[role="dialog"], [role="alertdialog"], .sc--sd',
    minText: 3,
  },
  { id: 'chat', label: 'Table Chat', root: '.table-chat, [class*="table-chat"]', minText: 4 },
  { id: 'buy-in', label: 'Buy-In', root: '[role="dialog"], .sc--sd', minText: 5 },
  { id: 'insurance', label: 'Insurance', root: '[role="dialog"], .sc--sd', minText: 5 },
  { id: 'add-on', label: 'Add-On / Rebuy', root: '[role="dialog"], .sc--sd', minText: 4 },
];

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};

let bundle: { js: string; css: string };
let auditScript: string;

test.beforeAll(async () => {
  bundle = await buildTableSurfaces(ROOT);
  auditScript = buildInkAudit(ROOT);
});

async function mount(page: Page, surface: string) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html data-surface="${surface}"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>${bundle.css}</style>
<style>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:auto}</style>
</head><body><div id="root"></div></body></html>`,
      });
    }
    // Repository assets, by path, with or without the app's base path.
    const rel = decodeURIComponent(url.pathname.replace(/^\/hub\/club-arena\//, '/'));
    const file = resolve(PUBLIC, `.${rel}`);
    if (file.startsWith(PUBLIC + '/') && existsSync(file) && statSync(file).isFile()) {
      return route.fulfill({
        body: readFileSync(file),
        contentType: MIME[extname(file)] ?? 'application/octet-stream',
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: bundle.js });
  await page.addScriptTag({ content: auditScript });
  return errors;
}

/**
 * Scan computed styles, then read the backdrop behind every text run from a
 * viewport capture taken with all glyphs made transparent (the pixels the
 * player's eye actually separates the word from: gradients, chrome border
 * images and translucent layers included).
 */
async function audit(page: Page, selector: string) {
  const scan = await page.evaluate((sel) => {
    const roots = [...document.querySelectorAll(sel)];
    return (
      window as unknown as { InkAudit: { scanSurface: (r: Element[]) => SurfaceScan } }
    ).InkAudit.scanSurface(roots);
  }, selector);
  const hide = await page.addStyleTag({
    content:
      '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}',
  });
  await settle(page);
  const png = await page.screenshot({ scale: 'css' });
  await hide.evaluate((el) => el.remove());
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = contrastFindings(scan.samples, data, info.width, info.height, info.channels);
  const findings: InkFinding[] = [...scan.findings, ...c.findings];
  return { textElements: scan.textElements, checked: c.checked, skipped: c.skipped, findings };
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

for (const vp of VIEWPORTS) {
  for (const s of SURFACES) {
    test(`${s.label} wears #SmarterDesign ink at ${vp.width}x${vp.height}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const errors = await mount(page, s.id);
      await expect(page.locator(s.root).first(), `${s.label} never rendered`).toBeVisible({
        timeout: 15_000,
      });
      // Let first reads (offline stand-ins answer at once) paint.
      await page.waitForTimeout(400);
      if (s.open) await s.open(page);
      await settle(page);
      const result = await audit(page, s.root);
      if (process.env.TABLE_INK_SHOTS) {
        await page.screenshot({
          path: resolve(ROOT, `test-results/table-surfaces/${s.id}-${vp.name}.png`),
        });
      }
      const lines = result.findings.map((f) => `${f.kind}  ${f.where}  "${f.text}"  ${f.detail}`);
      expect(errors, `${s.label} threw while mounting`).toEqual([]);
      expect(
        result.textElements,
        `${s.label} read only ${result.textElements} text elements`
      ).toBeGreaterThanOrEqual(s.minText);
      expect(
        result.checked,
        `${s.label} checked contrast on only ${result.checked} runs (${result.skipped} skipped)`
      ).toBeGreaterThanOrEqual(Math.min(3, s.minText));
      expect(lines, `${s.label} at ${vp.name}`).toEqual([]);
    });
  }
}

/**
 * THE GUARD CAN FAIL. The three regressions of the week of 2026-11-24, planted
 * into a live surface the way they arrived: gold from a skin-scoped rule,
 * uppercase from a shared console class, and #4a5462 ink on navy. If the audit
 * stops reporting any of them, this case goes red before a real one can ship.
 */
test('the audit reports a skin-scoped gold, a shared-class uppercase and #4a5462 on navy', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await mount(page, 'buy-in');
  const root = '[role="dialog"], .sc--sd';
  await expect(page.locator(root).first()).toBeVisible({ timeout: 15_000 });
  await page.addStyleTag({
    content: `
      #root .table-page [role='dialog'] [class*='__head'] * { color: #e0b43c !important; }
      #root .table-page [role='dialog'] button,
      #root .table-page [role='dialog'] button * { text-transform: uppercase !important; }
      #root .table-page [role='dialog'] [class*='__stage'] * { color: #4a5462 !important; }
    `,
  });
  await settle(page);
  const result = await audit(page, root);
  const all = result.findings.map((f) => `${f.kind} ${f.where} ${f.detail}`).join('\n');
  const kinds = (k: InkFinding['kind']) => result.findings.filter((f) => f.kind === k);
  expect(
    kinds('banned-hue').some((f) => /#e0b43c|rgb\(224, 180, 60\)/.test(f.detail)),
    `gold title not reported:\n${all}`
  ).toBe(true);
  expect(kinds('uppercase').length, 'uppercase plate not reported').toBeGreaterThan(0);
  expect(kinds('contrast').length, '#4a5462 on navy not reported').toBeGreaterThan(0);
});
