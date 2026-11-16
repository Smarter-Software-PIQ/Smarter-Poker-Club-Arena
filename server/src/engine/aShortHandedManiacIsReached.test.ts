/**
 * SHORT-HANDED MANIAC REACH (2026-11-15, Hold'em Strategy lane; option holdemManiacShortHandedReach, read === true,
 * default OFF).
 *
 * Short-handed and heads-up the regular PFR line is so high that only an extreme raiser has a preflop maniac width.
 * With the option on, a short-handed or heads-up no-limit hold'em opponent who bets credibly more than any Horse when
 * checked to (0.55 or more) and does not fold to bets (0.36 or less), on 15+ decayed hands, takes the maniac width
 * from that postflop evidence (HorseOpponentExploit.withManiacShortHandedReach). Synthetic counters only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MANIAC_MIN_RAISE_WIDTH,
  maniacRaiseWidth,
  opponentExploitRead,
  withManiacShortHandedReach,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { HorseMind } from './HorseMind.js';
import {
  MANIAC_READ_GRID_BASE_PIN,
  maniacReadGridPin,
  raiser,
} from './maniacReadGrid.test-support.js';
import {
  decide,
  install,
  preflopOpen,
  VILLAIN,
} from './HorseOpponentStyle.contexts.test-support.js';

type Size = 'full' | 'short' | 'hu';
const scopeOf = (size: Size) => `holdem:${size}` as never;
/** A player at PFR `pfr` who bets `bet` of his checked-to spots and folds `fold` of the bets he faces. */
const player = (hands: number, pfr: number, bet: number, fold: number): ExploitCounters => {
  const c = raiser({ hands, pfr, rfi: Math.min(1, pfr + 0.2) });
  const post = hands * 0.6;
  const fast = Math.min(hands, 12.05) * 0.6;
  c.betCheckedToOpp = post;
  c.betCheckedTo = post * bet;
  c.foldToBetOpp = post;
  c.foldToBet = post * fold;
  c.fBetCheckedToOpp = fast;
  c.fBetCheckedTo = fast * bet;
  c.fFoldToBetOpp = fast;
  c.fFoldToBet = fast * fold;
  return c;
};
const widths = (c: ExploitCounters, size: Size): [number | null, number | null] => {
  const read = opponentExploitRead(c, scopeOf(size), 'nlh');
  return [
    maniacRaiseWidth(read),
    maniacRaiseWidth(withManiacShortHandedReach(read, c, scopeOf(size))),
  ];
};

describe('realistic aggressive regulars are not reached at any sample', () => {
  for (const [size, pfr, bet, fold] of [
    ['short', 0.4, 0.5, 0.45],
    ['short', 0.45, 0.6, 0.4],
    ['short', 0.5, 0.65, 0.35],
    ['hu', 0.45, 0.5, 0.45],
    ['hu', 0.5, 0.6, 0.4],
  ] as const)
    it(`${size}: PFR ${pfr}, bets ${bet} when checked to, folds ${fold} to bets`, () => {
      for (const hands of [15.56, 30, 43.78])
        expect(widths(player(hands, pfr, bet, fold), size), `${hands}`).toEqual([null, null]);
    });
});

describe('a sustained short-handed or heads-up maniac is reached', () => {
  for (const size of ['short', 'hu'] as const) {
    it(`${size}: bets 0.9 when checked to and folds 0.1, PFR 0.4: reached at 15.56 decayed hands (about 19 played)`, () => {
      expect(widths(player(10, 0.4, 0.9, 0.1), size)).toEqual([null, null]);
      const [before, after] = widths(player(15.56, 0.4, 0.9, 0.1), size);
      expect(before).toBeNull();
      expect(after).not.toBeNull();
      expect(after!).toBeGreaterThanOrEqual(MANIAC_MIN_RAISE_WIDTH);
    });
    it(`${size}: bets 0.8 when checked to and folds 0.2, PFR 0.4: reached by 30 decayed hands`, () => {
      const [before, after] = widths(player(30, 0.4, 0.8, 0.2), size);
      expect(before).toBeNull();
      expect(after).not.toBeNull();
    });
  }
  it('the width is his PFR when that is wider than the floor', () => {
    const c = player(43.78, 0.5, 0.9, 0.1);
    const read = opponentExploitRead(c, scopeOf('short'), 'nlh');
    const reached = withManiacShortHandedReach(read, c, scopeOf('short'));
    expect(reached?.maniacReach?.width).toBeCloseTo(
      Math.max(MANIAC_MIN_RAISE_WIDTH, read!.stats.pfr.mean),
      12
    );
  });
});

describe('where the reach does not apply', () => {
  it('full ring: the same player is returned unchanged', () => {
    const c = player(43.78, 0.2, 0.9, 0.1);
    const read = opponentExploitRead(c, scopeOf('full'), 'nlh');
    expect(withManiacShortHandedReach(read, c, scopeOf('full'))).toBe(read);
  });
  it('a read that already has a width is returned unchanged', () => {
    const c = player(43.78, 0.9, 0.9, 0.1);
    const read = opponentExploitRead(c, scopeOf('short'), 'nlh');
    expect(maniacRaiseWidth(read)).not.toBeNull();
    expect(withManiacShortHandedReach(read, c, scopeOf('short'))).toBe(read);
  });
  it('a bettor who folds to bets (0.5) is not reached', () => {
    expect(widths(player(43.78, 0.4, 0.9, 0.5), 'short')).toEqual([null, null]);
  });
});

describe('option off, every read is what it was', () => {
  it('the grid of 1,536 reads still pins the base hash', () => {
    expect(maniacReadGridPin()).toBe(MANIAC_READ_GRID_BASE_PIN);
  });
});

describe('through HorseMind and a decision', () => {
  afterEach(() => {
    HorseMind.reset();
    HorseMind.setDecisionScope(null);
  });
  const fresh = () =>
    install(
      { stats: { hands: 40, aggr: 30, passive: 6 }, counters: player(43.78, 0.4, 0.9, 0.1) },
      'cash',
      'short'
    );
  it('opponentRead carries the reach only with the option on, at a short-handed scope', () => {
    fresh();
    HorseMind.setDecisionScope('holdem:short' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({});
    const off = HorseMind.opponentRead(VILLAIN);
    expect(off?.maniacReach).toBeUndefined();
    expect(maniacRaiseWidth(off)).toBeNull();
    HorseMind.setDecisionReadOptions({ holdemManiacShortHandedReach: true });
    const on = HorseMind.opponentRead(VILLAIN);
    expect(on?.maniacReach?.hands).toBeCloseTo(43.78, 6);
    expect(maniacRaiseWidth(on)).not.toBeNull();
  });
  it('a full-ring decision is identical with the option on and off, and off equals the default', () => {
    const spot = preflopOpen('cash');
    install(
      { stats: { hands: 40, aggr: 30, passive: 6 }, counters: player(43.78, 0.2, 0.9, 0.1) },
      'cash'
    );
    const off = decide(spot, {});
    install(
      { stats: { hands: 40, aggr: 30, passive: 6 }, counters: player(43.78, 0.2, 0.9, 0.1) },
      'cash'
    );
    const on = decide(spot, { holdemManiacShortHandedReach: true });
    expect(on.digest).toBe(off.digest);
    expect(on.fires.holdem_maniac_short_handed_reach_seen ?? 0).toBe(0);
    install(
      { stats: { hands: 40, aggr: 30, passive: 6 }, counters: player(43.78, 0.2, 0.9, 0.1) },
      'cash'
    );
    expect(decide(spot, { holdemManiacShortHandedReach: false }).digest).toBe(off.digest);
  });
});
