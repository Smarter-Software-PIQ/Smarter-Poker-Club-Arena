/**
 * omahaFacingBetPaysTheWholeDeduction (default OFF; EMERG lane RAKE 2026-11-20).
 * Law: with the option on, in PLO4/PLO5 cash, the Omaha facing-bet call verdicts deduct the whole
 * projected deduction of the pot after the call (the capped rake of the dealt-player tier plus the
 * fixed jackpot drop, by the controller's own arithmetic) instead of the marginal rake rate. The
 * whole deduction is never below the marginal one, so the option never turns a fold into a call.
 * Off is byte-identical; PLO6, a tournament and a Diamond table are byte-identical with it on.
 * Synthetic public states only: no recorded hand, no player id.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseCallDeductionFraction, horseWholeDeductionOfTheCall } from './HorseCallDeductions.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  return out;
}
const TIMING_KEYS = new Set(['latencyMs', 'elapsedMs', 'simulationMs', 'policyMs']);
const BASE = { omahaFacingBetEv: true };
const ON = { ...BASE, omahaFacingBetPaysTheWholeDeduction: true };
const BOARD = 'KhQs8d7c3h';

interface Shape {
  variant?: string;
  hole?: string;
  /** the pot before the river bet, half from each of the two live players */
  potStart?: number;
  bet?: number;
  mode?: 'cash' | 'tournament';
  /** seats dealt in (the others folded preflop with nothing in) */
  dealt?: number;
  asset?: 'chips' | 'diamonds';
}
/** Blinds 1/2, rake 10% capped at 5 (2.5 big blinds; heads-up 2.5), jackpot drop 0.6 big blinds with
 *  three or more dealt. The Horse checked the river and faces `bet` into `potStart`. */
function river(shape: Shape = {}) {
  const variant = shape.variant ?? 'plo5';
  const potStart = shape.potStart ?? 60;
  const bet = shape.bet ?? 40;
  const dealt = shape.dealt ?? 6;
  const half = potStart / 2;
  const seat = (n: number, user: string, over: Partial<SeatPlayer>): SeatPlayer =>
    ({
      seat: n,
      user_id: user,
      username: user,
      stack: 400,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
      ...over,
    }) as SeatPlayer;
  const players: SeatPlayer[] = [
    seat(1, 'hero', {
      stack: 400 - half,
      totalInvested: half,
      cards: cards(shape.hole ?? 'QhJd4c5s2d'),
      is_folded: false,
    }),
    seat(2, 'villain', {
      stack: 400 - half - bet,
      bet,
      totalInvested: half + bet,
      is_folded: false,
      is_horse: false,
    }),
  ];
  for (let n = 3; n <= dealt; n++) players.push(seat(n, `folded-${n}`, {}));
  const history = [
    { stage: 'preflop', seat: 2, userId: 'villain', action: 'raise', amount: half / 2 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: half / 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'flop', seat: 2, userId: 'villain', action: 'bet', amount: half / 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: half / 2 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'turn', seat: 2, userId: 'villain', action: 'check', amount: 0 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0 },
    { stage: 'river', seat: 2, userId: 'villain', action: 'bet', amount: bet },
  ];
  return {
    hero: players[0],
    gs: {
      stateSchemaVersion: 1,
      players,
      dealtSeatIds: players.map((p) => p.seat),
      communityCards: cards(BOARD),
      pot: potStart + bet,
      contestablePot: potStart + bet,
      currentBet: bet,
      toCall: bet,
      minRaiseTo: bet * 2,
      maxRaiseTo: 400 - half,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage: 'river',
      gameVariant: variant,
      bettingStructure: 'pot_limit',
      gameMode: shape.mode ?? 'cash',
      asset: shape.asset ?? 'chips',
      chipUnit: 0.01,
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      rakeConfig: {
        percent: 10,
        cap: 5,
        noFlopNoDrop: true,
        playerCountCaps: [
          { players: 2, cap: 2.5 },
          { players: 3, cap: 5 },
        ],
      },
      bbjConfig: { enabled: true, feeBB: 0.6, minPotBB: 10, minPlayersDealt: 3 },
      actionHistory: history.map((a, k) => ({ ...a, timestamp: k })),
    },
  };
}

function decideMany(s: ReturnType<typeof river>, opts: Record<string, unknown>, seeds = 3) {
  const out: string[] = [];
  let fired = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 21);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: true,
      ...opts,
    } as never);
    fired += drainFires().filter(
      (f) => f.feature === 'omaha_facing_bet_whole_deduction_priced'
    ).length;
    out.push(JSON.stringify(d, (k, v) => (TIMING_KEYS.has(k) ? 0 : v)));
  }
  return { out, fired };
}
const actionOf = (json: string): string => (JSON.parse(json) as { action: string }).action;

