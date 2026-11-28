#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TABLE SKIN INK — the #SmarterDesign rules, read from the table's stylesheets
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan's #SmarterDesign table (2026-11-27): ink-navy surfaces, white titles,
 * silver support ink, ice blue emphasis, cobalt for selected or primary.
 * Never yellow, gold, amber, orange, purple, violet, lavender, pink or magenta
 * in UI ink, borders or fills. Title Case, never `text-transform: uppercase`.
 * No `:hover` (phones do not hover; tests/no-hover-effects.law.test.ts).
 *
 * This is the SOURCE half. The rendered half is
 * tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts, which reads the
 * browser's computed styles and painted pixels: a source check cannot see a
 * colour that arrives from a shared class or a skin-scoped rule in another
 * file, and a rendered check cannot see a rule for a state it never opened.
 * Each catches what the other misses, so both run.
 *
 * WHAT IT CHECKS, in every stylesheet under src/components/table,
 * src/components/console and src/components/handdetail (comments ignored):
 *   - `text-transform: uppercase`
 *   - any `:hover` selector
 *   - a raw colour literal (#hex, rgb(), hsl(), or a named colour) whose hue
 *     sits in a banned band (20-70 deg orange/gold/yellow, 260-345 deg
 *     purple/violet/pink/magenta) above the saturation floor the rendered
 *     guard uses (tests/e2e/support/tableSurfaces/inkAudit.ts).
 *
 * ARTWORK is exempt from the hue rule only (cards, chips, throwables, felt
 * themes and their animations carry their own colours): ARTWORK_FILES below,
 * one reason each. Nothing is exempt from the uppercase or :hover rules.
 *
 * BASELINE. Turning this on found older literals in surfaces the #SmarterDesign
 * passes had not reached (mostly painted-skin rules a `.sc--sd` override now
 * outranks, and on-felt labels). They are frozen here by COUNT per file and
 * rule, so the check lands green and anything NEW fails. The baseline may only
 * shrink: an entry whose count drops must be lowered in the same commit (the
 * check says so), and an entry may never be raised. Adding to it is not a fix.
 *
 * Run: node scripts/ci/check-table-skin-ink.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.TABLE_SKIN_INK_ROOT || process.cwd());
const DIRS = ['src/components/table', 'src/components/console', 'src/components/handdetail'];

/** Artwork stylesheets: hue rule only. Keep short; every line is a hiding place. */
export const ARTWORK_FILES = {
  'src/components/table/CardImage.css': 'playing card faces and backs',
  'src/components/table/CommunityCards.css': 'board cards and their deal/flip art',
  'src/components/table/DealAnimation.css': 'deal animation keyframes',
  'src/components/table/ChipAnimation.module.css': 'chip artwork in flight',
  'src/components/table/ChipPhysics.css': 'chip artwork in flight',
  'src/components/table/ThrowableSelector.css': 'purchased throwable artwork previews',
  'src/components/table/ThrowableSignatures.css': 'purchased throwable signature effects',
  'src/components/table/ThrowAnimation.css': 'throwable flight and impact keyframes',
  'src/components/table/BombPotOverlay.css': 'Bomb Pot artwork',
  'src/components/table/BombPotWheel.css': 'Bomb Pot wheel artwork',
  'src/components/table/ControlThemeTokens.css': 'player-purchased controller themes',
  'src/components/table/TableStudioGameplayPreview.css':
    "Table Studio's miniature of the felt and the player's purchased theme",
  'src/components/table/PremiumCard.css': 'premium card-back artwork',
  'src/components/table/SeatKnockout.css': 'knockout celebration keyframes',
};

/**
 * Frozen counts, 2026-11-28. Shrink only. `hue` is banned-hue literals,
 * `upper` is uppercase transforms. A file absent here allows zero of each.
 */
export const BASELINE = {
  'src/components/handdetail/HandDetailView.css': { hue: 19 },
  'src/components/handdetail/HandFlagControl.css': { hue: 8 },
  'src/components/handdetail/HandNoteEditor.css': { hue: 6 },
  'src/components/table/ActionController.css': { upper: 1 },
  'src/components/table/ActionPanel.css': { hue: 2, upper: 3 },
  'src/components/table/AddOnModal.css': { hue: 1 },
  'src/components/table/BadBeatJackpot.css': { hue: 5, upper: 2 },
  'src/components/table/BBJCelebration.css': { upper: 4 },
  'src/components/table/BombPotWheel.css': { upper: 1 },
  'src/components/table/ChatBubble.css': { upper: 1 },
  'src/components/table/CommunityCards.css': { upper: 2 },
  'src/components/table/HandReveal.css': { hue: 3, upper: 1 },
  'src/components/table/PotDisplay.css': { hue: 23, upper: 4 },
  'src/components/table/PreActionBar.css': { hue: 7, upper: 2 },
  'src/components/table/RabbitHunt.css': { hue: 4 },
  'src/components/table/RunItTwice.css': { hue: 4 },
  'src/components/table/SeatSlot.css': { hue: 79, upper: 6 },
  'src/components/table/TableChat.css': { hue: 3 },
  'src/components/table/TablePerfMonitor.css': { upper: 1 },
  'src/components/table/TableReactions.css': { hue: 4, upper: 1 },
  'src/components/table/TournamentAnnouncementOverlay.css': { hue: 4 },
};

export const BANNED_BANDS = [
  [20, 70, 'orange/gold/yellow'],
  [260, 345, 'purple/violet/pink/magenta'],
];
const SATURATION_FLOOR = 0.18;
const CHROMA_FLOOR = 0.1;

