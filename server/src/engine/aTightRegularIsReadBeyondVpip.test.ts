/**
 * TIGHT BEYOND VPIP (2026-11-15, Hold'em Strategy lane, opponent classifier C2; option styleTightMultiSignal, read
 * === true, default OFF).
 *
 * The style read called a player tight only on VPIP: credibly below the Horse mean minus 0.02, which on the 120-hand
 * long window is VPIP <= 0.156 full ring. A full-ring regular at 15 to 18 percent who raises most of what he plays,
 * or folds to 3-bets often, stayed neutral; Hand Analysis graded one such human (VPIP 0.165 to 0.172 over 1,000+
 * tournament hands) tight by the observation method's 0.18 line while the engine read him neutral.
 *
 * Class definition and targets were declared before measurement (docs/changelog/2026-11-15-tight-beyond-vpip.md,
 * CLASS-DEFINITIONS): VPIP credibly below the Horse mean, corroborated by raise share or fold to 3-bet, no contrary
 * evidence, 90% on every signal. These tests pin the declared targets T1 to T5. Synthetic counters only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyOpponentStyle,
  tightMultiSignalRead,
  type OpponentStyleRead,
} from './HorseOpponentStyle.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { HorseMind } from './HorseMind.js';
import {
  STYLE_READ_OFF_GRID_BASE_PIN,
  styleReadOffGridPin,
} from './styleReadOffGrid.test-support.js';
import {
  decide,
  install,
  turnPotBet,
  VILLAIN,
  type Villain,
} from './HorseOpponentStyle.contexts.test-support.js';

/** Saturated windows: 30-hand 43.78 decayed hands, 120-hand 173.62, fast 12.05. */
const SHORT_N = 43.78;
const LONG_N = 173.62;
const FAST_N = 12.05;

interface Player {
  vpip: number;
  pfr: number;
  /** fold to 3-bet rate and its decayed opportunities */
  f3b?: number;
  f3bOpp?: number;
}
const countersOf = (
  p: Player
): ExploitCounters & { lHands: number; lVpip: number; lPfr: number } => {
  const c = freshExploitCounters();
  c.hands = SHORT_N;
  c.vpip = SHORT_N * p.vpip;
  c.pfr = SHORT_N * p.pfr;
  c.fHands = FAST_N;
  c.fPfr = FAST_N * p.pfr;
  c.foldTo3BetOpp = p.f3bOpp ?? 0;
  c.foldTo3Bet = (p.f3bOpp ?? 0) * (p.f3b ?? 0);
  return { ...c, lHands: LONG_N, lVpip: LONG_N * p.vpip, lPfr: LONG_N * p.pfr };
};
const read = (p: Player, on: boolean, size: 'full' | 'short' | 'hu' = 'full'): OpponentStyleRead =>
  classifyOpponentStyle({
    scope: `holdem:${size}` as never,
    variant: 'nlh',
    domain: 'cash',
    counters: countersOf(p),
    provenance: { source: 'live', complete: true },
    ...(on ? { tightMultiSignal: true } : {}),
  });

describe('T1: a selective full-ring regular at 15 to 17.2 percent is read tight (option on)', () => {
  // MEASURED (not as declared): a player who raises 82 percent of what he plays is ALREADY read tight with the option
  // off, through the existing call-share route (call share 0.03 against the Horse 0.076, credibly low on the long
  // window). The raise-share corroborator needs about the same raise share (0.78) as that route, so it adds nothing
  // here; the new route does not run because participation is not neutral.
  for (const vpip of [0.15, 0.165, 0.17, 0.172]) {
    it(`VPIP ${vpip}, raises 82 percent of what he plays: tight on and off (call-share route)`, () => {
      const p = { vpip, pfr: 0.82 * vpip };
      expect(read(p, true).participation.side).toBe('tight');
      expect(read(p, false).participation.side).toBe('tight');
      expect(read(p, true).receipt.tightMultiSignal?.startsWith('none:')).toBe(true);
    });
  }
  it('raises 70 to 75 percent of what he plays: neither route reads him tight (no corroboration at 90%)', () => {
    for (const share of [0.7, 0.75]) {
      expect(read({ vpip: 0.17, pfr: 0.17 * share }, false).participation.side).toBe('neutral');
      expect(read({ vpip: 0.17, pfr: 0.17 * share }, true).participation.side).toBe('neutral');
    }
  });
  it('fold to 3-bet corroborates alone: VPIP 0.17, raises 60 percent, folds 85 percent of 25 three-bets', () => {
    const p = { vpip: 0.17, pfr: 0.102, f3b: 0.85, f3bOpp: 25 };
    expect(read(p, false).participation.side).toBe('neutral');
    expect(read(p, true).participation.side).toBe('tight');
    expect(read(p, true).receipt.tightMultiSignal?.startsWith('tight:')).toBe(true);
    expect(read({ ...p, f3bOpp: 0 }, true).participation.side).toBe('neutral');
  });
});

