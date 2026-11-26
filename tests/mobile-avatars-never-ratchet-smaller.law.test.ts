/**
 * LAW: PHONE AVATARS NEVER RATCHET SMALLER (Dan, 2026-11-18, binding)
 * ═══════════════════════════════════════════════════════════════════
 * Dan: "WHY DO ALL THE AVATARS KEEP SHRINKING AND REGRESSING ON MOBILE? ... I
 * KEEP FIXING IT AND MAKING IT SO THE AVATARS ARE AS LARGE AS THEY CAN BE
 * WITHOUT OVERLAPPING ANYTHING OR HIDING ANYTHING, AND THEN IT KEEPS
 * REGRESSING BACK TO THE SMALLER VERSIONS ... FOR BOTH 6 MAX AND FULL RING."
 *
 * Every pin below is a mechanism that actually shrank them (2026-11-12..18):
 *
 *  1. `sp-mobile-avatar-size-v1/v2/v3`: a per-device size record that could
 *     only move DOWN and capped every later table of that game type. One
 *     crowded table shrank that phone for good; no deploy could undo it.
 *  2. `--sp-nine-rail-bust` (one value for the whole ring) started from its
 *     own last value and could only be multiplied down: one wide portrait
 *     shrank every full-ring chair all session.
 *  3. The locked size was chosen from the moment the table opened: wagers on
 *     the felt, the chair the puck sat beside, a tabled hand.
 *  4. Six-max tournaments had no profile at all.
 *  5. The CSS base sizes were lowered as side effects of other fixes
 *     (#10796: 2.1 -> 1.7 for nine-seat) with no test reading them, and the
 *     browser checks asserted only "bigger than 1x".
 *
 * The approved sizes live in src/components/table/mobileAvatarSize.ts. Making
 * one smaller means editing that file and this law in the same commit, on
 * purpose, with Dan's say-so. A feature that needs room makes room around the
 * portrait; it never shrinks it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NINE_SEAT_PHONE_RAIL_BUST,
  PHONE_AVATAR_MIN_HEIGHT_PX,
  SIX_SEAT_PHONE_BUST_SCALE,
  SIX_SEAT_SPECTATOR_PHONE_BUST_SCALE,
} from '../src/components/table/mobileAvatarSize';
import { fixedRailBustLimit } from '../src/components/table/opponentAvatarLayout';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ENLARGE = 'src/components/table/mobileAvatarEnlargement.ts';
const RAIL = 'src/components/table/opponentAvatarLayout.ts';
const CSS = 'src/components/table/SeatSlot.css';

/** The approved sizes. Lowering one of these is the regression this law exists for. */
const APPROVED = {
  six: 2.1,
  sixSpectator: 2.3,
  nineRail: 1.7,
  heights: {
    sixSeat: 175,
    sixSeatSpectator: 191,
    nineSeatOpponent: 140,
    // Only on a page too short for the whole full-ring felt (2026-11-26).
    nineSeatOpponentHeightBound: 132,
    nineSeatHero: 187,
  },
};

