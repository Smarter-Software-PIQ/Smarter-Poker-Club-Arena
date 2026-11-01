import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import {
  boardHasPassedPremium,
  holdemFourBetSpot,
  holdemPremiumAggressionVerdict,
  isPremiumMadeHand,
  type HoldemPremiumDecision,
} from './HorseHoldemPremiumAggression.js';
import { horseDecisionReceiptIsValid } from './horseDecision/responseValidation.js';
import type { Card, SeatPlayer } from '../types.js';

const suits: Record<string, Card['suit']> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  s ? s.split(' ').map((c) => ({ rank: c[0] as Card['rank'], suit: suits[c[1]] })) : [];

const SEEDS = [1, 7, 42, 99, 2026];
const STYLES = ['tag', 'lag', 'balanced', 'tricky', 'grinder'] as const;

function seat(
  n: number,
  stack: number,
  bet: number,
  over: Partial<SeatPlayer> & { hole?: string } = {}
): SeatPlayer {
  return {
    seat: n,
    user_id: `p${n}`,
    username: `p${n}`,
    stack,
    bet,
    totalInvested: bet,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: cards(over.hole ?? ''),
    ...over,
  } as SeatPlayer;
}

const PREFLOP = [
  { stage: 'preflop', seat: 7, userId: 'p7', action: 'sb', amount: 150 },
  { stage: 'preflop', seat: 9, userId: 'p9', action: 'bb', amount: 300 },
  { stage: 'preflop', seat: 1, userId: 'p1', action: 'raise', amount: 600, isFullRaise: true },
  { stage: 'preflop', seat: 2, userId: 'p2', action: 'fold', amount: 0 },
  { stage: 'preflop', seat: 3, userId: 'p3', action: 'raise', amount: 2746, isFullRaise: true },
  { stage: 'preflop', seat: 4, userId: 'p4', action: 'fold', amount: 0 },
];

/**
 * The recorded hand, 2026-10-26 02:02 UTC, mystery-bounty MTT level 6,
 * 150/300 + 300 BB ante. A human opened 600 UTG, horse seat 3 3-bet AA to
 * 2,746, horse seat 5 cold-called with KQo (stack 20,601 before the call).
 */
