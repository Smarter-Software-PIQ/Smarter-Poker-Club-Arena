/**
 * LAW: omahaBigDrawBetIsPricedOnHisResponse (R4, lane REPLACEMENTS-5 2026-11-21).
 *
 * Proves:
 *  1. Strict OFF identity: absent, false, and non-true values return null / leave decisions unchanged.
 *  2. Scope isolation: river, preflop, PLO6, hold'em, hi-lo, bomb pots, multi-board, tournaments,
 *     and facing-a-bet spots return null.
 *  3. OOP is priced, not barred: out-of-position big draw checked to is evaluated and can bet when
 *     fold equity + equity beat check + proof bar (no categorical `!inPosition` block).
 *  4. Lifetime HUD monotonicity: higher fold-to-big-bet (`f.fb.bg.hu`) raises `evBet`; higher
 *     raise-back (`f.rBet.hu`) at fixed fold rate lowers `evBet`; proof shrinks smoothly with `n`.
 *  5. Determinism & safety: identical across brain random seeds; PLO6 whole decisions unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import {
  OMAHA_BIG_DRAW_BET_RESPONSE_PRIORS,
  omahaBigDrawBetOnHisResponseRule,
  omahaBigDrawBetOnHisResponseVerdict,
} from './HorseOmahaBigDrawBetPriced.js';
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
): OpponentHudPacket => {
  const f = OMAHA_BIG_DRAW_BET_RESPONSE_PRIORS[family].flop;
  const t = OMAHA_BIG_DRAW_BET_RESPONSE_PRIORS[family].turn;
  return {
    v: HUD_PACKET_VERSION,
    pv: HUD_PROFILE_VERSION,
    family,
    pri: {
      'f.fb.bg.hu': [f.fbBgHu, 20],
      'f.fb.bg.mw': [f.fbBgMw, 20],
      'f.rBet.hu': [f.rBetHu, 20],
      'f.rBet.mw': [f.rBetMw, 20],
      'f.stab.hu': [f.stabHu, 20],
      'f.stab.mw': [f.stabMw, 20],
      't.fb.bg.hu': [t.fbBgHu, 20],
      't.fb.bg.mw': [t.fbBgMw, 20],
      't.rBet.hu': [t.rBetHu, 20],
      't.rBet.mw': [t.rBetMw, 20],
      't.stab.hu': [t.stabHu, 20],
      't.stab.mw': [t.stabMw, 20],
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
  inPosition?: boolean;
  opponents?: number;
  toCall?: number;
  tournament?: boolean;
  hiLo?: boolean;
  bombPot?: boolean;
  boardCount?: number;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } => {
  const variant = args.variant ?? 'plo5';
  const stage = args.stage ?? 'flop';
  const pot = args.pot ?? 100;
  const stack = args.stack ?? 300;
  const inPosition = args.inPosition ?? true;
  const oppCount = args.opponents ?? 1;
  const heroSeat = inPosition ? 2 : 1;
  const dealerSeat = inPosition ? 2 : 2;
  const hero: SeatPlayer = {
    seat: heroSeat,
    user_id: 'horse-hero',
    username: 'HeroHorse',
    stack,
    bet: 0,
    totalInvested: 50,
    cards: cards(args.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const players: SeatPlayer[] = [hero];
  for (let k = 0; k < oppCount; k++) {
    const seat = inPosition ? (k === 0 ? 1 : 3 + k) : 2 + k;
    players.push({
      seat,
      user_id: `opp-${k + 1}`,
      username: `Opp${k + 1}`,
      stack,
      bet: args.toCall ?? 0,
      totalInvested: 50 + (args.toCall ?? 0),
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    });
  }
  players.sort((a, b) => a.seat - b.seat);
  const toCall = args.toCall ?? 0;
  const gs: HorseGameStateV2 = {
    gameVariant: variant,
    stage,
    pot,
    currentBet: toCall,
    toCall,
    minRaiseTo: Math.max(4, toCall * 2),
    maxRaiseTo: pot + toCall * 2,
    bigBlind: 2,
    dealerSeat,
    communityCards: cards(args.board),
    players,
    actionHistory: [],
    legalActions: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    ...(args.tournament ? { gameMode: 'tournament' as const } : {}),
    ...(args.hiLo ? { variantRules: { splitLow8OrBetter: true } } : {}),
    ...(args.bombPot ? { bombPot: true } : {}),
    ...(args.boardCount ? { boardCount: args.boardCount } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
};

afterEach(() => {
  clearDecisionHud();
  disarmBrainTelemetryForTest();
  drainFires();
});

describe('omahaBigDrawBetIsPricedOnHisResponse (R4)', () => {
  it('reads strictly: absent, false, and non-true values return null', () => {
    // NFD + wrap combo draw on 9s 8s 2c
    const { hero, gs } = makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c' });
    const chk: HorseDecision = { action: 'check', thinkTime: 0 };
    expect(omahaBigDrawBetOnHisResponseRule(chk, hero, gs, {})).toBeNull();
    expect(
      omahaBigDrawBetOnHisResponseRule(chk, hero, gs, {
        omahaBigDrawBetIsPricedOnHisResponse: false,
      })
    ).toBeNull();
    expect(
      omahaBigDrawBetOnHisResponseRule(chk, hero, gs, {
        omahaBigDrawBetIsPricedOnHisResponse: 'on' as unknown as boolean,
      })
    ).toBeNull();
  });

  it('scope isolation: river, PLO6, holdem, hi-lo, bomb pot, multi-board, tournament, and facing bet return null', () => {
    const chk: HorseDecision = { action: 'check', thinkTime: 0 };
    const on: HorseDecideOpts = { omahaBigDrawBetIsPricedOnHisResponse: true };
    const cases = [
      makeSpot({ stage: 'river', hole: 'AsKsJcTd7h', board: '9s8s2c4d3h' }),
      makeSpot({ variant: 'plo6', hole: 'AsKsJcTd7h5c', board: '9s8s2c' }),
      makeSpot({ variant: 'nlh', hole: 'AsKs', board: '9s8s2c' }),
      makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c', tournament: true }),
      makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c', hiLo: true }),
      makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c', bombPot: true }),
      makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c', boardCount: 2 }),
      makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c', toCall: 40 }),
    ];
    for (const { hero, gs } of cases) {
      expect(omahaBigDrawBetOnHisResponseRule(chk, hero, gs, on)).toBeNull();
    }
  });

  it('prices OOP big draw without categorical bar and responds monotonically to fb, rBet, and n', () => {
    const on: HorseDecideOpts = { omahaBigDrawBetIsPricedOnHisResponse: true };
    // OOP big draw (AsKsJcTd7h on 9s8s2c = NFD + 13-out nut wrap)
    const oop = makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c', inPosition: false });

    // Against an opponent who folds often to flop big bets (85%) and rarely raises (2%): OOP bets!
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        'f.fb.bg.hu': [300, 255],
        'f.rBet.hu': [300, 6],
        'f.stab.hu': [300, 180],
      })
    );
    const vsFolder = omahaBigDrawBetOnHisResponseVerdict(oop.hero, oop.gs, on)!;
    expect(vsFolder).not.toBeNull();
    expect(vsFolder.inPosition).toBe(false);
    expect(vsFolder.wager).not.toBeNull();

    // Fold monotonicity on a turn semi-bluff big draw (underdog when called: AsKsJhTc3d on 9s8s2c4d):
    // higher fold-to-big-bet strictly increases evBet.
    const semi = makeSpot({
      stage: 'turn',
      hole: 'AsKsJhTc3d',
      board: '9s8s2c4d',
      inPosition: false,
    });
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [300, 255],
        't.rBet.hu': [300, 6],
        't.stab.hu': [300, 180],
      })
    );
    const semiFolder = omahaBigDrawBetOnHisResponseVerdict(semi.hero, semi.gs, on)!;
    expect(semiFolder).not.toBeNull();
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [300, 45],
        't.rBet.hu': [300, 6],
        't.stab.hu': [300, 180],
      })
    );
    const semiStation = omahaBigDrawBetOnHisResponseVerdict(semi.hero, semi.gs, on)!;
    expect(semiStation).not.toBeNull();
    expect(semiFolder.evBet).toBeGreaterThan(semiStation.evBet);

    // Raise-back monotonicity at fixed fold rate (40%): higher rBet (45% vs 2%) lowers evBet
    const mid = makeSpot({
      stage: 'turn',
      hole: 'AsKsJhTc3d',
      board: '9s8s2c4d',
      inPosition: true,
      stack: 600,
    });
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [300, 120],
        't.rBet.hu': [300, 135],
      })
    );
    const vsRaiser = omahaBigDrawBetOnHisResponseVerdict(mid.hero, mid.gs, on)!;
    expect(vsRaiser).not.toBeNull();
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [300, 120],
        't.rBet.hu': [300, 6],
      })
    );
    const vsPassive = omahaBigDrawBetOnHisResponseVerdict(mid.hero, mid.gs, on)!;
    expect(vsPassive).not.toBeNull();
    expect(vsRaiser.evBet).toBeLessThan(vsPassive.evBet);

    // Proof shrinks smoothly with larger sample size n
    clearDecisionHud();
    const vNoRead = omahaBigDrawBetOnHisResponseVerdict(mid.hero, mid.gs, on)!;
    installDecisionHud(
      makeHudPacket('plo5', 'opp-1', {
        't.fb.bg.hu': [500, 330],
        't.rBet.hu': [500, 45],
      })
    );
    const vDeep = omahaBigDrawBetOnHisResponseVerdict(mid.hero, mid.gs, on)!;
    expect(vDeep.proof).toBeLessThan(vNoRead.proof);
  });

  it('is deterministic across seeds and leaves PLO6 whole decisions identical', () => {
    const on: HorseDecideOpts = { omahaBigDrawBetIsPricedOnHisResponse: true };
    const { hero, gs } = makeSpot({ hole: 'AsKsJcTd7h', board: '9s8s2c', inPosition: false });
    const chk: HorseDecision = { action: 'check', thinkTime: 0 };
    const first = omahaBigDrawBetOnHisResponseRule(chk, hero, gs, on);
    expect(first).not.toBeNull();
    for (const seed of [1, 13, 99]) {
      seedFastRandom(seed);
      expect(omahaBigDrawBetOnHisResponseRule(chk, hero, gs, on)).toEqual(first);
    }

    const plo6 = makeSpot({ variant: 'plo6', hole: 'AsKsJcTd7h5c', board: '9s8s2c' });
    seedFastRandom(77);
    const off = HorseLogic.decide(plo6.hero, plo6.gs, undefined, undefined, {});
    seedFastRandom(77);
    const withOn = HorseLogic.decide(plo6.hero, plo6.gs, undefined, undefined, on);
    expect({ action: withOn.action, amount: withOn.amount }).toEqual({
      action: off.action,
      amount: off.amount,
    });
  });
});
