/**
 * READ CALIBRATION FOLLOW-UP (2026-11-08): HorseDecideOpts.readBreakEvenBluff
 * and readScopedShrink.
 *
 *  - Break-even bluffing: the postflop bluff multiplier follows the fold
 *    share above s / (1 + s) for the size being bet, read from the corrected
 *    postflop fold-to-bet counters shrunk toward the game's population. It
 *    answers only for an opponent whose postflop bluff read is engaged
 *    (2026-11-08): a stranger, a horse-like regular and every opponent while
 *    reads are off keep the price they had with the flag off.
 *  - Scoped shrink: a thin scoped bucket answers for its own game, shrunk
 *    toward that game's population, instead of the pooled bucket that mixes
 *    every game the player has played.
 *
 * Both default off: with neither option every read is what it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREAK_EVEN_MOD_MAX,
  BREAK_EVEN_MOD_MIN,
  BREAK_EVEN_PRIOR_STRENGTH,
  BREAK_EVEN_REFERENCE_MOD,
  BREAK_EVEN_REFERENCE_SIZE,
  HorseMind,
  SCOPED_SHRINK_PRIOR,
  SCOPED_SHRINK_STRENGTH,
  breakEvenBluffMod,
  breakEvenCurveFold,
  breakEvenFoldShare,
  readScopeOf,
  shrinkScopedStats,
  type DecisionReadOptions,
  type OpponentStats,
  type ReadScope,
} from './HorseMind.js';
import { exploitEnvelopeFor } from './HorseOpponentExploit.js';
import type { ActionRecord } from '../types.js';

const NLH_HU = readScopeOf('nlh', 2);
const PLO_HU = readScopeOf('plo4', 2);
let clock = 1_790_000_000_000;
let handNo = 0;

type Line = 'preflopFold' | 'postflopCall' | 'postflopFold';

function hand(line: Line): ActionRecord[] {
  const t = (clock += 1000);
  const a = (
    seat: number,
    userId: string,
    action: ActionRecord['action'],
    amount: number,
    stage: ActionRecord['stage'],
    extra: Partial<ActionRecord> = {}
  ): ActionRecord => ({ seat, userId, action, amount, stage, timestamp: t, ...extra });
  const h: ActionRecord[] = [a(1, 'hero', 'raise', 6, 'preflop', { isFullRaise: true })];
  if (line === 'preflopFold') {
    h.push(a(2, 'villain', 'fold', 0, 'preflop', { origin: 'player' }));
    return h;
  }
  h.push(a(2, 'villain', 'call', 6, 'preflop'));
  h.push(a(1, 'hero', 'bet', 8, 'flop', { isFullRaise: true }));
  h.push(
    line === 'postflopFold'
      ? a(2, 'villain', 'fold', 0, 'flop', { origin: 'player' })
      : a(2, 'villain', 'call', 8, 'flop')
  );
  return h;
}

function play(scope: ReadScope, line: Line, times: number): void {
  for (let i = 0; i < times; i++) {
    const h = hand(line);
    handNo++;
    const identity = {
      version: 1 as const,
      tableId: '3e272439-6a6e-44a0-be35-3db383c300c3',
      handNumber: 2_000_000 + handNo,
    };
    HorseMind.setDecisionScope(scope);
    HorseMind.observe(h, [], identity, 2);
    HorseMind.setDecisionScope(null);
    HorseMind.observeHandComplete(`t:${handNo}`, h, 2, null, scope);
  }
}

function decide<T>(
  options: DecisionReadOptions,
  fn: () => T,
  scope: ReadScope = NLH_HU,
  variant = 'nlh'
): T {
  HorseMind.setDecisionScope(scope, variant, 'cash');
  HorseMind.setDecisionReadOptions(options);
  try {
    return fn();
  } finally {
    HorseMind.setDecisionScope(null);
  }
}

beforeEach(() => {
  HorseMind.reset();
  handNo = 0;
});
afterEach(() => HorseMind.setDecisionScope(null));

describe('breakEvenBluffMod', () => {
  it('keeps the population at the tuned volume at the reference size', () => {
    for (const family of ['holdem', 'omaha'] as const)
      expect(breakEvenBluffMod(0, family, BREAK_EVEN_REFERENCE_SIZE)).toBeCloseTo(
        BREAK_EVEN_REFERENCE_MOD,
        12
      );
  });

  it('is proportional to the fold share above s / (1 + s), clamped', () => {
    const s = BREAK_EVEN_REFERENCE_SIZE;
    const refSurplus = breakEvenCurveFold('holdem', s) - s / (1 + s);
    // Half the reference surplus: half the reference volume.
    expect(breakEvenBluffMod(-refSurplus / 2, 'holdem', s)).toBeCloseTo(
      BREAK_EVEN_REFERENCE_MOD / 2,
      12
    );
    // At or below break-even the floor (a semi-bluff still has equity).
    expect(breakEvenBluffMod(-refSurplus, 'holdem', s)).toBe(BREAK_EVEN_MOD_MIN);
    expect(breakEvenBluffMod(-0.5, 'holdem', s)).toBe(BREAK_EVEN_MOD_MIN);
    expect(breakEvenBluffMod(0.4, 'holdem', s)).toBe(BREAK_EVEN_MOD_MAX);
    // Monotone in the read.
    let prev = 0;
    for (let d = -0.2; d <= 0.2; d += 0.01) {
      const m = breakEvenBluffMod(d, 'holdem', s);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('prices each size by its own break-even: an overbet needs far more folds than a third-pot bet', () => {
    // A player folding 5 points under the population: a third-pot bet clears
    // its 25% break-even comfortably, a 2.4x overbet (71%) does not.
    expect(breakEvenBluffMod(-0.05, 'holdem', 0.33)).toBeGreaterThan(1);
    expect(breakEvenBluffMod(-0.05, 'holdem', 2.4)).toBe(BREAK_EVEN_MOD_MIN);
    // Omaha players barely fold to small bets: a quarter-pot stab earns less
    // than the reference size against the same population.
    expect(breakEvenBluffMod(0, 'omaha', 0.25)).toBeLessThan(breakEvenBluffMod(0, 'omaha', 0.67));
  });

  it('a semi-bluff with a live draw needs fewer folds than air', () => {
    expect(breakEvenFoldShare(0.5)).toBeCloseTo(0.5 / 1.5, 12);
    // Less equity, more folds needed, down to none from half the pot.
    let prev = Infinity;
    for (let e = 0; e <= 0.5; e += 0.05) {
      const f = breakEvenFoldShare(0.75, e);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
    expect(breakEvenFoldShare(1, 0.5)).toBe(0);
    expect(breakEvenFoldShare(1, 0.7)).toBe(0);
    // Into a station, air is at the floor and the draw keeps betting more.
    expect(breakEvenBluffMod(-0.25, 'holdem', 0.6)).toBe(BREAK_EVEN_MOD_MIN);
    expect(breakEvenBluffMod(-0.25, 'holdem', 0.6, 0.4)).toBeGreaterThan(BREAK_EVEN_MOD_MIN);
  });

  it('a semi-bluff is priced against CHECKING, not against giving the pot up (2026-11-08)', () => {
    // At the break-even share betting is worth exactly what checking keeps:
    // f + (1 - f)(e(1 + 2s) - s) = e, for every size and equity below half.
    for (const s of [0.33, 0.5, 0.75, 1, 1.5])
      for (const e of [0, 0.1, 0.2, 0.3, 0.4, 0.49]) {
        const f = breakEvenFoldShare(s, e);
        expect(f + (1 - f) * (e * (1 + 2 * s) - s)).toBeCloseTo(e, 12);
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThanOrEqual(s / (1 + s));
      }
    // The first version said a pot bet with 40% (or a third) of the equity
    // needed no folds at all, because the call alone beat giving up.
    expect(breakEvenFoldShare(1, 0.4)).toBeCloseTo(0.25, 12);
    expect(breakEvenFoldShare(1, 1 / 3)).toBeCloseTo(1 / 3, 12);
    // So a third-of-the-pot draw into a station no longer bets at the ceiling.
    expect(breakEvenBluffMod(-0.25, 'holdem', 1, 1 / 3)).toBeLessThan(BREAK_EVEN_MOD_MAX);
    expect(breakEvenBluffMod(-0.25, 'holdem', 1, 1 / 3)).toBeGreaterThan(
      breakEvenBluffMod(-0.25, 'holdem', 1)
    );
    // Bad input never escapes [0, 1).
    expect(breakEvenFoldShare(Number.NaN, 0.2)).toBe(0);
    expect(breakEvenFoldShare(0.5, Number.NaN)).toBeCloseTo(0.5 / 1.5, 12);
  });

  it('reads the curve flat beyond its measured sizes and never returns NaN', () => {
    expect(breakEvenCurveFold('omaha', 3)).toBe(breakEvenCurveFold('omaha', 0.99));
    expect(breakEvenCurveFold('holdem', 0.01)).toBe(breakEvenCurveFold('holdem', 0.24));
    expect(Number.isFinite(breakEvenBluffMod(0, 'holdem', Number.NaN))).toBe(true);
  });
});

describe('readBreakEvenBluff', () => {
  it('reads a preflop folder who calls every postflop bet as a station: bluffs at the floor', () => {
    for (let i = 0; i < 20; i++) {
      play(NLH_HU, 'preflopFold', 4);
      play(NLH_HU, 'postflopCall', 1);
    }
    // The all-street rate the legacy price reads still sees a folder; the
    // postflop read (engaged low, a station) is what the break-even reads.
    expect(decide({}, () => HorseMind.foldVsAggressionRate('villain'))!).toBeGreaterThan(0.62);
    expect(decide({}, () => HorseMind.opponentRead('villain'))!.stats.foldToBet.engaged).toBe(
      'low'
    );
    const legacy = decide({}, () => HorseMind.exploit('villain').bluffMod);
    const on = decide({ breakEvenBluff: true }, () => HorseMind.breakEvenBluffOf('villain'));
    expect(on!.mod).toBe(BREAK_EVEN_MOD_MIN);
    // bluffMod, which other consumers read as a classification, is unchanged.
    expect(decide({ breakEvenBluff: true }, () => HorseMind.exploit('villain').bluffMod)).toBe(
      legacy
    );
  });

  it('bluffs a postflop over-folder at the ceiling and leaves an unknown at its old price', () => {
    play(NLH_HU, 'postflopFold', 30);
    expect(decide({ breakEvenBluff: true }, () => HorseMind.breakEvenBluffOf('villain'))!.mod).toBe(
      BREAK_EVEN_MOD_MAX
    );
    // No postflop sample at all: no break-even read, so the existing neutral
    // price answers (2026-11-08; the first version gave the population x1.45).
    expect(decide({ breakEvenBluff: true }, () => HorseMind.breakEvenBluffOf('stranger'))).toBe(
      null
    );
    expect(decide({}, () => HorseMind.exploit('stranger').bluffMod)).toBe(1);
  });

  it('answers only once the postflop bluff read engages: a short sample is not a read', () => {
    // Four flop bets folded to: a sample, but not yet credibly outside the
    // envelope, so opponentRead is null and nothing changes.
    play(NLH_HU, 'postflopFold', 4);
    expect(decide({ breakEvenBluff: true }, () => HorseMind.opponentRead('villain'))).toBe(null);
    expect(decide({ breakEvenBluff: true }, () => HorseMind.breakEvenBluffOf('villain'))).toBe(
      null
    );
    const players = [
      { seat: 1, user_id: 'hero', is_folded: false, is_sitting_out: false, is_all_in: false },
      { seat: 2, user_id: 'villain', is_folded: false, is_sitting_out: false, is_all_in: false },
    ] as never;
    expect(decide({ breakEvenBluff: true }, () => HorseMind.tableExploit(1, players))).toEqual(
      decide({}, () => HorseMind.tableExploit(1, players))
    );
    // A long sample engages it.
    play(NLH_HU, 'postflopFold', 20);
    expect(
      decide({ breakEvenBluff: true }, () => HorseMind.opponentRead('villain'))!.stats.foldToBet
        .engaged
    ).toBe('high');
    expect(
      decide({ breakEvenBluff: true }, () => HorseMind.breakEvenBluffOf('villain'))
    ).not.toBeNull();
  });

  it('switches off with the reads: no opponentRead, no break-even read', () => {
    play(NLH_HU, 'postflopCall', 20);
    expect(
      decide({ breakEvenBluff: true }, () => HorseMind.breakEvenBluffOf('villain'))
    ).not.toBeNull();
    const realRead = HorseMind.opponentRead;
    (HorseMind as unknown as { opponentRead: () => null }).opponentRead = () => null;
    try {
      expect(decide({ breakEvenBluff: true }, () => HorseMind.breakEvenBluffOf('villain'))).toBe(
        null
      );
      const players = [
        { seat: 1, user_id: 'hero', is_folded: false, is_sitting_out: false, is_all_in: false },
        { seat: 2, user_id: 'villain', is_folded: false, is_sitting_out: false, is_all_in: false },
      ] as never;
      expect(decide({ breakEvenBluff: true }, () => HorseMind.tableExploit(1, players))).toEqual(
        decide({}, () => HorseMind.tableExploit(1, players))
      );
    } finally {
      (HorseMind as unknown as { opponentRead: typeof realRead }).opponentRead = realRead;
    }
  });

  it('a multiway bluff is still gated by an unread responder that prices lower', () => {
    // villain: a read over-folder (break-even at the ceiling). caller: no
    // postflop read engaged, but a long preflop-calling history the legacy
    // all-street rate prices as a station.
    play(NLH_HU, 'postflopFold', 30);
    const players = [
      { seat: 1, user_id: 'hero', is_folded: false, is_sitting_out: false, is_all_in: false },
      { seat: 2, user_id: 'villain', is_folded: false, is_sitting_out: false, is_all_in: false },
      { seat: 3, user_id: 'caller', is_folded: false, is_sitting_out: false, is_all_in: false },
    ] as never;
    const legacy = vi
      .spyOn(HorseMind, 'exploit')
      .mockImplementation((id: string) =>
        id === 'caller'
          ? { bluffMod: 0.55, callDownMod: 1, valueThinMod: 1.25 }
          : { bluffMod: 1.5, callDownMod: 1, valueThinMod: 0.85 }
      );
    try {
      const on = decide({ breakEvenBluff: true }, () => HorseMind.tableExploit(1, players));
      expect(on.breakEvenBluff).toBeUndefined();
      expect(on.foldShift).toBeUndefined();
      expect(on).toEqual(decide({}, () => HorseMind.tableExploit(1, players)));
      expect(on.bluffMod).toBe(0.55);
    } finally {
      legacy.mockRestore();
    }
  });

  it('shrinks the postflop fold read toward the population with the stated strength', () => {
    play(NLH_HU, 'postflopFold', 3);
    play(NLH_HU, 'postflopCall', 2);
    const c = HorseMind.getExploitCounters('villain', NLH_HU)!;
    const pop = exploitEnvelopeFor(NLH_HU, 'nlh')!.foldToBet.mean;
    const m = BREAK_EVEN_PRIOR_STRENGTH;
    const want = (c.foldToBet + m * pop) / (c.foldToBetOpp + m) - pop;
    expect(c.foldToBetOpp).toBeGreaterThan(0);
    expect(
      decide({ breakEvenBluff: true }, () => HorseMind.postflopFoldShift('villain'))
    ).toBeCloseTo(want, 12);
  });

  it('answers only for games the fold curve was measured on', () => {
    play(readScopeOf('short_deck', 2), 'postflopFold', 30);
    const sd = readScopeOf('short_deck', 2);
    expect(
      decide(
        { breakEvenBluff: true },
        () => HorseMind.postflopFoldShift('villain'),
        sd,
        'short_deck'
      )
    ).toBeNull();
    expect(
      decide({ breakEvenBluff: true }, () => HorseMind.postflopFoldShift('villain'), NLH_HU, 'flh')
    ).toBeNull();
    expect(
      decide(
        { breakEvenBluff: true },
        () => HorseMind.breakEvenBluffOf('villain'),
        sd,
        'short_deck'
      )
    ).toBeNull();
    expect(
      decide({ breakEvenBluff: true }, () => HorseMind.postflopFoldShift('villain'), PLO_HU, 'plo4')
    ).toBe(0);
  });

  it('tableExploit carries the weakest responder fold read only when the flag is on', () => {
    play(NLH_HU, 'postflopCall', 20);
    const players = [
      { seat: 1, user_id: 'hero', is_folded: false, is_sitting_out: false, is_all_in: false },
      { seat: 2, user_id: 'villain', is_folded: false, is_sitting_out: false, is_all_in: false },
      { seat: 3, user_id: 'stranger', is_folded: false, is_sitting_out: false, is_all_in: false },
    ] as never;
    const off = decide({}, () => HorseMind.tableExploit(1, players));
    expect(off.foldShift).toBeUndefined();
    expect(off.breakEvenBluff).toBeUndefined();
    const on = decide({ breakEvenBluff: true }, () => HorseMind.tableExploit(1, players));
    expect(on.breakEvenBluff).toBe(BREAK_EVEN_MOD_MIN);
    expect(on.bluffMod).toBe(off.bluffMod);
    // Outside the measured games nothing is attached.
    const sd = readScopeOf('short_deck', 3);
    expect(
      decide({ breakEvenBluff: true }, () => HorseMind.tableExploit(1, players), sd, 'short_deck')
    ).toEqual(decide({}, () => HorseMind.tableExploit(1, players), sd, 'short_deck'));
    expect(on.foldShift).toBeCloseTo(
      decide({ breakEvenBluff: true }, () => HorseMind.postflopFoldShift('villain'))!,
      12
    );
    expect(on.foldShift!).toBeLessThan(0);
  });

  it('leaves the fold-vs-aggression read every other consumer uses unchanged', () => {
    play(NLH_HU, 'preflopFold', 12);
    play(NLH_HU, 'postflopCall', 8);
    expect(decide({ breakEvenBluff: true }, () => HorseMind.foldVsAggressionRate('villain'))).toBe(
      decide({}, () => HorseMind.foldVsAggressionRate('villain'))
    );
  });
});

describe('readScopedShrink', () => {
  const PLO_FULL = readScopeOf('plo4', 9);
  const NLH_FULL = readScopeOf('nlh', 9);

  it('shrinkScopedStats shrinks each rate toward the population and keeps opportunity counts', () => {
    const own = {
      hands: 10,
      vpip: 9,
      riverBetOpps: 4,
      riverBetFolds: 4,
      aggr: 6,
      passive: 2,
      cbetOpps: 0,
      cbetFolds: 0,
      bigBetSD: 3,
      bigBetSDStrong: 1,
    } as unknown as OpponentStats;
    const prior = { vpip: 0.25, riverBetFolds: 0.5, aggr: 0.5, cbetFolds: 0.46 };
    const out = shrinkScopedStats(own, prior);
    const m = SCOPED_SHRINK_STRENGTH;
    expect(out.hands).toBe(10);
    expect(out.riverBetOpps).toBe(4);
    expect(out.vpip / out.hands).toBeCloseTo((9 + m * 0.25) / (10 + m), 12);
    expect(out.riverBetFolds / out.riverBetOpps).toBeCloseTo((4 + m * 0.5) / (4 + m), 12);
    expect(out.aggr + out.passive).toBeCloseTo(8, 12);
    expect(out.aggr / (out.aggr + out.passive)).toBeCloseTo((6 + m * 0.5) / (8 + m), 12);
    // No opportunities: nothing to shrink, the row stays empty.
    expect(out.cbetFolds).toBe(0);
    // A read with no population rate is the player's own.
    expect(out.bigBetSDStrong).toBe(1);
    expect(shrinkScopedStats(own, undefined).vpip).toBe(9);
  });

  it('every scope has a population prior inside (0, 1)', () => {
    for (const fam of ['holdem', 'omaha', 'sixplus'])
      for (const size of ['hu', 'short', 'full']) {
        const row = SCOPED_SHRINK_PRIOR[`${fam}:${size}` as ReadScope];
        expect(row.vpip).toBeGreaterThan(0);
        for (const v of Object.values(row)) {
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThan(1);
        }
      }
  });

  it('a thin Omaha bucket answers for Omaha instead of the pooled hold em read', () => {
    // 60 hold em hands of folding every flop bet, 5 Omaha hands of calling.
    play(NLH_FULL, 'postflopFold', 60);
    play(PLO_FULL, 'postflopCall', 5);
    // Default: under 40 Omaha hands the pooled bucket (mostly hold em) answers.
    const pooled = HorseMind.getStats('villain')!;
    expect(pooled.hands).toBe(65);
    expect(
      decide({}, () => HorseMind.foldVsAggressionRate('villain', false), PLO_FULL, 'plo4')
    ).toBe(pooled.folds / pooled.facedAggr);
    expect(
      decide(
        { scopedShrink: true },
        () => HorseMind.foldVsAggressionRate('villain', false),
        PLO_FULL,
        'plo4'
      )
    ).toBeNull();
    // On: the Omaha bucket has 5 hands, below every exploit gate - no read
    // from the other game at all.
    expect(
      decide({ scopedShrink: true }, () => HorseMind.exploit('villain'), PLO_FULL, 'plo4')
    ).toEqual({ bluffMod: 1, callDownMod: 1, valueThinMod: 1 });
    // A player never seen in this game has no read in it.
    expect(
      decide(
        { scopedShrink: true },
        () => HorseMind.foldToCbetOf('villain'),
        readScopeOf('plo4', 2),
        'plo4'
      )
    ).toBeNull();
  });

  it('a 40-hand scoped bucket answers exactly as before, and persistence never sees a shrunk row', () => {
    play(NLH_FULL, 'postflopFold', 45);
    expect(
      decide(
        { scopedShrink: true },
        () => HorseMind.foldVsAggressionRate('villain'),
        NLH_FULL,
        'nlh'
      )
    ).toBe(decide({}, () => HorseMind.foldVsAggressionRate('villain'), NLH_FULL, 'nlh'));
    HorseMind.exportDirty();
    play(PLO_FULL, 'postflopCall', 3);
    HorseMind.setDecisionScope(PLO_FULL, 'plo4', 'cash');
    HorseMind.setDecisionReadOptions({ scopedShrink: true });
    try {
      const rows = HorseMind.exportDirty();
      expect(rows.find((r) => r.user_id === 'villain')?.hands).toBe(48);
    } finally {
      HorseMind.setDecisionScope(null);
    }
  });
});