describe('T2: a 17 percent caller-heavy player is never tight by this route', () => {
  it('raises 40 percent of what he plays, even folding 90 percent to 3-bets', () => {
    for (const f3bOpp of [0, 30]) {
      const r = read({ vpip: 0.17, pfr: 0.068, f3b: 0.9, f3bOpp }, true);
      expect(r.participation.side).not.toBe('tight');
    }
  });
});

describe('T3: loose and average players stay where they were', () => {
  const cases: Player[] = [
    { vpip: 0.21, pfr: 0.14 },
    { vpip: 0.25, pfr: 0.22 },
    { vpip: 0.32, pfr: 0.28, f3b: 0.95, f3bOpp: 30 },
    { vpip: 0.45, pfr: 0.1 },
  ];
  for (const p of cases)
    it(`VPIP ${p.vpip} PFR ${p.pfr}`, () => {
      const on = read(p, true);
      const off = read(p, false);
      expect(on.participation.side).not.toBe('tight');
      expect(on.participation.side).toBe(off.participation.side);
      expect(on.label).toBe(off.label);
    });
});

describe('T4: the graded human (VPIP 0.165 to 0.172, PFR 0.088 to 0.091) as measured', () => {
  it('raise share about 0.53 is below the Horse share (0.644): not tight without a fold-to-3-bet read', () => {
    for (const [vpip, pfr] of [
      [0.165, 0.088],
      [0.172, 0.091],
    ]) {
      const m = tightMultiSignalRead({
        vpipSuccesses: LONG_N * vpip,
        pfrSuccesses: LONG_N * pfr,
        hands: LONG_N,
        foldTo3Bet: 0,
        foldTo3BetOpp: 0,
        vpipMean: 0.2133,
        pfrMean: 0.1374,
        foldTo3BetMean: 0.5609,
        contrary: false,
      });
      const [vpipBelow, raiseAbove, raiseBelow] = m.receipt.split(':').map(Number);
      expect(vpipBelow).toBeGreaterThanOrEqual(0.9);
      expect(raiseAbove).toBeLessThan(0.15);
      expect(raiseBelow).toBeLessThan(0.9); // not caller-heavy either
      expect(m.tight).toBe(false);
      expect(read({ vpip, pfr }, true).participation.side).toBe('neutral');
    }
  });
  it('he is tight only if he also folds to 3-bets credibly more than Horses (0.80 of 30)', () => {
    expect(read({ vpip: 0.17, pfr: 0.09, f3b: 0.8, f3bOpp: 30 }, false).participation.side).toBe(
      'neutral'
    );
    expect(read({ vpip: 0.17, pfr: 0.09, f3b: 0.8, f3bOpp: 30 }, true).participation.side).toBe(
      'tight'
    );
    expect(read({ vpip: 0.17, pfr: 0.09, f3b: 0.6, f3bOpp: 30 }, true).participation.side).toBe(
      'neutral'
    );
  });
});