/** Named colours a stylesheet could reach for, as hex. */
const NAMED = {
  gold: 'ffd700',
  goldenrod: 'daa520',
  darkgoldenrod: 'b8860b',
  orange: 'ffa500',
  darkorange: 'ff8c00',
  yellow: 'ffff00',
  khaki: 'f0e68c',
  purple: '800080',
  violet: 'ee82ee',
  darkviolet: '9400d3',
  blueviolet: '8a2be2',
  mediumpurple: '9370db',
  rebeccapurple: '663399',
  orchid: 'da70d6',
  plum: 'dda0dd',
  lavender: 'e6e6fa',
  magenta: 'ff00ff',
  fuchsia: 'ff00ff',
  pink: 'ffc0cb',
  hotpink: 'ff69b4',
  deeppink: 'ff1493',
  amber: 'ffbf00',
};

export function hueOf(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  const l = (max + min) / 2;
  const s = c === 0 ? 0 : c / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (c) {
    if (max === r) h = 60 * (((g - b) / c) % 6);
    else if (max === g) h = 60 * ((b - r) / c + 2);
    else h = 60 * ((r - g) / c + 4);
  }
  if (h < 0) h += 360;
  return { h, s, c };
}

export function bannedBand(r, g, b) {
  const { h, s, c } = hueOf(r, g, b);
  if (s < SATURATION_FLOOR || c < CHROMA_FLOOR) return null;
  for (const [lo, hi, name] of BANNED_BANDS) if (h >= lo && h <= hi) return name;
  return null;
}

function hex(x) {
  const v = x.length === 3 || x.length === 4 ? [...x.slice(0, 3)].map((c) => c + c).join('') : x;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** Every colour literal in a declaration value, as [literal, r, g, b]. */
export function literalsIn(value) {
  const out = [];
  for (const m of value.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi))
    out.push([m[0], ...hex(m[1].slice(0, m[1].length === 8 ? 6 : m[1].length))]);
  for (const m of value.matchAll(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/gi))
    out.push([m[0] + ')', +m[1], +m[2], +m[3]]);
  for (const m of value.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/gi))
    out.push([m[0] + ')', ...hslToRgb(+m[1], +m[2] / 100, +m[3] / 100)]);
  for (const m of value.matchAll(/(?<![\w-])([a-z]+)(?![\w-])/gi)) {
    const named = NAMED[m[1].toLowerCase()];
    if (named) out.push([m[1], ...hex(named)]);
  }
  return out;
}

/** Comments blanked (newlines kept so line numbers hold), strings left. */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Findings for one stylesheet's text. Declarations only: a selector or an
 * attribute value (`[style*='#ffd700']`, which matches gold in order to
 * REPLACE it) is not ink.
 */
export function scanStylesheet(css, { artwork = false } = {}) {
  const text = stripComments(css);
  const findings = [];
  const lineAt = (i) => text.slice(0, i).split('\n').length;
  // Selectors: everything before a `{`.
  for (const m of text.matchAll(/([^{};]+)\{/g)) {
    if (/:hover\b/.test(m[1]) && !/^\s*@/.test(m[1]))
      findings.push({ rule: 'hover', line: lineAt(m.index), detail: m[1].trim().slice(0, 80) });
  }
  // Declarations: `prop: value` inside a block.
  for (const m of text.matchAll(/(?<=[{;]\s*)([-\w]+)\s*:\s*([^;{}]+)/g)) {
    const prop = m[1].toLowerCase();
    const value = m[2];
    const at = m.index;
    if (prop === 'text-transform' && /\buppercase\b/i.test(value))
      findings.push({ rule: 'upper', line: lineAt(at), detail: `${prop}: ${value.trim()}` });
    if (artwork) continue;
    for (const [lit, r, g, b] of literalsIn(value)) {
      const band = bannedBand(r, g, b);
      if (band)
        findings.push({
          rule: 'hue',
          line: lineAt(at),
          detail: `${prop}: ${lit} is ${band}`,
        });
    }
  }
  return findings;
}

function walk(dir) {
  const out = [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

function main() {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d))).sort();
  if (files.length === 0) {
    console.error('check-table-skin-ink: UNKNOWN - found no table stylesheets to read');
    process.exit(3);
  }
  const failures = [];
  const shrink = [];
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/');
    const findings = scanStylesheet(readFileSync(file, 'utf8'), { artwork: rel in ARTWORK_FILES });
    const allowed = BASELINE[rel] ?? {};
    for (const rule of ['hue', 'upper', 'hover']) {
      const mine = findings.filter((f) => f.rule === rule);
      const cap = allowed[rule] ?? 0;
      if (mine.length > cap) {
        failures.push(
          `${rel}: ${mine.length} ${rule} finding(s), baseline allows ${cap}\n` +
            mine.map((f) => `    line ${f.line}: ${f.detail}`).join('\n')
        );
      } else if (mine.length < cap) {
        shrink.push(
          `${rel}: ${rule} is now ${mine.length} (baseline ${cap}); lower BASELINE to ${mine.length}`
        );
      }
    }
  }
  for (const rel of Object.keys(BASELINE))
    if (!files.some((f) => relative(ROOT, f).split('\\').join('/') === rel))
      shrink.push(`${rel}: no longer exists; delete its BASELINE entry`);
  if (failures.length || shrink.length) {
    console.error('check-table-skin-ink: #SmarterDesign table stylesheet rules');
    for (const f of failures) console.error(`  ${f}`);
    for (const s of shrink) console.error(`  ${s}`);
    console.error(
      '\n  Ice, silver, white and cobalt are the table ink (docs/SMARTERDESIGN-TABLE-PALETTE.md);' +
        '\n  Title Case comes from the copy, not text-transform; :active, never :hover.'
    );
    process.exit(1);
  }
  console.log(`check-table-skin-ink: ${files.length} table stylesheets clean against the baseline`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
