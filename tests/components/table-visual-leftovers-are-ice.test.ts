/**
 * THE TABLE'S LAST GOLD AND CAPITALS (2026-11-28, follow-up to #12321)
 *
 * - The tab strip's turn pulse and the tournament winner sparkles glow ice and
 *   white, not gold. Only colours changed: the animation declarations that
 *   play them are pinned byte for byte (CLAUDE.md 10.6).
 * - The masthead no longer shouts through a CSS transform; club and union
 *   names are Title Cased at the print site by titleCaseName, which keeps a
 *   name typed in mixed case exactly as typed.
 * - The Hand Detail column key is readable silver inside the skin.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { titleCaseName } from '../../src/utils/titleCase';
import { getGameVariantLabel } from '../../src/lib/tableCardDisplay';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const TAB_CSS = read('src/components/table/TableTabBar.css');
const TAB_TSX = read('src/components/table/TableTabBar.tsx');
const WINNER_CSS = read('src/components/table/TournamentWinnerOverlay.css');
const PAGE_CSS = read('src/pages/TablePage.css');
const PAGE = read('src/pages/TablePage.tsx');
const HDV_CSS = read('src/components/handdetail/HandDetailView.css');

const GOLD = /255,\s*215,\s*0|#ffd700|#fffbe6|#fbbf24|#f5c518/i;

function block(css: string, head: string): string {
  const start = css.indexOf(head);
  expect(start, head).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unterminated ${head}`);
}

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('gold inside the animations is ice, and the animations still play', () => {
  it('the turn pulse keyframes carry ice, not gold', () => {
    const kf = block(TAB_CSS, '@keyframes pulseGlow');
    expect(kf).not.toMatch(GOLD);
    expect(kf).toMatch(/116, 223, 255/);
    expect(TAB_CSS).toContain('animation: pulseGlow 0.8s infinite alternate;');
  });

  it('the winner sparkles are white and ice, not gold', () => {
    const sparkle = block(WINNER_CSS, '.sparkle {');
    expect(sparkle).not.toMatch(GOLD);
    expect(sparkle).toMatch(/#ffffff 0%, #74dfff 55%/);
    expect(sparkle).toContain('animation: sparkleFloat 4000ms ease-in-out infinite;');
    expect(block(WINNER_CSS, '@keyframes sparkleFloat')).toMatch(
      /translateY\(18px\) scale\(0\.6\)[\s\S]*translateY\(-120px\) scale\(1\.05\)/
    );
  });
});

describe('the masthead prints names in Title Case at the source', () => {
  it('has no uppercase transform on its lines', () => {
    expect(block(PAGE_CSS, '.table-brand__line {')).toMatch(/text-transform: none;/);
  });

  it('runs every club and union name through titleCaseName', () => {
    expect(PAGE).not.toMatch(/table-brand__club-name">\{tableState\.clubName\}/);
    expect(PAGE.match(/titleCaseName\(tableState\.clubName\)/g)?.length).toBe(2);
    expect(PAGE.match(/titleCaseName\(tableState\.unionName\)/g)?.length).toBe(2);
  });

  it('says the bomb pot clock in Title Case', () => {
    expect(PAGE).toContain('`Bomb Pot In ${bombClockLabel}`');
    const badge = PAGE.slice(
      PAGE.indexOf('const bombPotBadge = useMemo'),
      PAGE.indexOf('tableState.bombPotWaitingFor,\n  ]);')
    );
    expect(badge.length).toBeGreaterThan(500);
    expect(badge).not.toMatch(/text: `[^`]*BOMB POT/);
    expect(badge).not.toContain("'TRIPLE BOARD '");
  });
});

describe('titleCaseName', () => {
  it.each([
    ['KINGS CLUB', 'Kings Club'],
    ['kings club', 'Kings Club'],
    ['MIDWAY PLO UNION', 'Midway PLO Union'],
    ['midway nlh club', 'Midway NLH Club'],
    ['The Felt Society', 'The Felt Society'],
    ['iPoker Nights', 'iPoker Nights'],
    ['Club McPoker', 'Club McPoker'],
    ['Cert RH 22430363', 'Cert RH 22430363'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(titleCaseName(input)).toBe(expected);
  });

  // Initialisms the acronym list does not know survive an all-caps name
  // (2026-11-28): no vowel and 2-5 letters, or 2-3 letters that are not a
  // short English word or common first name. "MSP POKER" was "Msp Poker".
  it.each([
    ['MSP POKER', 'MSP Poker'],
    ['BCLC HOLDEM NIGHTS', 'BCLC Holdem Nights'],
    ['NYC ACES', 'NYC Aces'],
    ['GTO LAB', 'GTO Lab'],
    ['THE ACE CLUB', 'The Ace Club'],
    ['BIG SLICK AND FRIENDS', 'Big Slick And Friends'],
    ['TOP DOG POKER', 'Top Dog Poker'],
    ["DAN'S HOME GAME", "Dan's Home Game"],
    ['JOE AND SAM', 'Joe And Sam'],
    ['MY SKY BAR', 'My Sky Bar'],
    ['ALL IN OR FOLD', 'All In Or Fold'],
    ['WPT-STYLE NIGHTS', 'WPT-Style Nights'],
    ['ROYAL FLUSH 2024', 'Royal Flush 2024'],
    // Lower case carries no signal, and a mixed-case name is never touched.
    ['msp poker', 'Msp Poker'],
    ['Msp Poker', 'Msp Poker'],
    ['MSP Poker Nights', 'MSP Poker Nights'],
  ])('keeps typed initialisms: %s -> %s', (input, expected) => {
    expect(titleCaseName(input)).toBe(expected);
  });

  it('is null safe', () => {
    expect(titleCaseName(null)).toBe('');
    expect(titleCaseName(undefined)).toBe('');
  });
});

describe('stored values print in Title Case', () => {
  it('the table header game label', () => {
    expect(getGameVariantLabel('nlh')).toBe("No Limit Hold'em");
    expect(getGameVariantLabel('plo8')).toBe('PLO Hi-Lo (8+)');
  });

  it('the tab strip labels', () => {
    expect(TAB_TSX).toMatch(/discard: 'Discard',\s*insurance: 'Insure',\s*rit: 'Run It',/);
    expect(TAB_TSX).toContain('table-tab-bar__tab-name">Seat<');
    expect(TAB_TSX).toContain('table-tab-bar__tab-name">Time Bank<');
  });
});

describe('the Hand Detail column key is readable inside the skin', () => {
  it('is silver at 4.5:1 or better on the console navy', () => {
    const rule = block(HDV_CSS, '.sc--sd .hdv__colkey {');
    /* The ink may be the palette token (src/styles/design-tokens.css,
       2026-11-28); resolve it to the value the browser paints. */
    const token = rule.match(/color: var\((--sd-[a-z-]+)\);/)?.[1];
    const ink = token
      ? fs
          .readFileSync(path.resolve(process.cwd(), 'src/styles/design-tokens.css'), 'utf8')
          .match(new RegExp(`${token}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1]
      : rule.match(/color: (#[0-9a-f]{6});/i)?.[1];
    expect(ink).toBeDefined();
    /* The lightest stop of the console case gradient (SpadeConsole.css). */
    expect(contrast(ink!, '#12273b')).toBeGreaterThanOrEqual(4.5);
  });
});
