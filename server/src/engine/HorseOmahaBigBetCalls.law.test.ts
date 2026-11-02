/**
 * V81 OMAHA BIG-BET CALL DISCIPLINE (2026-11-02, Phase 4). See
 * HorseOmahaBigBetCalls.ts for the two-day decision-EV evidence.
 *
 *  1. Exact classification at the decision and exactly the admitted cells.
 *  2. End to end: facing a pot-sized PLO4/PLO5 river bet with a non-nut
 *     straight or a dominated flush, the horse never calls; the off arm is
 *     today's answer; the receipt fires; the fold is a valid signed receipt.
 *  3. Outside the cells the answer is exactly today: a nut straight, a
 *     0.6-pot wager, a heads-up table, tournament two pair, PLO6.
 *  4. Label flips never change the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { omahaCallClass, v81Cell, type V81Input } from './HorseOmahaBigBetCalls.js';
import { horseDecisionReceiptIsValid } from './horseDecision/responseValidation.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-000000000081';

/** Ring table (a third seat folded preflop); checked to the river; villain bets `bet` into 36. */
function river(
  variant: string,
  hole: string,
  board: string,
  bet: number,
  o: { flip?: boolean; seats?: 2 | 3; mode?: 'cash' | 'tournament'; heroStack?: number } = {}
) {
  const heroStack = o.heroStack ?? 300;
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: heroStack,
      bet: 0,
      totalInvested: 18,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: 300 - bet,
      bet,
      totalInvested: 18 + bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: o.flip === true,
    } as SeatPlayer,
  ];
  if ((o.seats ?? 3) === 3)
    players.push({
      seat: 3,
      user_id: 'folder',
      username: 'f',
      stack: 300,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
  const history = [
    ...((o.seats ?? 3) === 3
      ? [{ stage: 'preflop', seat: 3, userId: 'folder', action: 'fold', amount: 0, timestamp: 0 }]
      : []),
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 6, timestamp: 4 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 6, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0, timestamp: 7 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
    { stage: 'river', seat: 2, userId: VILLAIN, action: 'bet', amount: bet, timestamp: 9 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: 36 + bet,
      currentBet: bet,
      toCall: bet,
      minRaiseTo: 2 * bet,
      maxRaiseTo: heroStack,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: o.mode ?? 'cash',
      bigBlind: 2,
      dealerSeat: 1,
      actionHistory: history,
    },
  };
}

function decideMany(s: ReturnType<typeof river>, opts: Record<string, unknown> = {}, seeds = 30) {
  const acts: string[] = [];
  let fires = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 81);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...opts,
    } as never) as { action: string; amount?: number };
    fires += drainFires().find((r) => r.feature === 'v81_omaha_big_bet_call_fold')?.fires ?? 0;
    acts.push(`${d.action}|${d.amount ?? ''}`);
  }
  return { acts, fires };
}
const calls = (acts: string[]) => acts.filter((a) => a.startsWith('call')).length;
const OFF = { v81OmahaBigBetCalls: false };

// PLO4. Board 9h 8c 7d 2s 3c: no flush possible, unpaired; J-T is the nut straight.
const DRY = '9h8c7d2s3c';
const NONNUT_STRAIGHT = '6s5hKdKc'; // 9-high straight
const NUT_STRAIGHT = 'JsTh4d4c'; // J-high straight, the nuts
// Board Kh 9h 4h 7c 2d: hearts flush possible; Jh 8h is the third-nut flush (Qh 8h would be second).
const FLUSHY = 'Kh9h4h7c2d';
const DOM_FLUSH = 'Jh8hTsTd'; // J-high flush: A and Q live above it, so 3rd nut or worse

