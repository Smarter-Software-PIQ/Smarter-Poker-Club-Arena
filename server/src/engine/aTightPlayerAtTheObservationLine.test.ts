/**
 * TIGHT AT THE OBSERVATION LINE (2026-11-16, Hold'em Strategy lane; option styleTightMethodLine, read === true,
 * default OFF).
 *
 * On four builds the human-vs-Horse observation graded "tight NOT MET": the people it classed tight (50 or more
 * hands, VPIP at or below 0.18 at a full table) sat at VPIP 0.157 to 0.171 with PFR near 0.09, and the style read
 * left them neutral. Its own tight side needs VPIP credibly below the Horse mean minus a margin, and the
 * multi-signal route (styleTightMultiSignal) needs a corroborating raise share or fold to 3-bet, which a tight
 * player who mostly calls does not have.
 *
 * Class definition declared before measurement (docs/changelog/2026-11-16-tight-at-the-observation-line.md). These
 * tests pin it on synthetic counters, including the two graded people's rates.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyOpponentStyle,
  tightMethodLineRead,
  TIGHT_METHOD_LINE,
  type OpponentStyleRead,
} from './HorseOpponentStyle.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';

/** Saturated windows: 30-hand 43.78 decayed hands, 120-hand 173.62 (as aTightRegularIsReadBeyondVpip). */
const SHORT_N = 43.78;
const LONG_N = 173.62;

interface Player {
  vpip: number;
  pfr: number;
  /** hands in the long window (default: saturated) */
  longHands?: number;
}
const countersOf = (
  p: Player
): ExploitCounters & { lHands: number; lVpip: number; lPfr: number } => {
  const c = freshExploitCounters();
  const long = p.longHands ?? LONG_N;
  c.hands = Math.min(SHORT_N, long);
  c.vpip = c.hands * p.vpip;
  c.pfr = c.hands * p.pfr;
  return { ...c, lHands: long, lVpip: long * p.vpip, lPfr: long * p.pfr };
};
const read = (
  p: Player,
  on: boolean,
  size: 'full' | 'short' | 'hu' = 'full',
  variant = 'nlh'
): OpponentStyleRead =>
  classifyOpponentStyle({
    scope: `holdem:${size}` as never,
    variant,
    domain: 'cash',
    counters: countersOf(p),
    provenance: { source: 'live', complete: true },
    ...(on ? { tightMethodLine: true } : {}),
  });

describe('the two graded people (full table, VPIP 0.157 and 0.167, PFR near 0.09)', () => {
  for (const p of [
    { vpip: 0.1567, pfr: 0.0823 },
    { vpip: 0.1669, pfr: 0.0914 },
  ])
    it(`VPIP ${p.vpip} PFR ${p.pfr}: neutral with the option off, tight with it on`, () => {
      const off = read(p, false);
      const on = read(p, true);
      expect(off.participation.side).toBe('neutral');
      expect(off.receipt.tightMethodLine).toBeUndefined();
      expect(on.participation.side).toBe('tight');
      expect(on.participation.credible).toBe(true);
      expect(on.receipt.tightMethodLine?.startsWith('tight:')).toBe(true);
      // confidence n / (n + 50) on the 173.62-hand window, never above the low-side cap
      expect(on.participation.confidence).toBeGreaterThan(0.7);
      expect(on.participation.confidence).toBeLessThanOrEqual(LONG_N / (LONG_N + 50) + 1e-9);
    });
});

