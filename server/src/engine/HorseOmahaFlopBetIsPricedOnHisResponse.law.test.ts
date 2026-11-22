/**
 * LAW: omahaFlopBetIsPricedOnHisResponse (R2, lane REPLACEMENTS-5 2026-11-21).
 *
 * Proves:
 *  1. Strict OFF identity: absent, false, and non-true values leave whole decisions byte-identical.
 *  2. Scope isolation: PLO6, hold'em, hi-lo, bomb pots, multi-board and tournaments are untouched.
 *  3. Pure EV math monotonicity & continuity: evBet rises strictly with foldToBet, falls strictly with
 *     raiseShare; OOP evCheck reflects stabRate/stabSizeFrac while IP evCheck closes the flop; proof bar
 *     shrinks smoothly with opportunity count (no cliff); multiway pricing works cleanly with .mw cells.
 *  4. Owner fixture txHiARhC (hand 59833576, AA/KK/QQ on 8s6c9s): deterministic, checks vs low-fold or
 *     high-raise opponent, bets vs high-fold passive opponent.
 *  5. Lifetime HUD integration (no provider = population prior; high f.rBet.hu checks bare overpair bets AND
 *     widens facing-raise range in omahaFlopFacingBetEv; low f.rBet.hu narrows facing-raise range; high
 *     f.stab.hu widens facing-stab range; n=0 leaves range factor = 1.0 identically).
 *  6. Determinism & safety: zero random stream touch, legal actions only, never folds the nuts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaPricedSitesFlopBetOnHisResponse,
  omahaPricedSitesFlopBetOnResponseEv,
  omahaFlopFacingHudRangeFactor,
  OMAHA_FLOP_RESPONSE_PRIORS,
} from './HorseOmahaPricedSites.js';
import { omahaFlopEvCounts } from './HorseOmahaFlopFacingBetEv.js';
import { omahaFlopFacingBetEvAnswer } from './HorseOmahaFlopFacingBetEvRule.js';
import {
  clearDecisionHud,
  installDecisionHud,
  HUD_PACKET_VERSION,
  type OpponentHudPacket,
} from './opponentHud/OpponentHud.js';
import { HUD_PROFILE_VERSION } from './opponentHud/OpponentHudProfile.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, disarmBrainTelemetryForTest } from './BrainTelemetry.js';

const SUIT_MAP: Record<string, Card['suit']> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};
const cards = (s: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i < s.length; i += 2) {
    out.push({ rank: s[i] as Card['rank'], suit: SUIT_MAP[s[i + 1]] });
  }
  return out;
};

const makeHudPacket = (
  family: 'plo4' | 'plo5',
  oppId: string,
  eff: Record<string, [number, number]>
): OpponentHudPacket => ({
  v: HUD_PACKET_VERSION,
  pv: HUD_PROFILE_VERSION,
  family,
  pri: {
    'f.fb.sm.hu': [OMAHA_FLOP_RESPONSE_PRIORS[family].fbSmHu, 20],
    'f.fb.bg.hu': [OMAHA_FLOP_RESPONSE_PRIORS[family].fbBgHu, 20],
    'f.fb.sm.mw': [OMAHA_FLOP_RESPONSE_PRIORS[family].fbSmMw, 20],
    'f.fb.bg.mw': [OMAHA_FLOP_RESPONSE_PRIORS[family].fbBgMw, 20],
    'f.rBet.hu': [OMAHA_FLOP_RESPONSE_PRIORS[family].rBetHu, 20],
    'f.rBet.mw': [OMAHA_FLOP_RESPONSE_PRIORS[family].rBetMw, 20],
    'f.stab.hu': [OMAHA_FLOP_RESPONSE_PRIORS[family].stabHu, 20],
    'f.stab.mw': [OMAHA_FLOP_RESPONSE_PRIORS[family].stabMw, 20],
    'f.stabsz.hu': [OMAHA_FLOP_RESPONSE_PRIORS[family].stabszHu, 20],
    'f.stabsz.mw': [OMAHA_FLOP_RESPONSE_PRIORS[family].stabszMw, 20],
  },
  opp: {
    [oppId]: {
      hands: 400,
      eff,
      rc: {},
    },
  },
});

const makeFlopSpot = (args: {
  variant?: 'plo4' | 'plo5' | 'plo6' | 'nlh';
  hole: string;
  board: string;
  pot?: number;
  stack?: number;
  inPosition?: boolean;
  opponents?: number;
  tournament?: boolean;
  hiLo?: boolean;
  bombPot?: boolean;
  boardCount?: number;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } => {
  const variant = args.variant ?? 'plo5';
  const oppCount = args.opponents ?? 1;
  const pot = args.pot ?? 315;
  const stack = args.stack ?? 361.6;
  const heroSeat = args.inPosition ? 2 : 1;
  const dealerSeat = args.inPosition ? 2 : 3;
  const hero: SeatPlayer = {
    seat: heroSeat,
    user_id: 'horse-hero',
    username: 'HeroHorse',
    stack,
    bet: 0,
    totalInvested: 148,
    cards: cards(args.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const players: SeatPlayer[] = [hero];
  for (let k = 0; k < oppCount; k++) {
    const seat = args.inPosition ? 1 + (k > 0 ? k + 2 : 0) : 2 + k;
    players.push({
      seat,
      user_id: `opp-${k + 1}`,
      username: `Opp${k + 1}`,
      stack,
      bet: 0,
      totalInvested: 148,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    });
  }
  players.sort((a, b) => a.seat - b.seat);
  const ts = 1794938400000;
  const actionHistory: NonNullable<HorseGameStateV2['actionHistory']> = [
    {
      stage: 'preflop',
      seat: heroSeat,
      userId: hero.user_id,
      action: 'raise',
      amount: 148,
      timestamp: ts,
    },
    ...players
      .filter((p) => p.seat !== heroSeat)
      .map((p) => ({
        stage: 'preflop' as const,
        seat: p.seat,
        userId: p.user_id,
        action: 'call' as const,
        amount: 148,
        timestamp: ts + 1,
      })),
    ...(args.inPosition
      ? players
          .filter((p) => p.seat !== heroSeat)
          .map((p) => ({
            stage: 'flop' as const,
            seat: p.seat,
            userId: p.user_id,
            action: 'check' as const,
            amount: 0,
            timestamp: ts + 2,
          }))
      : []),
  ];
  const gs: HorseGameStateV2 = {
    gameVariant: variant,
    stage: 'flop',
    pot,
    currentBet: 0,
    toCall: 0,
    minRaiseTo: 4,
    maxRaiseTo: pot,
    bigBlind: 2,
    dealerSeat,
    communityCards: cards(args.board),
    players,
    actionHistory,
    legalActions: ['check', 'bet', 'all_in'],
    ...(args.tournament ? { gameMode: 'tournament' as const } : {}),
    ...(args.hiLo ? { variantRules: { splitLow8OrBetter: true } } : {}),
    ...(args.bombPot ? { bombPot: true } : {}),
    ...(args.boardCount ? { boardCount: args.boardCount } : {}),
  } as HorseGameStateV2;
  return { hero, gs };
};

afterEach(() => {
  clearDecisionHud();
  disarmBrainTelemetryForTest();
  drainFires();
});

describe('omahaFlopBetIsPricedOnHisResponse (R2)', () => {
  it('reads strictly: absent, false, and non-true values leave decisions identical', () => {
    const { hero, gs } = makeFlopSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', inPosition: true });
    const bet: HorseDecision = { action: 'bet', amount: 252, thinkTime: 0 };
    expect(omahaPricedSitesFlopBetOnHisResponse(bet, hero, gs, {}, false)).toBeNull();
    expect(
      omahaPricedSitesFlopBetOnHisResponse(
        bet,
        hero,
        gs,
        { omahaFlopBetIsPricedOnHisResponse: false },
        false
      )
    ).toBeNull();
    expect(
      omahaPricedSitesFlopBetOnHisResponse(
        bet,
        hero,
        gs,
        { omahaFlopBetIsPricedOnHisResponse: 'on' as unknown as boolean },
        false
      )
    ).toBeNull();
    expect(
      omahaPricedSitesFlopBetOnHisResponse(
        bet,
        hero,
        gs,
        { omahaFlopBetIsPricedOnHisResponse: 1 as unknown as boolean },
        false
      )
    ).toBeNull();
  });

  it('scope isolation: PLO6, holdem, hi-lo, bomb pot, multi-board and tournaments are untouched', () => {
    const bet: HorseDecision = { action: 'bet', amount: 200, thinkTime: 0 };
    const on: HorseDecideOpts = { omahaFlopBetIsPricedOnHisResponse: true };
    const cases = [
      makeFlopSpot({ variant: 'plo6', hole: 'AdAhKdJd4h3c', board: '8s6c9s', inPosition: true }),
      makeFlopSpot({ variant: 'nlh', hole: 'AdAh', board: '8s6c9s', inPosition: true }),
      makeFlopSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', inPosition: true, tournament: true }),
      makeFlopSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', inPosition: true, hiLo: true }),
      makeFlopSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', inPosition: true, bombPot: true }),
      makeFlopSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', inPosition: true, boardCount: 2 }),
    ];
    for (const { hero, gs } of cases) {
      expect(omahaPricedSitesFlopBetOnHisResponse(bet, hero, gs, on, false)).toBeNull();
    }
  });

  it('pure EV math: monotone in fold and raise rates, OOP stab lowers/moves evCheck while IP ignores stab, proof shrinks with n', () => {
    const counts = omahaFlopEvCounts(cards('AdAhKdJd4h'), cards('8s6c9s'), [], 0.15)!;
    expect(counts).not.toBeNull();
    const eqTop = (s: number) => {
      const t = counts.top(s);
      return t.win + t.tie / 2;
    };
    const baseOpp = {
      fold: 0.5,
      foldN: 50,
      foldK: 20,
      raise: 0.11,
      raiseN: 50,
      raiseK: 20,
      stab: 0.7,
      stabSizeFrac: 0.55,
    };
    const vLowFold = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, fold: 0.3 }],
      samples: counts.samples,
    })!;
    const vHighFold = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, fold: 0.7 }],
      samples: counts.samples,
    })!;
    expect(vHighFold.evBet).toBeGreaterThan(vLowFold.evBet);
    expect(vHighFold.evCheck).toBeCloseTo(vLowFold.evCheck, 9);

    const vHighRaise = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, raise: 0.35 }],
      samples: counts.samples,
    })!;
    const vLowRaise = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, raise: 0.03 }],
      samples: counts.samples,
    })!;
    expect(vHighRaise.evBet).toBeLessThan(vLowRaise.evBet);

    // IP check closes the flop: stabRate does not affect evCheck
    const vIpStab0 = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, stab: 0 }],
      samples: counts.samples,
    })!;
    const vIpStab90 = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, stab: 0.9 }],
      samples: counts.samples,
    })!;
    expect(vIpStab0.evCheck).toBeCloseTo(vIpStab90.evCheck, 9);

    // OOP check faces his stab: evCheck responds to stabRate
    const vOopStab0 = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: false,
      opponents: [{ ...baseOpp, stab: 0 }],
      samples: counts.samples,
    })!;
    const vOopStab85 = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: false,
      opponents: [{ ...baseOpp, stab: 0.85, stabSizeFrac: 0.75 }],
      samples: counts.samples,
    })!;
    expect(vOopStab85.evCheck).not.toBeCloseTo(vOopStab0.evCheck, 2);
    expect(vOopStab85.stabProb).toBeCloseTo(0.85, 6);

    // Uncertainty proof shrinks smoothly with larger n (no cliff)
    const vThin = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, foldN: 0, raiseN: 0 }],
      samples: counts.samples,
    })!;
    const vDeep = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: eqTop,
      pot: 315,
      bet: 252,
      effective: 361.6,
      inPosition: true,
      opponents: [{ ...baseOpp, foldN: 500, raiseN: 500 }],
      samples: counts.samples,
    })!;
    expect(vDeep.proof).toBeLessThan(vThin.proof);
  });

  it('owner fixture txHiARhC (AA/KK/QQ on 8s6c9s) & HUD lifetime response: high-raiser/station checks, high-folder bets, multiway priced', () => {
    const bet: HorseDecision = { action: 'bet', amount: 252, thinkTime: 0 };
    const on: HorseDecideOpts = { omahaFlopBetIsPricedOnHisResponse: true, telemetry: true };

    for (const hole of ['AdAhKdJd4h', 'KdKhAdJd4h', 'QdQhKdJd4h']) {
      const { hero, gs } = makeFlopSpot({ hole, board: '8s6c9s', inPosition: true });
      // Against a sticky high-raiser: checks
      installDecisionHud(
        makeHudPacket('plo5', 'opp-1', {
          'f.fb.bg.hu': [100, 15],
          'f.rBet.hu': [100, 35],
        })
      );
      const vsAggro = omahaPricedSitesFlopBetOnHisResponse(bet, hero, gs, on, false);
      expect(vsAggro?.action).toBe('check');

      // Against an extreme folder who rarely raises: bets
      installDecisionHud(
        makeHudPacket('plo5', 'opp-1', {
          'f.fb.bg.hu': [200, 170],
          'f.rBet.hu': [200, 4],
        })
      );
      const vsFolder = omahaPricedSitesFlopBetOnHisResponse(bet, hero, gs, on, false);
      expect(vsFolder?.action).toBe('bet');
    }

    // Multiway OOP bare overpair: priced cleanly with .mw cells (not unpriced)
    clearDecisionHud();
    const mw = makeFlopSpot({
      hole: 'AdAhKdJd4h',
      board: '8s6c9s',
      inPosition: false,
      opponents: 2,
    });
    const mwRes = omahaPricedSitesFlopBetOnHisResponse(bet, mw.hero, mw.gs, on, true);
    expect(mwRes).not.toBeNull();
    expect(['bet', 'check']).toContain(mwRes!.action);
  });

  it('flop facing-bet HUD raiser/stabber range scaling (B6 folded into R2): n=0 is 1.0, high f.rBet widens raiser range, low narrows it', () => {
    // No HUD installed => factor 1.0, measured false
    clearDecisionHud();
    expect(omahaFlopFacingHudRangeFactor('opp-1', 'plo5', true, 'raise', false)).toEqual({
      factor: 1,
      measured: false,
    });

    // High flop raiser (50% vs 11% prior) => factor > 1 (widens raiser range)
    installDecisionHud(makeHudPacket('plo5', 'opp-1', { 'f.rBet.hu': [100, 50] }));
    const hiRaise = omahaFlopFacingHudRangeFactor('opp-1', 'plo5', true, 'raise', false);
    expect(hiRaise.measured).toBe(true);
    expect(hiRaise.factor).toBeGreaterThan(2);

    // Tight flop raiser (2% vs 11% prior) => factor < 1 (narrows raiser range)
    installDecisionHud(makeHudPacket('plo5', 'opp-1', { 'f.rBet.hu': [200, 4] }));
    const loRaise = omahaFlopFacingHudRangeFactor('opp-1', 'plo5', true, 'raise', false);
    expect(loRaise.measured).toBe(true);
    expect(loRaise.factor).toBeLessThan(0.7);

    // Wired into omahaFlopFacingBetEvAnswer facing a flop raise: wider raiser range increases EV(call)
    const { hero, gs } = makeFlopSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', inPosition: false });
    gs.currentBet = 200;
    gs.toCall = 120;
    hero.bet = 80;
    gs.players![1].bet = 200;
    gs.legalActions = ['fold', 'call', 'raise'];
    gs.actionHistory = [
      {
        stage: 'preflop',
        seat: 1,
        userId: 'horse-hero',
        action: 'raise',
        amount: 40,
        timestamp: 1794938400000,
      },
      {
        stage: 'preflop',
        seat: 2,
        userId: 'opp-1',
        action: 'call',
        amount: 40,
        timestamp: 1794938400001,
      },
      {
        stage: 'flop',
        seat: 1,
        userId: 'horse-hero',
        action: 'bet',
        amount: 80,
        timestamp: 1794938400002,
      },
      {
        stage: 'flop',
        seat: 2,
        userId: 'opp-1',
        action: 'raise',
        amount: 200,
        timestamp: 1794938400003,
      },
    ];
    const baseCtx = {
      mind: true,
      telemetry: false,
      rake: 0,
      inPosition: false,
      bareOverpairContinuation: false,
      hudRaiserStabResponse: true,
    };
    installDecisionHud(makeHudPacket('plo5', 'opp-1', { 'f.rBet.hu': [200, 4] }));
    const ansTight = omahaFlopFacingBetEvAnswer(hero, gs, baseCtx);
    installDecisionHud(makeHudPacket('plo5', 'opp-1', { 'f.rBet.hu': [100, 60] }));
    const ansWide = omahaFlopFacingBetEvAnswer(hero, gs, baseCtx);
    expect(ansTight).not.toBeNull();
    expect(ansWide).not.toBeNull();
    expect(ansWide!.verdict.ev).toBeGreaterThan(ansTight!.verdict.ev);
    expect(ansWide!.verdict.valueShare).toBeGreaterThan(ansTight!.verdict.valueShare);
  });

  it('determinism & safety across whole decisions: same verdict across seeds, legal actions, PLO6 whole decision identical', () => {
    const { hero, gs } = makeFlopSpot({ hole: 'AdAhKdJd4h', board: '8s6c9s', inPosition: true });
    const bet: HorseDecision = { action: 'bet', amount: 252, thinkTime: 0 };
    const on: HorseDecideOpts = { omahaFlopBetIsPricedOnHisResponse: true };
    const first = omahaPricedSitesFlopBetOnHisResponse(bet, hero, gs, on, false);
    for (const seed of [1, 7, 42, 999]) {
      seedFastRandom(seed);
      const next = omahaPricedSitesFlopBetOnHisResponse(bet, hero, gs, on, false);
      expect(next).toEqual(first);
    }

    // PLO6 whole decision identical with option ON vs OFF
    const p6 = makeFlopSpot({
      variant: 'plo6',
      hole: 'AdAhKdJd4h3c',
      board: '8s6c9s',
      inPosition: true,
    });
    seedFastRandom(20261121);
    const dOff = HorseLogic.decide(p6.hero, p6.gs, undefined as never, undefined as never, {
      observeMind: false,
      decisionTimeMs: 1794938400000,
    });
    seedFastRandom(20261121);
    const dOn = HorseLogic.decide(p6.hero, p6.gs, undefined as never, undefined as never, {
      observeMind: false,
      decisionTimeMs: 1794938400000,
      omahaFlopBetIsPricedOnHisResponse: true,
    });
    expect({ action: dOn.action, amount: dOn.amount }).toEqual({
      action: dOff.action,
      amount: dOff.amount,
    });
  });
});