function coldCallSpot(
  over: { hole?: string; stack?: number; threeBet?: number; variant?: string } = {}
) {
  const threeBet = over.threeBet ?? 2746;
  const stack = over.stack ?? 20601;
  const hero = seat(5, stack, 0, { hole: over.hole ?? 'Ks Qd' });
  const history = PREFLOP.map((a) => (a.seat === 3 ? { ...a, amount: threeBet } : a));
  const gs = {
    players: [
      seat(1, 22164, 600),
      seat(2, 28885, 0, { is_folded: true }),
      seat(3, 25832 - threeBet, threeBet),
      seat(4, 26951, 0, { is_folded: true }),
      hero,
      seat(6, 21551, 0),
      seat(7, 20834, 150),
      seat(9, 25721, 300),
    ],
    communityCards: [],
    pot: 1350 + threeBet,
    currentBet: threeBet,
    minRaise: threeBet - 600,
    lastRaise: threeBet - 600,
    stage: 'preflop',
    gameVariant: over.variant ?? 'nlh',
    gameMode: 'tournament',
    bigBlind: 300,
    dealerSeat: 6,
    toCall: threeBet,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    minRaiseTo: threeBet * 2 - 600,
    maxRaiseTo: stack,
    bettingStructure: 'no_limit',
    actionHistory: history,
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** Heads-up flop between the two horses: AA first to act on 9h 5s 3s. */
function aceSpot(
  over: { board?: string; stage?: string; hole?: string; pot?: number; heroStack?: number } = {}
) {
  const heroStack = over.heroStack ?? 23086;
  const hero = seat(3, heroStack, 0, { hole: over.hole ?? 'As Ah', totalInvested: 2746 });
  const villain = seat(5, 17855, 0, { totalInvested: 2746 });
  const board = over.board ?? '9h 5s 3s';
  const gs = {
    players: [
      seat(1, 22164, 0, { is_folded: true }),
      seat(2, 28885, 0, { is_folded: true }),
      hero,
      seat(4, 26951, 0, { is_folded: true }),
      villain,
      seat(6, 21551, 0, { is_folded: true }),
      seat(7, 20834, 0, { is_folded: true }),
      seat(9, 25721, 0, { is_folded: true }),
    ],
    communityCards: cards(board),
    pot: over.pot ?? 6842,
    currentBet: 0,
    minRaise: 300,
    stage:
      over.stage ??
      (cards(board).length === 3 ? 'flop' : cards(board).length === 4 ? 'turn' : 'river'),
    gameVariant: 'nlh',
    gameMode: 'tournament',
    bigBlind: 300,
    dealerSeat: 6,
    toCall: 0,
    legalActions: ['fold', 'check', 'bet', 'all_in'],
    minRaiseTo: 300,
    maxRaiseTo: heroStack,
    bettingStructure: 'no_limit',
    actionHistory: [
      ...PREFLOP,
      { stage: 'preflop', seat: 5, userId: 'p5', action: 'call', amount: 2746 },
      { stage: 'preflop', seat: 1, userId: 'p1', action: 'fold', amount: 0 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

function decide(
  s: { hero: SeatPlayer; gs: HorseGameStateV2 },
  seed: number,
  style: (typeof STYLES)[number] = 'balanced'
) {
  seedFastRandom(seed);
  return HorseLogic.decide(s.hero, s.gs, style, {}, { mind: false });
}

function verdictFor(s: { hero: SeatPlayer; gs: HorseGameStateV2 }, action: string) {
  const g = s.gs;
  return holdemPremiumAggressionVerdict({ action } as HoldemPremiumDecision, {
    gameVariant: g.gameVariant,
    bettingStructure: g.bettingStructure,
    multiBoard: false,
    stage: g.stage,
    board: g.communityCards,
    hero: s.hero,
    players: g.players,
    pot: g.pot,
    currentBet: g.currentBet,
    bigBlind: g.bigBlind,
    toCall: g.toCall,
    legalActions: g.legalActions,
    minRaiseTo: g.minRaiseTo,
    maxRaiseTo: g.maxRaiseTo,
    actionHistory: g.actionHistory,
  });
}

afterEach(() => HorseMind.reset());

describe("Hold'em premiums are never passive; dominated hands fold to a 3-bet (Dan 2026-10-25)", () => {
  it('the recorded KQo horse folds to the huge 3-bet instead of cold-calling it', () => {
    for (const seed of SEEDS) expect(decide(coldCallSpot(), seed).action).toBe('fold');
    for (const style of STYLES) expect(decide(coldCallSpot(), 3, style).action).toBe('fold');
  });

  it('every rule decision is signed by the policy graph, so the live worker accepts it', () => {
    // 2026-10-26: a rule applied after graph.finish leaves a graph whose final
    // action is the brain's, and the engine refuses the decision as an
    // "invalid policy receipt" (it did, 495 times, for the PLO paired-board
    // fold). Both rules now run last inside the graph's wager_rules node.
    for (const [spot, want] of [
      [coldCallSpot(), ['fold']],
      [aceSpot(), ['bet', 'all_in']],
      [aceSpot({ board: '9h 5s 3s 9s 6c' }), ['bet', 'all_in']],
    ] as const) {
      for (const seed of SEEDS) {
        const d = decide(spot, seed);
        expect(want).toContain(d.action);
        expect(d.policyGraph?.finalAction.action).toBe(d.action);
        expect(horseDecisionReceiptIsValid(d, 'nlh')).toBe(true);
      }
    }
  });

  it('KJo, QJo, AJo and AQo cold-callers fold too; AKo and pairs are not touched by the fold rule', () => {
    for (const hole of ['Kc Jd', 'Qc Jd', 'Ac Jd', 'Ac Qd']) {
      expect(verdictFor(coldCallSpot({ hole }), 'call')?.rule).toBe('dominated_3bet_fold');
    }
    expect(verdictFor(coldCallSpot({ hole: 'Ac Kd' }), 'call')?.rule).not.toBe(
      'dominated_3bet_fold'
    );
    expect(verdictFor(coldCallSpot({ hole: 'Tc Td' }), 'call')).toBeNull();
    expect(verdictFor(coldCallSpot({ hole: 'Kc Qc' }), 'call')).toBeNull(); // suited: brain decides
  });

  it('push/fold depth and a min 3-bet are left to the brain', () => {
    expect(verdictFor(coldCallSpot({ stack: 5000 }), 'call')).toBeNull(); // ~17bb effective
    expect(verdictFor(coldCallSpot({ threeBet: 1200 }), 'call')).toBeNull(); // 2x, not huge
  });

  it('the recorded aces bet the flop, the turn and the river instead of checking it down', () => {
    for (const seed of SEEDS) {
      for (const board of ['9h 5s 3s', '9h 5s 3s 9s', '9h 5s 3s 9s 6c']) {
        const d = decide(aceSpot({ board }), seed);
        expect(['bet', 'all_in']).toContain(d.action);
      }
    }
    for (const style of STYLES)
      expect(['bet', 'all_in']).toContain(decide(aceSpot(), 5, style).action);
  });

  it('the forced bet is a real size: half pot on a dry flop, two-thirds on a wet one, legal always', () => {
    const dry = verdictFor(aceSpot({ board: 'Kh 7c 2d' }), 'check');
    expect(dry?.decision.action).toBe('bet');
    expect(dry?.decision.amount).toBeCloseTo(6842 / 2, 0);
    const wet = verdictFor(aceSpot(), 'check');
    expect(wet?.decision.amount).toBeCloseTo((6842 * 2) / 3, 0);
    const committed = verdictFor(aceSpot({ heroStack: 4000 }), 'check');
    expect(committed?.decision.action).toBe('all_in');
  });

  it('KK, QQ overpairs and AK top pair bet; QQ under a king does not count as premium-made', () => {
    expect(isPremiumMadeHand(cards('Kc Kd'), cards('9h 5s 3s'))).toBe(true);
    expect(isPremiumMadeHand(cards('Qc Qd'), cards('9h 5s 3s'))).toBe(true);
    expect(isPremiumMadeHand(cards('Ac Kd'), cards('Ah 5s 3s'))).toBe(true);
    expect(isPremiumMadeHand(cards('Ac Kd'), cards('Kh 5s 3s'))).toBe(true);
    expect(isPremiumMadeHand(cards('Qc Qd'), cards('Kh 5s 3s'))).toBe(false);
    // Sets (2026-10-26 live: QsQc on Qh 9s 3d Ad 4d checked the river down).
    expect(isPremiumMadeHand(cards('Qs Qc'), cards('Qh 9s 3d'))).toBe(true);
    expect(isPremiumMadeHand(cards('Qs Qc'), cards('Qh 9s 3d Ad 4d'))).toBe(true);
    expect(isPremiumMadeHand(cards('Kc Kd'), cards('Ah Ks 3s'))).toBe(true);
    expect(isPremiumMadeHand(cards('Ac Kd'), cards('Qh 5s 3s'))).toBe(false);
  });

  it('actual final decisions value-bet Broadway and connected-board full houses with valid receipts', () => {
    for (const seed of SEEDS) {
      for (const spot of [
        aceSpot({ hole: 'As Kd', board: 'Th Jc Qd 9s 2h' }),
        aceSpot({ hole: 'Qs Qd', board: 'Qh Jc Td 9s 9h' }),
      ]) {
        const decision = decide(spot, seed);
        expect(['bet', 'all_in']).toContain(decision.action);
        expect(horseDecisionReceiptIsValid(decision, 'nlh')).toBe(true);
      }
    }
  });

  it('the recorded set of queens bets the river instead of checking it down', () => {
    for (const seed of SEEDS) {
      const d = decide(aceSpot({ hole: 'Qs Qc', board: 'Qh 9s 3d Ad 4d' }), seed);
      expect(['bet', 'all_in']).toContain(d.action);
    }
  });

  it('only a board that has plainly passed the hand still allows a check', () => {
    expect(boardHasPassedPremium(cards('As Ah'), cards('9h 5h 3h 2h'))).toBe(false); // holds the Ah
    expect(boardHasPassedPremium(cards('As Ad'), cards('9h 5h 3h 2h'))).toBe(true);
    expect(boardHasPassedPremium(cards('As Ad'), cards('9h Tc Jd Qs'))).toBe(true);
    expect(verdictFor(aceSpot({ hole: 'As Ad', board: '9h 5h 3h 2h' }), 'check')).toBeNull();
  });

  it('a premium raise is in whole chips at a tournament table (the table refuses 402.5)', () => {
    for (const hole of ['Qs Qh', 'Kc Kd', 'Ac Kd']) {
      for (const seed of SEEDS) {
        const d = decide(coldCallSpot({ hole, threeBet: 1301 }), seed);
        if (d.action === 'raise') expect(Number.isInteger(d.amount)).toBe(true);
      }
    }
  });

  it('KK and QQ facing a 3-bet re-raise instead of flatting it', () => {
    for (const hole of ['Kc Kd', 'Qc Qd', 'Ac Kd']) {
      const v = verdictFor(coldCallSpot({ hole }), 'call');
      expect(v?.rule).toBe('premium_preflop_raise');
      expect(['raise', 'all_in']).toContain(v?.decision.action);
    }
    for (const seed of SEEDS) {
      expect(['raise', 'all_in']).toContain(decide(coldCallSpot({ hole: 'Kc Kd' }), seed).action);
    }
  });

  it('the rule is hold em only: Omaha and fixed limit are untouched', () => {
    expect(verdictFor(coldCallSpot({ variant: 'plo4', hole: 'Ks Qd' }), 'call')).toBeNull();
    const fl = aceSpot();
    (fl.gs as { bettingStructure?: string }).bettingStructure = 'fixed_limit';
    expect(verdictFor(fl, 'check')).toBeNull();
  });

  it('the switch exists only to ablate: off, the brain is left alone', () => {
    const s = coldCallSpot();
    seedFastRandom(1);
    const off = HorseLogic.decide(
      s.hero,
      s.gs,
      'balanced',
      {},
      { mind: false, holdemPremiumAggression: false }
    );
    expect(off.action).toBeDefined();
  });
});

/**
 * The recorded hand, 2026-11-01 02:03 UTC, Saturday Mystery (NLH), blinds
 * 75/150, hand 53158209. A horse (seat 8, 16,050 = 107bb) opened QQ to 466,
 * the human in seat 1 3-bet to 1,631, the horse 4-bet to 3,751, the human
 * moved all in for 39,870, and the horse folded QQ.
 */
function fourBetJamSpot(over: { hole?: string; legal?: string[]; jam?: number } = {}) {
  const jam = over.jam ?? 39870;
  const heroStart = 16050;
  const hero = seat(8, heroStart - 3751, 3751, { hole: over.hole ?? 'Qs Qh' });
  const villainAllIn = jam >= 39870;
  const gs = {
    players: [
      seat(1, villainAllIn ? 0 : 39870 - jam, jam, { is_all_in: villainAllIn }),
      seat(2, 20000, 75, { is_folded: true }),
      seat(3, 20000, 150, { is_folded: true }),
      seat(4, 20000, 0, { is_folded: true }),
      seat(5, 20000, 0, { is_folded: true }),
      seat(6, 20000, 0, { is_folded: true }),
      hero,
    ],
    communityCards: [],
    pot: 75 + 150 + 3751 + jam,
    currentBet: jam,
    minRaise: jam - 3751,
    lastRaise: jam - 3751,
    stage: 'preflop',
    gameVariant: 'nlh',
    gameMode: 'tournament',
    bigBlind: 150,
    dealerSeat: 5,
    toCall: jam - 3751,
    legalActions: over.legal ?? ['fold', 'call', 'all_in'],
    minRaiseTo: villainAllIn ? null : jam * 2 - 3751,
    maxRaiseTo: heroStart,
    bettingStructure: 'no_limit',
    actionHistory: [
      { stage: 'preflop', seat: 2, userId: 'p2', action: 'sb', amount: 75 },
      { stage: 'preflop', seat: 3, userId: 'p3', action: 'bb', amount: 150 },
      { stage: 'preflop', seat: 8, userId: 'p8', action: 'raise', amount: 466, isFullRaise: true },
      { stage: 'preflop', seat: 1, userId: 'p1', action: 'raise', amount: 1631, isFullRaise: true },
      { stage: 'preflop', seat: 2, userId: 'p2', action: 'fold', amount: 0 },
      { stage: 'preflop', seat: 3, userId: 'p3', action: 'fold', amount: 0 },
      { stage: 'preflop', seat: 8, userId: 'p8', action: 'raise', amount: 3751, isFullRaise: true },
      {
        stage: 'preflop',
        seat: 1,
        userId: 'p1',
        action: villainAllIn ? 'all_in' : 'raise',
        amount: jam,
        isFullRaise: true,
      },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** The same table one action earlier: the horse faces the 3-bet to 1,631. */
function facingThreeBetSpot(hole: string) {
  const hero = seat(8, 16050 - 466, 466, { hole });
  const gs = {
    players: [
      seat(1, 39870 - 1631, 1631),
      seat(2, 20000, 75, { is_folded: true }),
      seat(3, 20000, 150, { is_folded: true }),
      seat(4, 20000, 0, { is_folded: true }),
      seat(5, 20000, 0, { is_folded: true }),
      seat(6, 20000, 0, { is_folded: true }),
      hero,
    ],
    communityCards: [],
    pot: 75 + 150 + 466 + 1631,
    currentBet: 1631,
    minRaise: 1165,
    lastRaise: 1165,
    stage: 'preflop',
    gameVariant: 'nlh',
    gameMode: 'tournament',
    bigBlind: 150,
    dealerSeat: 5,
    toCall: 1631 - 466,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    minRaiseTo: 2796,
    maxRaiseTo: 16050,
    bettingStructure: 'no_limit',
    actionHistory: [
      { stage: 'preflop', seat: 2, userId: 'p2', action: 'sb', amount: 75 },
      { stage: 'preflop', seat: 3, userId: 'p3', action: 'bb', amount: 150 },
      { stage: 'preflop', seat: 8, userId: 'p8', action: 'raise', amount: 466, isFullRaise: true },
      { stage: 'preflop', seat: 1, userId: 'p1', action: 'raise', amount: 1631, isFullRaise: true },
      { stage: 'preflop', seat: 2, userId: 'p2', action: 'fold', amount: 0 },
      { stage: 'preflop', seat: 3, userId: 'p3', action: 'fold', amount: 0 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

describe('No hold em 4-bet is ever made to fold (Dan 2026-10-31)', () => {
  it('the recorded QQ horse calls the jam over its 4-bet instead of folding, every seed and style', () => {
    for (const seed of SEEDS) {
      const d = decide(fourBetJamSpot(), seed);
      expect(['call', 'all_in']).toContain(d.action);
      expect(d.policyGraph?.finalAction.action).toBe(d.action);
      expect(horseDecisionReceiptIsValid(d, 'nlh')).toBe(true);
    }
    for (const style of STYLES) {
      expect(['call', 'all_in']).toContain(decide(fourBetJamSpot(), 3, style).action);
    }
  });

  it('a fold after the horse own 4-bet is re-raised becomes a call, or the all-in when calling is all in', () => {
    for (const hole of ['Qs Qh', 'Ac Kd', 'Jc Jd', 'As 5s']) {
      const v = verdictFor(fourBetJamSpot({ hole }), 'fold');
      expect(v?.rule).toBe('four_bettor_continues');
      expect(v?.decision.action).toBe('call');
      const allInOnly = verdictFor(fourBetJamSpot({ hole, legal: ['fold', 'all_in'] }), 'fold');
      expect(allInOnly?.decision.action).toBe('all_in');
    }
  });

  it('AA and KK facing a non-all-in 5-bet over their 4-bet put the rest in', () => {
    for (const hole of ['As Ah', 'Kc Kd']) {
      const v = verdictFor(
        fourBetJamSpot({ hole, jam: 9000, legal: ['fold', 'call', 'raise', 'all_in'] }),
        'fold'
      );
      expect(v?.rule).toBe('premium_preflop_raise');
      expect(v?.decision.action).toBe('all_in');
    }
  });

  it('a sized 4-bet is made only with QQ+ or AK; every other hand calls the 3-bet instead', () => {
    for (const hole of ['As 5s', 'Jc Jd', 'Tc Td', 'Ac Qc', 'Kc Qc', '7c 6c']) {
      const v = verdictFor(facingThreeBetSpot(hole), 'raise');
      expect(v?.rule).toBe('no_four_bet_bluff');
      expect(v?.decision.action).toBe('call');
    }
    for (const hole of ['Qs Qh', 'Kc Kd', 'As Ah', 'Ac Kd', 'Ac Kc']) {
      expect(verdictFor(facingThreeBetSpot(hole), 'raise')).toBeNull();
    }
    // An all-in re-raise has nothing left to fold to: left to the brain.
    expect(verdictFor(facingThreeBetSpot('As 5s'), 'all_in')).toBeNull();
  });

  it('the real brain never 4-bets below QQ+/AK over the recorded 3-bet, and its receipts stay valid', () => {
    for (const hole of ['As 5s', 'Jc Jd', 'Ac Qc', 'Kc Qc', 'Ah 4h', 'Tc Td']) {
      for (const seed of SEEDS) {
        const d = decide(facingThreeBetSpot(hole), seed);
        expect(d.action).not.toBe('raise');
        expect(horseDecisionReceiptIsValid(d, 'nlh')).toBe(true);
      }
    }
  });

  it('a horse that only 3-bet may still fold to a 4-bet; a short 4-bettor still calls the jam', () => {
    const s = fourBetJamSpot();
    // The human opened and 4-bet; the horse made the 3-bet only.
    const g = s.gs as unknown as {
      actionHistory: Array<{ seat: number; userId: string; amount: number }>;
    };
    g.actionHistory = g.actionHistory
      .filter((_, n) => n !== 7)
      .map((a, n) =>
        n === 2
          ? { ...a, seat: 1, userId: 'p1' }
          : n === 3
            ? { ...a, seat: 8, userId: 'p8' }
            : n === 6
              ? { ...a, seat: 1, userId: 'p1', amount: 39870 }
              : a
      );
    expect(verdictFor(s, 'fold')).toBeNull();
    const short = fourBetJamSpot();
    short.hero.stack = 300;
    (short.gs as { maxRaiseTo: number }).maxRaiseTo = 300 + 3751;
    expect(verdictFor(short, 'fold')?.rule).toBe('four_bettor_continues');
  });

  it('the live worker admits a rule-4 call only in its own spot', () => {
    let exercised = 0;
    for (const hole of ['Jc Jd', 'Tc Td', 'Ac Qc', 'As 5s', 'Ah 4h', 'Kc Qc']) {
      for (const seed of SEEDS) {
        for (const style of STYLES) {
          const spot = facingThreeBetSpot(hole);
          const d = decide(spot, seed, style);
          const ctx = { player: spot.hero, gameState: spot.gs };
          expect(horseDecisionReceiptIsValid(d, 'nlh', ctx)).toBe(true);
          const t = d.policyGraph?.transitions.find((x) => x.node === 'wager_rules' && x.changed);
          if (t?.before?.action !== 'raise' || t.after.action !== 'call') continue;
          exercised++;
          const other = aceSpot();
          expect(
            horseDecisionReceiptIsValid(d, 'nlh', { player: other.hero, gameState: other.gs })
          ).toBe(false);
        }
      }
    }
    expect(exercised).toBeGreaterThan(0);
  });

  it('the receipt check admits exactly the two rule-4 spots', () => {
    const at = (s: { hero: SeatPlayer; gs: HorseGameStateV2 }) =>
      holdemFourBetSpot({
        gameVariant: s.gs.gameVariant,
        bettingStructure: s.gs.bettingStructure,
        stage: s.gs.stage,
        hero: s.hero,
        currentBet: s.gs.currentBet,
        bigBlind: s.gs.bigBlind,
        actionHistory: s.gs.actionHistory,
      });
    expect(at(fourBetJamSpot())).toBe('reraised_four_bet');
    expect(at(facingThreeBetSpot('As 5s'))).toBe('facing_three_bet');
    expect(at(aceSpot())).toBeNull();
  });
});