describe('what the route does not name tight', () => {
  it('an average or loose player (on equals off)', () => {
    for (const p of [
      { vpip: 0.2133, pfr: 0.1374 },
      { vpip: 0.19, pfr: 0.12 },
      { vpip: 0.25, pfr: 0.2 },
      { vpip: 0.45, pfr: 0.1 },
    ]) {
      const on = read(p, true);
      const off = read(p, false);
      expect(on.participation.side).not.toBe('tight');
      expect(on.participation.side).toBe(off.participation.side);
      expect(on.label).toBe(off.label);
    }
  });
  it('VPIP at the line but not credibly below the Horse mean (0.18 on 60 hands)', () => {
    const r = read({ vpip: 0.18, pfr: 0.09, longHands: 60 }, true);
    expect(r.participation.side).toBe('neutral');
    expect(r.receipt.tightMethodLine?.startsWith('none:')).toBe(true);
  });
  it('fewer than 50 hands, however low the VPIP', () => {
    expect(read({ vpip: 0.1, pfr: 0.05, longHands: 45 }, true).receipt.tightMethodLine).toMatch(
      /^none:/
    );
  });
  it('a player who raises more than the average Horse (the other routes own him)', () => {
    const r = tightMethodLineRead({
      vpipSuccesses: 0.16 * LONG_N,
      pfrSuccesses: 0.15 * LONG_N,
      hands: LONG_N,
      line: 0.18,
      vpipMean: 0.2133,
      pfrMean: 0.1374,
      contrary: false,
    });
    expect(r.tight).toBe(false);
  });
  it('contrary evidence, or a table size with no line', () => {
    const base = {
      vpipSuccesses: 0.16 * LONG_N,
      pfrSuccesses: 0.08 * LONG_N,
      hands: LONG_N,
      vpipMean: 0.2133,
      pfrMean: 0.1374,
    };
    expect(tightMethodLineRead({ ...base, line: 0.18, contrary: false }).tight).toBe(true);
    expect(tightMethodLineRead({ ...base, line: 0.18, contrary: true }).tight).toBe(false);
    expect(tightMethodLineRead({ ...base, line: null, contrary: false }).tight).toBe(false);
  });
  it("heads-up (no line) and fixed-limit hold'em (its own population) are never read by the route", () => {
    const p = { vpip: 0.16, pfr: 0.08 };
    expect(read(p, true, 'hu').receipt.tightMethodLine ?? 'none:').toMatch(/^none:/);
    expect(read(p, true, 'full', 'flh').receipt.tightMethodLine).toBeUndefined();
  });
  it('non-NLH variants (flh, pineapple, short_deck, plo4) stay neutral and never run the route', () => {
    const checkExcluded = (
      scope: string,
      variant: string,
      vpip: number,
      pfr: number,
      hands: number,
      shortVpip = vpip,
      shortPfr = pfr
    ) => {
      const c = freshExploitCounters();
      c.hands = Math.min(SHORT_N, hands);
      c.vpip = c.hands * shortVpip;
      c.pfr = c.hands * shortPfr;
      const counters = { ...c, lHands: hands, lVpip: hands * vpip, lPfr: hands * pfr };
      const off = classifyOpponentStyle({
        scope: scope as never,
        variant,
        domain: 'cash',
        counters,
        provenance: { source: 'live', complete: true },
      });
      const on = classifyOpponentStyle({
        scope: scope as never,
        variant,
        domain: 'cash',
        counters,
        provenance: { source: 'live', complete: true },
        tightMethodLine: true,
      });
      expect(off.participation.side).toBe('neutral');
      expect(on.participation.side).toBe('neutral');
      expect(on.receipt.tightMethodLine).toBeUndefined();
    };
    // Each case has long-window rates that tightMethodLineRead would name tight against that variant's cell if ungated:
    checkExcluded('holdem:full', 'flh', 0.18, 0.1, 80);
    checkExcluded('holdem:short', 'pineapple', 0.3, 0.2, 50, 0.42, 0.26);
    checkExcluded('sixplus:short', 'short_deck', 0.3, 0.2, 50, 0.43, 0.25);
    checkExcluded('holdem:short', 'short_deck', 0.3, 0.2, 50, 0.43, 0.25);
    checkExcluded('omaha:short', 'plo4', 0.295, 0.2, 120);
    checkExcluded('holdem:short', 'plo4', 0.295, 0.2, 120);
  });
});

describe('the 50-hand minimum decides (every other condition met, the earlier routes neutral)', () => {
  const p = { vpip: 0.13, pfr: 0.065 };
  it('VPIP 0.13 PFR 0.065 at a full table: 48 long-window hands stay neutral, 52 read tight', () => {
    // the base route leaves this player neutral at both sizes of window, so only this route can name him tight
    expect(read({ ...p, longHands: 48 }, false).participation.side).toBe('neutral');
    expect(read({ ...p, longHands: 52 }, false).participation.side).toBe('neutral');
    const under = read({ ...p, longHands: 48 }, true);
    expect(under.participation.side).toBe('neutral');
    expect(under.receipt.tightMethodLine?.startsWith('none:')).toBe(true);
    const over = read({ ...p, longHands: 52 }, true);
    expect(over.participation.side).toBe('tight');
    expect(over.receipt.tightMethodLine?.startsWith('tight:')).toBe(true);
  });
  it('the pure read: 49.9 hands refuse, 50 admit', () => {
    const at = (hands: number) =>
      tightMethodLineRead({
        vpipSuccesses: 0.1 * hands,
        pfrSuccesses: 0.05 * hands,
        hands,
        line: 0.18,
        vpipMean: 0.2133,
        pfrMean: 0.1374,
        contrary: false,
      }).tight;
    expect(at(49.9)).toBe(false);
    expect(at(50)).toBe(true);
  });
});

describe('short-handed: the method line is 0.30', () => {
  it('VPIP 0.285 PFR 0.15 on a saturated window: neutral off, tight on (the full-table line would refuse it)', () => {
    const p = { vpip: 0.285, pfr: 0.15 };
    expect(read(p, false, 'short').participation.side).toBe('neutral');
    const on = read(p, true, 'short');
    expect(on.participation.side).toBe('tight');
    expect(on.receipt.tightMethodLine?.startsWith('tight:0.3:')).toBe(true);
  });
  it('the pure read at the short line: 0.28 passes 0.30 and fails 0.18', () => {
    const base = {
      vpipSuccesses: 0.28 * LONG_N,
      pfrSuccesses: 0.15 * LONG_N,
      hands: LONG_N,
      vpipMean: 0.3449,
      pfrMean: 0.2605,
      contrary: false,
    };
    expect(tightMethodLineRead({ ...base, line: 0.3 }).tight).toBe(true);
    expect(tightMethodLineRead({ ...base, line: 0.18 }).tight).toBe(false);
    expect(tightMethodLineRead({ ...base, vpipSuccesses: 0.31 * LONG_N, line: 0.3 }).tight).toBe(
      false
    );
  });
  it("the lines are the observation method's", () => {
    expect(TIGHT_METHOD_LINE.line).toEqual({ full: 0.18, short: 0.3 });
    expect(TIGHT_METHOD_LINE.minHands).toBe(50);
  });
});