describe('the other table sizes, on their own Horse cells', () => {
  it('short-handed 27 percent raising 90 percent, heads-up 33 percent raising 90 percent: tight on', () => {
    expect(read({ vpip: 0.27, pfr: 0.243 }, true, 'short').participation.side).toBe('tight');
    expect(read({ vpip: 0.33, pfr: 0.297 }, true, 'hu').participation.side).toBe('tight');
  });
  it('short-handed 31 percent: VPIP not credibly below the short-handed Horse mean, so a fold-to-3-bet read cannot make him tight', () => {
    const p = { vpip: 0.31, pfr: 0.2, f3b: 0.98, f3bOpp: 40 };
    expect(read(p, false, 'short').participation.side).toBe('neutral');
    expect(read(p, true, 'short').participation.side).toBe('neutral');
  });
});

describe('fewer than 15 decayed hands: unknown, on or off', () => {
  it('a 10-hand selective player is unknown', () => {
    const c = countersOf({ vpip: 0.17, pfr: 0.15 });
    const thin = { ...c, hands: 10, vpip: 1.7, pfr: 1.5, lHands: 10, lVpip: 1.7, lPfr: 1.5 };
    const r = classifyOpponentStyle({
      scope: 'holdem:full' as never,
      variant: 'nlh',
      domain: 'cash',
      counters: thin,
      provenance: { source: 'live', complete: true },
      tightMultiSignal: true,
    });
    expect(r.evidence.state).not.toBe('supported_individual_read');
    expect(r.participation.side).toBe('neutral');
  });
});

describe('T5: option off, the read is byte for byte what it was', () => {
  it('a grid of 672 reads pins the hash captured on the base commit', () => {
    expect(styleReadOffGridPin()).toBe(STYLE_READ_OFF_GRID_BASE_PIN);
  });
});

describe('through HorseMind and a decision: the option travels with the scope', () => {
  afterEach(() => {
    HorseMind.reset();
    HorseMind.setDecisionScope(null);
  });
  const villain = (): Villain => ({
    // lifetime tallies: postflop aggression factor above 2.5 on 135 actions (the legacy maniac call-down line)
    stats: {
      hands: 400,
      aggr: 150,
      passive: 40,
      postAggr: 150,
      postPassive: 40,
      bigBetSD: 0,
      bigBetSDStrong: 0,
      rAggr: 3,
      rPassive: 6,
    },
    // the graded human's shape (VPIP 0.17, PFR 0.09) folding 80 percent of 30 three-bets
    counters: countersOf({ vpip: 0.17, pfr: 0.09, f3b: 0.8, f3bOpp: 30 }),
  });
  /** post-release opportunities, so this cash table-speed row's fold to 3-bet is not held out as pre-repair */
  const supplied = (): void => {
    HorseMind.importPostReleaseObservations([
      {
        user_id: VILLAIN,
        variant: 'nlh',
        mode: 'cash',
        size: 'full',
        opportunities: { foldToBet: 120, riverCall: 120, foldTo3Bet: 120, betCheckedTo: 120 },
      },
    ]);
  };
  it('the style read is tight and receipted only with the option on', () => {
    install(villain(), 'cash');
    supplied();
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.setDecisionReadOptions({});
    expect(HorseMind.styleRead(VILLAIN).participation.side).toBe('neutral');
    HorseMind.setDecisionReadOptions({ styleTightMultiSignal: true });
    const on = HorseMind.styleRead(VILLAIN);
    expect(on.participation.side).toBe('tight');
    expect(on.receipt.tightMultiSignal?.startsWith('tight:')).toBe(true);
  });
  it('a decision with #2 on: the tight route holds the legacy maniac call-down only with the option on', () => {
    const spot = turnPotBet('cash');
    install(villain(), 'cash');
    supplied();
    const off = decide(spot, { styleValueBettorNotManiac: true });
    install(villain(), 'cash');
    supplied();
    const on = decide(spot, { styleValueBettorNotManiac: true, styleTightMultiSignal: true });
    expect(off.fires.style_value_bettor_not_maniac_seen ?? 0).toBe(0);
    expect(on.fires.style_value_bettor_not_maniac_seen ?? 0).toBeGreaterThan(0);
    expect(on.fires.style_tight_multi_signal_seen ?? 0).toBeGreaterThan(0);
    // with the option absent, the decision is the one the base made
    install(villain(), 'cash');
    supplied();
    expect(decide(spot, { styleValueBettorNotManiac: true }).digest).toBe(off.digest);
  });
});