describe('LAW: phone avatars never ratchet smaller', () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('the approved sizes are never lowered', () => {
    expect(SIX_SEAT_PHONE_BUST_SCALE).toBeGreaterThanOrEqual(APPROVED.six);
    expect(SIX_SEAT_SPECTATOR_PHONE_BUST_SCALE).toBeGreaterThanOrEqual(APPROVED.sixSpectator);
    expect(NINE_SEAT_PHONE_RAIL_BUST).toBeGreaterThanOrEqual(APPROVED.nineRail);
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.sixSeatSpectator).toBeGreaterThanOrEqual(
      APPROVED.heights.sixSeatSpectator
    );
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.sixSeat).toBeGreaterThanOrEqual(APPROVED.heights.sixSeat);
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponent).toBeGreaterThanOrEqual(
      APPROVED.heights.nineSeatOpponent
    );
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatHero).toBeGreaterThanOrEqual(
      APPROVED.heights.nineSeatHero
    );
    expect(PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponentHeightBound).toBeGreaterThanOrEqual(
      APPROVED.heights.nineSeatOpponentHeightBound
    );
  });

  it('SeatSlot.css draws exactly the approved sizes on a phone', () => {
    const css = read(CSS);
    const phone = css.match(
      /@media \(min-width: 481px\) and \(max-width: 640px\) and \(orientation: portrait\) \{\s*\.table-page:where\(\[data-seats='6'\], \[data-seats='9'\]\)\s*\.seat__cards--opponent:not\(\.seat__cards--revealed\) \{[^}]*\}\s*\.table-page:where\(\[data-seats='6'\], \[data-seats='9'\]\) \.seat-wrapper \{\s*--sp-bust-scale: ([\d.]+);/
    );
    expect(phone, 'the six/nine phone bust rule is where the law reads it').not.toBeNull();
    expect(Number(phone![1])).toBe(SIX_SEAT_PHONE_BUST_SCALE);
    const spectator = css.match(
      /\.table-page\[data-seats='6'\]\[data-hero='false'\] \.seat-wrapper \{\s*--sp-bust-scale: ([\d.]+);/
    );
    expect(spectator, 'the watched six-max rule').not.toBeNull();
    expect(Number(spectator![1])).toBe(SIX_SEAT_SPECTATOR_PHONE_BUST_SCALE);
    const rail = css.match(/--sp-bust-scale: var\(--sp-seat-rail-bust, ([\d.]+)\);/g) ?? [];
    expect(rail.length, 'one nine-seat rail fallback').toBe(1);
    expect(Number(rail[0].match(/([\d.]+)\);$/)![1])).toBe(NINE_SEAT_PHONE_RAIL_BUST);
  });

  it('nothing records a portrait size on the device, and every retired record is deleted', async () => {
    const source = read(ENLARGE);
    expect(source).not.toMatch(/localStorage\.(setItem|getItem)/);
    expect(source).not.toMatch(/sharedSizes|recordSharedSize|SHARED_SIZE_STORE/);
    for (const key of [
      'sp-mobile-avatar-size',
      'sp-mobile-avatar-size-v2',
      'sp-mobile-avatar-size-v3',
    ])
      localStorage.setItem(key, JSON.stringify({ 'cash|6|600': 90 }));
    localStorage.setItem('sp-unrelated', 'kept');
    vi.resetModules();
    await import('../src/components/table/mobileAvatarEnlargement');
    expect(localStorage.getItem('sp-mobile-avatar-size')).toBeNull();
    expect(localStorage.getItem('sp-mobile-avatar-size-v2')).toBeNull();
    expect(localStorage.getItem('sp-mobile-avatar-size-v3')).toBeNull();
    expect(localStorage.getItem('sp-unrelated')).toBe('kept');
  });

  it('one wide portrait limits only its own chair, and the rail never ratchets', () => {
    const source = read(RAIL);
    // No ring-wide rail value is written any more...
    expect(source).not.toMatch(/setProperty\(\s*'--sp-nine-rail-bust'/);
    expect(read(CSS)).not.toMatch(/--sp-nine-rail-bust/);
    // ...each chair asks how far it may grow, not only how far it must shrink,
    expect(source).toMatch(
      /fixedRailBustLimit\(\s*paint,\s*rect\.left \+ rect\.width \/ 2,\s*viewport,\s*board,\s*2 \* ratio,\s*Infinity\s*\)/
    );
    // ...is clamped to the approved base, and clears itself back to it.
    expect(source).toMatch(
      /Math\.min\(\s*NINE_SEAT_PHONE_RAIL_BUST,\s*Math\.floor\(current \* limit \* 1000\) \/ 1000\s*\)/
    );
    expect(source).toMatch(/wrapper\.style\.removeProperty\('--sp-seat-rail-bust'\)/);
    expect(source).not.toMatch(/\|\| 1\.7;/);
    // The geometry: room to spare answers a factor above 1 once uncapped.
    const viewport = { left: 0, top: 0, width: 600, height: 1200 };
    const board = { left: 200, top: 400, width: 200, height: 120 };
    const narrow = { left: 40, top: 420, width: 40, height: 80 };
    expect(fixedRailBustLimit(narrow, 60, viewport, board, 2)).toBe(1);
    expect(fixedRailBustLimit(narrow, 60, viewport, board, 2, Infinity)).toBeGreaterThan(1);
  });

  it('the locked size is chosen from permanent geometry, never from a moment of play', () => {
    const source = read(ENLARGE);
    const obstacles = source.slice(
      source.indexOf('function stableObstacles('),
      source.indexOf('export type MobilePaintState')
    );
    expect(obstacles).not.toMatch(/seat__bet-chips|seat__wager-group/);
    expect(obstacles).not.toMatch(/seat__cards--revealed/);
    const fit = source.slice(source.indexOf('export function enlargeMobileAvatars('));
    expect(fit).not.toMatch(/querySelectorAll\('\.seat__bet-chips'\)/);
    expect(fit).not.toMatch(/querySelector<HTMLElement>\('\.dealer-button'\)/);
    expect(fit).toMatch(/if \(!lock\?\.uniform && \(paintPending \|\| showdownPending\)\)/);
    // A button spot the ring's resting geometry already gives a neighbour is
    // not a veto on every size (it vetoed 1x itself, so no size ever locked).
    expect(fit).toMatch(/const resting = centresAt\(1\);/);
    expect(fit).toMatch(/const held = anchors\.filter\(\(anchor\) => reads\(anchor, resting\)\);/);
  });

  it('six-max and full-ring tournaments take the same phone profile as cash', () => {
    const source = read(ENLARGE);
    const key = source.slice(
      source.indexOf('function mobileProfileKey('),
      source.indexOf('const MOBILE_PROFILES')
    );
    expect(key).not.toMatch(/tournament/);
    expect(source).not.toMatch(
      /page\.dataset\.seats !== '9' && page\.classList\.contains\('table-page--tournament'\)/
    );
  });

  it('the browser checks assert absolute sizes, and never hide the device record', () => {
    const cases = read('tests/e2e/support/mobileAvatarSizingCases.ts');
    expect(cases).not.toMatch(/localStorage\.removeItem\('sp-mobile-avatar-size/);
    expect(cases).toMatch(/PHONE_AVATAR_MIN_HEIGHT_PX/);
    // The post-deploy live proof asks the same absolute question of production.
    const live = read('tests/e2e/support/mobileLiveTableLayout.ts');
    expect(live).toMatch(/PHONE_AVATAR_MIN_HEIGHT_PX/);
    expect(live).not.toMatch(/\)\s*>\s*1\s*\)/);
  });
});
