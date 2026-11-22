/**
 * omahaCbetRaiseIsPriced laws (CBET-DEFENCE 2026-11-21): the arithmetic of rho and the range, the c-bet line,
 * PLO6 / tournaments untouched, and option off = the decision without the option key.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import type { SeatPlayer } from '../types.js';
import {
  OMAHA_CBET_RAISE_PRIOR_WEIGHT,
  OMAHA_CBET_RAISE_RANGE_WIDTH,
  OMAHA_CBET_RAISE_SHARE_POP,
  omahaCbetLineOf,
  omahaCbetRaiseRangeShare,
  omahaCbetRaiseShare,
  setOmahaCbetRaiseRecordProvider,
} from './HorseOmahaCbetRaisePriced.js';
import { omahaFlopFacingBetEvAnswer } from './HorseOmahaFlopFacingBetEvRule.js';
import { clearDecisionHud, installDecisionHud } from './opponentHud/OpponentHud.js';
import { decideAt, LIVE_OPTIONS, pricedSpot } from './HorseOmahaPricedRules.test-support.js';

afterEach(() => {
  setOmahaCbetRaiseRecordProvider(null);
  clearDecisionHud();
});

describe('rho: population, shrunk by his public record', () => {
  it('no provider: the population exactly', () => {
    const r = omahaCbetRaiseShare('x', 'plo4', 'hu', 'half');
    expect(r.rho).toBe(OMAHA_CBET_RAISE_SHARE_POP.hu.half);
  });
  it('with a record: (raises + K pop) / (opps + K), rising with his raises', () => {
    setOmahaCbetRaiseRecordProvider({ cbetRaiseRecord: () => ({ opps: 100, raises: 100 }) });
    const K = OMAHA_CBET_RAISE_PRIOR_WEIGHT;
    const pop = OMAHA_CBET_RAISE_SHARE_POP.hu.small;
    expect(omahaCbetRaiseShare('x', 'plo5', 'hu', 'small').rho).toBeCloseTo(
      (100 + K * pop) / (100 + K),
      12
    );
    setOmahaCbetRaiseRecordProvider({ cbetRaiseRecord: () => ({ opps: 100, raises: 0 }) });
    expect(omahaCbetRaiseShare('x', 'plo5', 'hu', 'small').rho).toBeLessThan(pop);
  });
  it('a provider that throws is no record', () => {
    setOmahaCbetRaiseRecordProvider({
      cbetRaiseRecord: () => {
        throw new Error('x');
      },
    });
    expect(omahaCbetRaiseShare('x', 'plo4', 'mw', 'pot').rho).toBe(
      OMAHA_CBET_RAISE_SHARE_POP.mw.pot
    );
  });
  it('range share = W x rho inside [0.02, 0.95]; a raiser of everything holds nearly everything', () => {
    expect(omahaCbetRaiseRangeShare(0.1)).toBeCloseTo(OMAHA_CBET_RAISE_RANGE_WIDTH * 0.1, 12);
    expect(omahaCbetRaiseRangeShare(1)).toBe(0.95);
    expect(omahaCbetRaiseRangeShare(0)).toBe(0.02);
  });
});

const P = (seat: number, cards: string[] = []): SeatPlayer =>
  ({
    seat,
    user_id: `u${seat}`,
    stack: 200,
    bet: 0,
    cards,
    is_folded: false,
    is_sitting_out: false,
    is_all_in: false,
  }) as never;
function gsOf(
  variant: string,
  flop: Array<[number, string, number]>,
  extra: Partial<HorseGameStateV2> = {}
) {
  return {
    gameVariant: variant,
    stage: 'flop',
    communityCards: [
      { rank: '8', suit: 'spades' },
      { rank: '6', suit: 'clubs' },
      { rank: '9', suit: 'spades' },
    ],
    players: [P(1), P(2)],
    pot: 40,
    actionHistory: [
      { stage: 'preflop', seat: 1, action: 'raise', amount: 6 },
      { stage: 'preflop', seat: 2, action: 'call', amount: 4 },
      ...flop.map(([seat, action, amount]) => ({ stage: 'flop', seat, action, amount })),
    ],
    ...extra,
  } as never as HorseGameStateV2;
}

describe('the c-bet line', () => {
  it('preflop raiser to act on an unopened flop: the c-bet line; after his own bet and one raise: the raised line', () => {
    expect(omahaCbetLineOf(P(1), gsOf('plo4', []), false)?.players).toBe('hu');
    expect(
      omahaCbetLineOf(
        P(1),
        gsOf('plo4', [
          [1, 'bet', 6],
          [2, 'raise', 24],
        ]),
        true
      )?.raiserSeat
    ).toBe(2);
  });
  it('not the preflop raiser, or someone else bet first: no line', () => {
    expect(omahaCbetLineOf(P(2), gsOf('plo4', []), false)).toBeNull();
    expect(
      omahaCbetLineOf(
        P(1),
        gsOf('plo4', [
          [2, 'bet', 6],
          [1, 'raise', 24],
        ]),
        true
      )
    ).toBeNull();
  });
  it("PLO6, Hold'em and tournaments: no line (the option never acts there)", () => {
    expect(omahaCbetLineOf(P(1), gsOf('plo6', []), false)).toBeNull();
    expect(omahaCbetLineOf(P(1), gsOf('holdem', []), false)).toBeNull();
    expect(
      omahaCbetLineOf(
        P(1),
        gsOf('plo5', [], { gameMode: 'tournament', tournamentId: 't1' } as never),
        false
      )
    ).toBeNull();
  });
});

describe('a whole decision', () => {
  it('option off = the decision without the option key, and no receipt of the option', () => {
    enableBrainTelemetry();
    const strip = (d: unknown) =>
      JSON.parse(
        JSON.stringify(d, (k, v) =>
          k === 'elapsedMs' || k === 'thinkTime' || k === 'latencyMs' ? undefined : v
        )
      );
    for (const bet of [0, 60, 216]) {
      const st = pricedSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', bet, inPosition: true });
      for (const seed of [1, 2, 3]) {
        const base = decideAt(st, { ...LIVE_OPTIONS, telemetry: true } as HorseDecideOpts, seed);
        drainFires();
        const off = decideAt(
          st,
          { ...LIVE_OPTIONS, telemetry: true, omahaCbetRaiseIsPriced: false } as HorseDecideOpts,
          seed
        );
        const fires = drainFires().map((f) => f.feature);
        expect(strip(off)).toEqual(strip(base));
        expect(fires.some((f) => f.startsWith('omaha_cbet_raise'))).toBe(false);
      }
    }
  }, 300000);

  it('joint-ON with R2 (hudRaiserStabResponse) does not double-scale a c-bet raise while preserving both options alone', () => {
    enableBrainTelemetry();
    setOmahaCbetRaiseRecordProvider({ cbetRaiseRecord: () => ({ opps: 100, raises: 100 }) });
    installDecisionHud({
      v: 1,
      family: 'plo4',
      pv: 1,
      pri: { 'f.rBet.hu': [0.14, 20] },
      opp: { u2: { hands: 300, eff: { 'f.rBet.hu': [80, 64] }, rc: {} } },
    });
    const hero: SeatPlayer = {
      seat: 1,
      user_id: 'u1',
      stack: 200,
      bet: 12,
      cards: [
        { rank: 'A', suit: 'diamonds' },
        { rank: 'A', suit: 'hearts' },
        { rank: 'K', suit: 'diamonds' },
        { rank: 'J', suit: 'diamonds' },
      ],
      is_folded: false,
      is_sitting_out: false,
      is_all_in: false,
    } as never;
    const villain: SeatPlayer = {
      seat: 2,
      user_id: 'u2',
      stack: 152,
      bet: 48,
      cards: [],
      is_folded: false,
      is_sitting_out: false,
      is_all_in: false,
    } as never;
    const gs = gsOf(
      'plo4',
      [
        [1, 'bet', 12],
        [2, 'raise', 48],
      ],
      {
        players: [hero, villain],
        pot: 84,
        currentBet: 48,
        toCall: 36,
        bigBlind: 2,
        smallBlind: 1,
        dealerSeat: 1,
        bettingStructure: 'pot_limit',
        legalActions: ['fold', 'call', 'raise'],
      } as Partial<HorseGameStateV2>
    );
    const baseCtx = {
      mind: true,
      telemetry: true,
      rake: 0.05,
      inPosition: true,
      bareOverpairContinuation: false,
    };

    drainFires();
    const ansBase = omahaFlopFacingBetEvAnswer(hero, gs, baseCtx);
    drainFires();
    const ansR2 = omahaFlopFacingBetEvAnswer(hero, gs, {
      ...baseCtx,
      hudRaiserStabResponse: true,
    });
    const firesR2 = drainFires().map((f) => f.feature);

    const ansCbet = omahaFlopFacingBetEvAnswer(hero, gs, {
      ...baseCtx,
      cbetRaisePriced: true,
    });
    const firesCbet = drainFires().map((f) => f.feature);

    const ansJoint = omahaFlopFacingBetEvAnswer(hero, gs, {
      ...baseCtx,
      hudRaiserStabResponse: true,
      cbetRaisePriced: true,
    });
    const firesJoint = drainFires().map((f) => f.feature);

    expect(ansBase).not.toBeNull();
    expect(ansR2).not.toBeNull();
    expect(ansCbet).not.toBeNull();
    expect(ansJoint).not.toBeNull();
    // (a) R2 alone scales the raiser range via HUD
    expect(firesR2).toContain('omaha_flop_facing_raise_hud_range_scaled');
    expect(ansR2!.verdict.valueShare).toBeGreaterThan(ansBase!.verdict.valueShare);
    expect(ansR2!.verdict.ev).not.toBe(ansBase!.verdict.ev);
    // (b) CBET alone prices via the measured c-bet raise range
    expect(firesCbet).toContain('omaha_cbet_raise_priced_range');
    expect(firesCbet).not.toContain('omaha_flop_facing_raise_hud_range_scaled');
    // (c) Joint-ON matches CBET alone exactly — zero double-scaling from R2's f.rBet factor
    expect(ansJoint).toEqual(ansCbet);
    expect(firesJoint).toContain('omaha_cbet_raise_priced_range');
    expect(firesJoint).not.toContain('omaha_flop_facing_raise_hud_range_scaled');
  });
});