describe('V81 Omaha big-bet call discipline', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('classifies at the decision and admits exactly the measured cells', () => {
    expect(omahaCallClass(cards(NONNUT_STRAIGHT), cards(DRY))).toBe('straight_nonnut');
    expect(omahaCallClass(cards(NUT_STRAIGHT), cards(DRY))).toBe('straight_nut');
    expect(omahaCallClass(cards(DOM_FLUSH), cards(FLUSHY))).toBe('flush_dominated');
    expect(omahaCallClass(cards('Ah5h6s6d'), cards(FLUSHY))).toBe('flush_nut');
    expect(omahaCallClass(cards('Qh8hTsTd'), cards(FLUSHY))).toBe('flush_second'); // not admitted
    expect(omahaCallClass(cards('Js8sKs7d'), cards('Ks9h4h7c2d'))).toBe('two_pair');
    const base: V81Input = {
      variant: 'plo4',
      street: 'river',
      hole: cards(NONNUT_STRAIGHT),
      board: cards(DRY),
      potFrac: 1,
      effectiveBB: 150,
      tournament: false,
      headsUpTable: false,
      bountyEvent: false,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      heroHasStreetChips: false,
    };
    expect(v81Cell(base)).toBe('straight_nonnut');
    expect(v81Cell({ ...base, variant: 'plo5', hole: cards('6s5hKdKc2h') })).toBe(
      'straight_nonnut'
    );
    expect(v81Cell({ ...base, potFrac: 0.89 })).toBeNull();
    expect(v81Cell({ ...base, effectiveBB: 20 })).toBeNull();
    expect(v81Cell({ ...base, headsUpTable: true })).toBeNull();
    expect(v81Cell({ ...base, bountyEvent: true })).toBeNull();
    expect(v81Cell({ ...base, heroHasStreetChips: true })).toBeNull();
    expect(v81Cell({ ...base, hiLo: true })).toBeNull();
    expect(v81Cell({ ...base, multiBoard: true })).toBeNull();
    expect(v81Cell({ ...base, bombPot: true })).toBeNull();
    expect(v81Cell({ ...base, variant: 'plo6', hole: cards('6s5hKdKc2h3d') })).toBeNull();
    expect(v81Cell({ ...base, hole: cards(NUT_STRAIGHT) })).toBeNull();
    // Turn: a non-nut straight is NOT admitted (straddled on the turn).
    expect(v81Cell({ ...base, street: 'turn', board: cards('9h8c7d2s') })).toBeNull();
    // Turn: a dominated flush IS admitted.
    expect(
      v81Cell({ ...base, street: 'turn', hole: cards(DOM_FLUSH), board: cards('Kh9h4h7c') })
    ).toBe('flush_dominated');
    // Two pair: cash only.
    const tp = { ...base, hole: cards('Js8sKs7d'), board: cards('Ks9h4h7c2d') };
    expect(v81Cell(tp)).toBe('two_pair');
    expect(v81Cell({ ...tp, tournament: true })).toBeNull();
  });

  it('facing a pot-sized river bet, a non-nut straight and a dominated flush never call; off is today', () => {
    let offCalls = 0;
    for (const [hole, board] of [
      [NONNUT_STRAIGHT, DRY],
      [DOM_FLUSH, FLUSHY],
    ]) {
      const s = river('plo4', hole, board, 36);
      const on = decideMany(s);
      const off = decideMany(s, OFF);
      expect(calls(on.acts), hole).toBe(0);
      expect(off.fires, hole).toBe(0);
      offCalls += calls(off.acts);
      if (calls(off.acts) > 0) expect(on.fires, hole).toBeGreaterThan(0);
      // Every answer that was not a call is unchanged.
      on.acts.forEach((a, k) => {
        if (!off.acts[k].startsWith('call')) expect(a).toBe(off.acts[k]);
      });
    }
    // The fixture is not vacuous: today's brain calls these spots.
    expect(offCalls).toBeGreaterThan(0);
  });

  it('the fold is a valid signed policy receipt', () => {
    const s = river('plo4', NONNUT_STRAIGHT, DRY, 36);
    for (let seed = 1; seed <= 10; seed++) {
      seedFastRandom(seed);
      HorseMind.reset();
      const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, { mind: false } as never);
      expect(
        horseDecisionReceiptIsValid(d, 'plo4', { player: s.hero, gameState: s.gs as never })
      ).toBe(true);
    }
  });

  it('outside the cells the answer is exactly today', () => {
    const cases: Array<[string, ReturnType<typeof river>]> = [
      ['nut straight', river('plo4', NUT_STRAIGHT, DRY, 36)],
      ['0.6-pot wager', river('plo4', NONNUT_STRAIGHT, DRY, 22)],
      ['heads-up table', river('plo4', NONNUT_STRAIGHT, DRY, 36, { seats: 2 })],
      ['tournament two pair', river('plo4', 'Js8sKs7d', 'Ks9h4h7c2d', 36, { mode: 'tournament' })],
      ['PLO6', river('plo6', '6s5hKdKc2h3d', DRY, 36)],
      ['20bb effective', river('plo4', NONNUT_STRAIGHT, DRY, 36, { heroStack: 40 })],
    ];
    for (const [label, s] of cases) {
      const on = decideMany(s, {}, 15);
      expect(on.acts, label).toEqual(decideMany(s, OFF, 15).acts);
      expect(on.fires, label).toBe(0);
    }
  });

  it('one policy: label flips never change the answer', () => {
    for (const [hole, board] of [
      [NONNUT_STRAIGHT, DRY],
      [NUT_STRAIGHT, DRY],
    ]) {
      expect(decideMany(river('plo4', hole, board, 36, { flip: true }), {}, 15).acts).toEqual(
        decideMany(river('plo4', hole, board, 36), {}, 15).acts
      );
    }
  });
});