// holdings from a nothing hand to the nuts on Kh Qs 8d 7c 3h (five cards; the first four are the PLO4 hand)
const HOLES = [
  'QhJd4c5s2d',
  'KsJd4c5s2d',
  'KsQd4c5s2d',
  '8s8c4c5s2d',
  'JsTs9c4d2d',
  'AsAd4c5s2d',
  'KdKc4c5s2d',
  'Ah9h4c5s2d',
  '6s5d4c2s2d',
  'JhTd9s6c2d',
];

describe('omahaFacingBetPaysTheWholeDeduction (default OFF)', () => {
  beforeEach(() => {
    enableBrainTelemetry();
  });

  it('the whole deduction is the capped rake plus the jackpot drop of the pot after the call, as a share of the pot before it', () => {
    // 100 in the pot, 40 to call: pot after 140, rake min(14, 5) = 5, drop 1.2 -> 6.2 of the 100
    const capped = river({ potStart: 60, bet: 40 });
    expect(horseCallDeductionFraction(capped.hero, capped.gs as never, 40)).toBeCloseTo(
      6.2 / 140,
      9
    );
    expect(horseWholeDeductionOfTheCall(capped.hero, capped.gs as never)).toBeCloseTo(0.062, 9);
    // 12 in the pot, 4 to call: pot after 16, rake 1.6, drop 1.2 -> 2.8 of the 12
    const small = river({ potStart: 8, bet: 4 });
    expect(horseWholeDeductionOfTheCall(small.hero, small.gs as never)).toBeCloseTo(2.8 / 12, 9);
    // two dealt: 5%, half the cap, no jackpot drop -> min(7, 2.5) = 2.5 of the 100
    const headsUp = river({ potStart: 60, bet: 40, dealt: 2 });
    expect(horseWholeDeductionOfTheCall(headsUp.hero, headsUp.gs as never)).toBeCloseTo(0.025, 9);
  });

  it('nothing to call, a Diamond table or an unprojectable state has no whole deduction', () => {
    const s = river();
    const free = { ...s.gs, currentBet: 0, toCall: 0 };
    expect(horseWholeDeductionOfTheCall(s.hero, free as never)).toBeNull();
    expect(
      horseWholeDeductionOfTheCall(s.hero, { ...s.gs, asset: 'diamonds' } as never)
    ).toBeNull();
    expect(
      horseWholeDeductionOfTheCall(s.hero, { ...s.gs, stateSchemaVersion: undefined } as never)
    ).toBeNull();
  });

  it('option OFF is byte-identical to the option absent', () => {
    for (const variant of ['plo4', 'plo5'])
      for (const hole of HOLES.slice(0, 5)) {
        const s = river({ variant, hole: variant === 'plo4' ? hole.slice(0, 8) : hole });
        expect(decideMany(s, { ...BASE, omahaFacingBetPaysTheWholeDeduction: false }).out).toEqual(
          decideMany(s, BASE).out
        );
      }
  });

  it('on, the verdicts are priced at the whole deduction and no fold becomes a call', () => {
    let fired = 0;
    for (const variant of ['plo4', 'plo5'])
      for (const hole of HOLES)
        for (const [potStart, bet] of [
          [8, 4],
          [20, 14],
          [60, 40],
          [60, 60],
        ]) {
          const s = river({
            variant,
            hole: variant === 'plo4' ? hole.slice(0, 8) : hole,
            potStart,
            bet,
          });
          const off = decideMany(s, BASE).out.map(actionOf);
          const on = decideMany(s, ON);
          fired += on.fired;
          on.out.map(actionOf).forEach((a, k) => {
            if (off[k] === 'fold') expect(a).toBe('fold');
          });
        }
    expect(fired).toBeGreaterThan(0);
  });

  it('PLO6, a tournament and a Diamond table are byte-identical with the option on', () => {
    for (const hole of HOLES.slice(0, 5))
      for (const [potStart, bet] of [
        [8, 4],
        [60, 40],
      ]) {
        const six = river({ variant: 'plo6', hole: `${hole}9h`, potStart, bet });
        expect(decideMany(six, ON).out).toEqual(decideMany(six, BASE).out);
        const t = river({ hole, potStart, bet, mode: 'tournament' });
        expect(decideMany(t, ON).out).toEqual(decideMany(t, BASE).out);
        const d = river({ hole, potStart, bet, asset: 'diamonds' });
        expect(decideMany(d, ON).out).toEqual(decideMany(d, BASE).out);
      }
  });
});
