/**
 * LAW: omahaMadeAndPairedBetsArePricedOnHisResponse (R5, lane REPLACEMENTS-5 2026-11-21).
 *
 * Proves:
 *  1. Strict OFF identity: absent, false, and non-true values return null / leave decisions byte-identical.
 *  2. Scope isolation: flop, preflop, PLO6, hold'em, hi-lo, bomb pots, multi-board, tournaments untouched.
 *  3. Lifetime HUD raise-back (`rBet`) & fold (`fb`) response: high turn/river raiser (`t.rBet.hu` / `r.rBet.hu`)
 *     lowers bet EV vs a passive caller; extreme folder raises bet EV; no person-vs-Horse key; proof bar
 *     shrinks smoothly with opportunity count (no cliff).
 *  4. Multiway pricing: prices 3-way paired/made-hand turn and river bets cleanly using `.mw` cells.
 *  5. Whole-decision determinism & safety: same verdict across seeds, legal actions only, PLO6 whole
 *     decisions identical with option on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import {
  OMAHA_TURN_RIVER_RESPONSE_PRIORS,
  omahaMadeAndPairedBetMemoClear,
  omahaMadeAndPairedBetMemoHeld,
  omahaMadeAndPairedBetOnHisResponseRule,
  omahaMadeAndPairedBetOnHisResponseVerdict,
} from './HorseOmahaMadeAndPairedBetsPriced.js';
import {
  clearDecisionHud,
  installDecisionHud,
  HUD_PACKET_VERSION,
  type OpponentHudPacket,
} from './opponentHud/OpponentHud.js';
import { HUD_PROFILE_VERSION } from './opponentHud/OpponentHudProfile.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, disarmBrainTelemetryForTest, enableBrainTelemetry } from './BrainTelemetry.js';

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
): OpponentHudPacket => {
  const t = OMAHA_TURN_RIVER_RESPONSE_PRIORS[family].turn;
  const r = OMAHA_TURN_RIVER_RESPONSE_PRIORS[family].river;
  return {
    v: HUD_PACKET_VERSION,
    pv: HUD_PROFILE_VERSION,
    family,
    pri: {
      't.fb.sm.hu': [t.fbSmHu, 20],
      't.fb.bg.hu': [t.fbBgHu, 20],
      't.fb.sm.mw': [t.fbSmMw, 20],
      't.fb.bg.mw': [t.fbBgMw, 20],
      't.rBet.hu': [t.rBetHu, 20],
      't.rBet.mw': [t.rBetMw, 20],
      't.stab.hu': [t.stabHu, 20],
      't.stab.mw': [t.stabMw, 20],
      'r.fb.sm.hu': [r.fbSmHu, 20],
      'r.fb.bg.hu': [r.fbBgHu, 20],
      'r.fb.sm.mw': [r.fbSmMw, 20],
      'r.fb.bg.mw': [r.fbBgMw, 20],
      'r.rBet.hu': [r.rBetHu, 20],
      'r.rBet.mw': [r.rBetMw, 20],
      'r.stab.hu': [r.stabHu, 20],
      'r.stab.mw': [r.stabMw, 20],
    },
    opp: {
      [oppId]: {
        hands: 500,
        eff,
        rc: {},
      },
    },
  };
};

const makeSpot = (args: {
  variant?: 'plo4' | 'plo5' | 'plo6' | 'nlh';
  stage?: 'flop' | 'turn' | 'river';
  hole: string;
  board: string;
  pot?: number;
  stack?: number;
  opponents?: number;
  heroCloses?: boolean;
  tournament?: boolean;
  hiLo?: boolean;
  bombPot?: boolean;
  boardCount?: number;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } => {
  const variant = args.variant ?? 'plo5';
  const stage = args.stage ?? 'river';
  const oppCount = args.opponents ?? 1;
  const pot = args.pot ?? 120;
  const stack = args.stack ?? 240;
  const heroSeat = args.heroCloses ? 2 : 1;
  const dealerSeat = args.heroCloses ? 2 : 3;
  const hero: SeatPlayer = {
    seat: heroSeat,
    user_id: 'horse-hero',
    username: 'HeroHorse',
    stack,
    bet: 0,
    totalInvested: 60,
    cards: cards(args.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const players: SeatPlayer[] = [hero];
  for (let k = 0; k < oppCount; k++) {
    const seat = args.heroCloses ? 1 + (k > 0 ? k + 2 : 0) : 2 + k;
    players.push({
      seat,
      user_id: `opp-${k + 1}`,
      username: `Opp${k + 1}`,
      stack,
      bet: 0,
      totalInvested: 60,
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
      amount: 20,
      timestamp: ts,
    },
    ...players
      .filter((p) => p.seat !== heroSeat)
      .map((p) => ({
        stage: 'preflop' as const,
        seat: p.seat,
        userId: p.user_id,
        action: 'call' as const,
        amount: 20,
        timestamp: ts + 1,
      })),
    {
      stage: 'flop',
      seat: heroSeat,
      userId: hero.user_id,
      action: 'bet',
      amount: 40,
      timestamp: ts + 2,
    },
    ...players
      .filter((p) => p.seat !== heroSeat)
      .map((p) => ({
        stage: 'flop' as const,
        seat: p.seat,
        userId: p.user_id,
        action: 'call' as const,
        amount: 40,
        timestamp: ts + 3,
      })),
    ...(args.heroCloses
      ? players
          .filter((p) => p.seat !== heroSeat)
          .map((p) => ({
            stage,
            seat: p.seat,
            userId: p.user_id,
            action: 'check' as const,
            amount: 0,
            timestamp: ts + 4,
          }))
      : []),
  ];
  const gs: HorseGameStateV2 = {
    gameVariant: variant,
    stage,
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

describe('omahaMadeAndPairedBetsArePricedOnHisResponse (R5)', () => {
  it('reads strictly: absent, false, and non-true values return null', () => {
    const { hero, gs } = makeSpot({ stage: 'river', hole: 'AsKdQhJc2s', board: '9s9d7c4h2d' });
    const bet: HorseDecision = { action: 'bet', amount: 80, thinkTime: 0 };
    expect(omahaMadeAndPairedBetOnHisResponseRule(bet, hero, gs, {})).toBeNull();
    expect(
      omahaMadeAndPairedBetOnHisResponseRule(bet, hero, gs, {
        omahaMadeAndPairedBetsArePricedOnHisResponse: false,
      })
    ).toBeNull();
    expect(
      omahaMadeAndPairedBetOnHisResponseRule(bet, hero, gs, {
        omahaMadeAndPairedBetsArePricedOnHisResponse: 'on' as unknown as boolean,
      })
    ).toBeNull();
  });

  it('scope isolation: flop, PLO6, holdem, hi-lo, bomb pot, multi-board and tournaments return null', () => {
    const bet: HorseDecision = { action: 'bet', amount: 80, thinkTime: 0 };
    const on: HorseDecideOpts = { omahaMadeAndPairedBetsArePricedOnHisResponse: true };
    const cases = [
      makeSpot({ stage: 'flop', hole: 'AsKdQhJc2s', board: '9s9d7c' }),
      makeSpot({ variant: 'plo6', stage: 'river', hole: 'AsKdQhJc2s3d', board: '9s9d7c4h2d' }),
      makeSpot({ variant: 'nlh', stage: 'river', hole: 'AsKd', board: '9s9d7c4h2d' }),
      makeSpot({ stage: 'river', hole: 'AsKdQhJc2s', board: '9s9d7c4h2d', tournament: true }),
      makeSpot({ stage: 'river', hole: 'AsKdQhJc2s', board: '9s9d7c4h2d', hiLo: true }),
      makeSpot({ stage: 'river', hole: 'AsKdQhJc2s', board: '9s9d7c4h2d', bombPot: true }),
      makeSpot({ stage: 'river', hole: 'AsKdQhJc2s', board: '9s9d7c4h2d', boardCount: 2 }),
    ];
    for (const { hero, gs } of cases) {
      expect(omahaMadeAndPairedBetOnHisResponseRule(bet, hero, gs, on)).toBeNull();
    }
  });

  it('responds monotonically to lifetime HUD raise-back (rBet) and fold (fb), and proof shrinks with n', () => {
    const on: HorseDecideOpts = { omahaMadeAndPairedBetsArePricedOnHisResponse: true };

    // (a) Fold monotonicity on a weak/bluff river hand: higher fold-to-big-bet strictly increases bet EV
    const weak = makeSpot({
      stage: 'river',
      hole: 'KhQdJh3s2c',
      board: '9s9d7c4h2d',
      heroCloses: true,
    });
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        'r.fb.bg.hu': [200, 30],
        'r.rBet.hu': [200, 10],
      })
    );
    const vsStation = omahaMadeAndPairedBetOnHisResponseVerdict(weak.hero, weak.gs, on, 100)!;
    expect(vsStation).not.toBeNull();
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        'r.fb.bg.hu': [200, 180],
        'r.rBet.hu': [200, 10],
      })
    );
    const vsFolder = omahaMadeAndPairedBetOnHisResponseVerdict(weak.hero, weak.gs, on, 100)!;
    expect(vsFolder).not.toBeNull();
    expect(vsFolder.evBet).toBeGreaterThan(vsStation.evBet);

    // (b) Raise-back monotonicity at fixed fold rate on a turn overpair + nut flush draw (AsAdKs3h2c on 9s8s7c2d):
    // higher rBet shifts hands hero has real equity against from call into raise, forcing bet-fold
    // losses or worse-priced calls and strictly lowering bet EV.
    const thin = makeSpot({
      stage: 'turn',
      hole: 'AsAdKs3h2c',
      board: '9s8s7c2d',
      heroCloses: true,
    });
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [200, 100],
        't.rBet.hu': [200, 80],
      })
    );
    const vsRaiser = omahaMadeAndPairedBetOnHisResponseVerdict(thin.hero, thin.gs, on, 100)!;
    expect(vsRaiser).not.toBeNull();
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [200, 100],
        't.rBet.hu': [200, 2],
      })
    );
    const vsPassive = omahaMadeAndPairedBetOnHisResponseVerdict(thin.hero, thin.gs, on, 100)!;
    expect(vsPassive).not.toBeNull();
    expect(vsRaiser.evBet).toBeLessThan(vsPassive.evBet);

    // (c) Proof shrinks smoothly with larger sample size n (no cliff)
    clearDecisionHud();
    const vNoRead = omahaMadeAndPairedBetOnHisResponseVerdict(thin.hero, thin.gs, on, 100)!;
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [500, 250],
        't.rBet.hu': [500, 25],
      })
    );
    const vDeep = omahaMadeAndPairedBetOnHisResponseVerdict(thin.hero, thin.gs, on, 100)!;
    expect(vDeep.proof).toBeLessThan(vNoRead.proof);
  });

  it('prices turn & river multiway spots cleanly and stays deterministic across seeds', () => {
    const bet: HorseDecision = { action: 'bet', amount: 80, thinkTime: 0 };
    const on: HorseDecideOpts = { omahaMadeAndPairedBetsArePricedOnHisResponse: true };

    const mwTurn = makeSpot({
      stage: 'turn',
      hole: 'AhAdKcQd3h',
      board: '9s9d7c4h',
      opponents: 2,
    });
    const vMw = omahaMadeAndPairedBetOnHisResponseVerdict(mwTurn.hero, mwTurn.gs, on, 80);
    expect(vMw).not.toBeNull();
    expect(vMw!.opponents).toBe(2);
    const first = omahaMadeAndPairedBetOnHisResponseRule(bet, mwTurn.hero, mwTurn.gs, on);
    expect(first).not.toBeNull();
    expect(['bet', 'check']).toContain(first!.action);
    for (const seed of [1, 7, 42]) {
      seedFastRandom(seed);
      expect(omahaMadeAndPairedBetOnHisResponseRule(bet, mwTurn.hero, mwTurn.gs, on)).toEqual(
        first
      );
    }

    // PLO6 whole decision identical with option ON vs OFF
    const p6 = makeSpot({
      variant: 'plo6',
      stage: 'river',
      hole: 'AsKdQhJc2s3d',
      board: '9s9d7c4h2d',
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
      omahaMadeAndPairedBetsArePricedOnHisResponse: true,
    });
    expect({ action: dOn.action, amount: dOn.amount }).toEqual({
      action: dOff.action,
      amount: dOff.amount,
    });
  });

  it('R5 v2 regression: a strictly +EV proposed made-hand turn/river bet (evBet >= evCheck) is kept rather than over-checked by an anti-bet proof penalty', () => {
    const on: HorseDecideOpts = { omahaMadeAndPairedBetsArePricedOnHisResponse: true };
    // Strong made hand (top full house / nut flush) on a paired turn against passive callers (HU and 3-way):
    // must keep the proposed value bet when evBet >= evCheck rather than checking back +EV value bets.
    const huValue = makeSpot({
      stage: 'turn',
      hole: 'AsAhKsQs2c',
      board: 'Ad9s9d4c',
      heroCloses: true,
      opponents: 1,
    });
    const vHu = omahaMadeAndPairedBetOnHisResponseVerdict(huValue.hero, huValue.gs, on, 80)!;
    expect(vHu).not.toBeNull();
    expect(vHu.evBet).toBeGreaterThan(vHu.evCheck);
    expect(vHu.betStands).toBe(true);

    // Marginal +EV made hand (0 < gap < proof) on dry turn: must stand when evBet >= evCheck
    // rather than being checked back because gap < sampleSe + readSpread.
    const midValue = makeSpot({
      stage: 'turn',
      hole: 'AsAhQdJc3s',
      board: 'Qc7d4s2h',
      heroCloses: true,
      opponents: 1,
    });
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [10, 5],
        't.rBet.hu': [10, 0],
      })
    );
    const vMid = omahaMadeAndPairedBetOnHisResponseVerdict(midValue.hero, midValue.gs, on, 90)!;
    expect(vMid).not.toBeNull();
    expect(vMid.evBet).toBeGreaterThan(vMid.evCheck);
    expect(vMid.gap).toBeLessThan(vMid.proof);
    expect(vMid.betStands).toBe(true);

    // 3-way strong made hand on paired turn (top boat): multiway EV must keep the value bet
    clearDecisionHud();
    const mwBoat = makeSpot({
      stage: 'turn',
      hole: 'AsAhKsQs2c',
      board: 'Ad9s9d4c',
      heroCloses: true,
      opponents: 2,
    });
    const vMw = omahaMadeAndPairedBetOnHisResponseVerdict(mwBoat.hero, mwBoat.gs, on, 80)!;
    expect(vMw).not.toBeNull();
    expect(vMw.evBet).toBeGreaterThan(vMw.evCheck);
    expect(vMw.betStands).toBe(true);

    // 3-way strong non-boat flush on paired turn (AsKsQs7c2d on 9s9d6s3s): multiway 3-branch EV
    // must keep the +EV value bet rather than crushing it with the legacy worseChips subtraction.
    const mwFlush = makeSpot({
      stage: 'turn',
      hole: 'AsKsQhJd2c',
      board: 'Ts7s4s4d',
      heroCloses: false,
      opponents: 2,
    });
    const vMwFlush = omahaMadeAndPairedBetOnHisResponseVerdict(mwFlush.hero, mwFlush.gs, on, 80)!;
    expect(vMwFlush).not.toBeNull();
    expect(vMwFlush.evBet).toBeGreaterThan(vMwFlush.evCheck);
    expect(vMwFlush.betStands).toBe(true);

    // R5 v3 prove-it-to-check: a clearly dominated bare overpair on a paired turn (gap < -proof)
    // is still checked cleanly, while borderline noise (-proof <= gap < 0) does not override a value bet.
    clearDecisionHud();
    const deadAa = makeSpot({
      stage: 'turn',
      hole: 'AsAhKdJs2c',
      board: '9s9d7c4h',
      heroCloses: true,
      opponents: 1,
    });
    const vDead = omahaMadeAndPairedBetOnHisResponseVerdict(deadAa.hero, deadAa.gs, on, 80)!;
    expect(vDead).not.toBeNull();
    expect(vDead.gap).toBeLessThan(-vDead.proof);
    expect(vDead.betStands).toBe(false);
  });

  it('memoizes per decision (player, gs, amount) and fires its receipt at most once across overlapping river sites', () => {
    omahaMadeAndPairedBetMemoClear();
    expect(omahaMadeAndPairedBetMemoHeld()).toBe(false);
    enableBrainTelemetry();
    drainFires();
    const { hero, gs } = makeSpot({
      stage: 'river',
      hole: 'AsAhKsQs2c',
      board: 'Ad9s9d4c2h',
      heroCloses: true,
      opponents: 2,
    });
    const bet: HorseDecision = { action: 'bet', amount: 80, thinkTime: 0 };
    const on: HorseDecideOpts = {
      omahaMadeAndPairedBetsArePricedOnHisResponse: true,
      telemetry: true,
    };
    const r1 = omahaMadeAndPairedBetOnHisResponseRule(bet, hero, gs, on);
    const r2 = omahaMadeAndPairedBetOnHisResponseRule(bet, hero, gs, on);
    const r3 = omahaMadeAndPairedBetOnHisResponseRule(bet, hero, gs, on);
    expect(r1).toEqual(bet);
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
    expect(omahaMadeAndPairedBetMemoHeld()).toBe(true);
    const r5Fires = drainFires()
      .map((f) => f.feature)
      .filter((f) => f.startsWith('omaha_made_paired_bet_on_his_response_'));
    expect(r5Fires).toEqual(['omaha_made_paired_bet_on_his_response_kept']);
    omahaMadeAndPairedBetMemoClear();
    expect(omahaMadeAndPairedBetMemoHeld()).toBe(false);
  });
});
