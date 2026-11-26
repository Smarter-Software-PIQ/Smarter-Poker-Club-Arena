/**
 * LAW: the V17 players-behind bluff multiplier is priced when `v17PosIsPriced` is on (single-board
 * no-limit Hold'em, flop and turn), and byte-identical when off and everywhere else (2026-11-22).
 *
 * Criteria: CRITERIA-V17POS-PLAYERS-BEHIND-PRICED.md (HORSE DECISIONS lane, sha256 417a75e9...).
 *
 *   1. The pure module draws no random number, imports nothing from opponentHud/ and reads no
 *      opponent hole cards.
 *   2. Its multiplier is the measured field fold-through ratio of the #11724 NLH tables
 *      (bettor in position for an opponent in front, out of position for one behind), floored by the
 *      share of the risk-adjusted price the field still covers; exactly 1 with 0 or 1 player behind.
 *   3. Monotone: more players behind never raises it; a measured over-folder never lowers it; a
 *      bubble factor never raises it; a field that beats the price is not trimmed.
 *   4. HorseLogic: OFF / unset / false byte-identical (action, amount, thinkTime, next RNG draw,
 *      receipts). ON leaves the river, Omaha, Short Deck, Fixed Limit and multi-board byte-identical;
 *      ON in NLH flop / turn replaces the fixed table (no `v17_pos_behind` receipt) with legal actions.
 *   5. The flag stays in OPTION_SWITCH_REFUSED, never in OPTION_SWITCH_NAMES.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { _clearGtoPostflop } from './GtoPostflop.js';
import { _clearGtoPostflopV31 } from './GtoPostflopV31.js';
import { fastRandom, seedFastRandom, variantInfo } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET,
  HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT,
  HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET,
} from './holdemEmpiricalPriors.js';
import {
  PLAYERS_BEHIND_REFERENCE_SIZE,
  playersBehindFlopTexture,
  playersBehindSeatPosition,
  pricePlayersBehindBluff,
  type PricePlayersBehindInput,
} from './HorsePlayersBehindBluffPriced.js';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_REFUSED,
  optionSwitchRefusal,
} from './HorseOptionSwitch.js';
import { calculateBettingState, validateAction } from './PokerEngine.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]!]! });
  }
  return out;
}

function firesMap(): Record<string, number> {
  const out = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  // One-time process-level Omaha reservoir initialisation receipts (first PLO4 / PLO5 deal of the
  // process), not decisions: whichever arm runs first records them.
  for (const k of Object.keys(out))
    if (/^upgrade04_omaha_reservoir_\d+_seen$/.test(k)) delete out[k];
  return out;
}

const FLOP_IP = HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.ip.medium.rate;
const FLOP_OOP = HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.oop.medium.rate;
const TURN_IP = HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET.ip.medium.rate;
const TURN_OOP = HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET.oop.medium.rate;

/** Hero in seat 1, opponents in seats 2.., dealer chosen so `behind` opponents act after hero. */
function pureInput(
  street: 'flop' | 'turn',
  oppCount: number,
  behind: number,
  extra: Partial<PricePlayersBehindInput> = {}
): PricePlayersBehindInput {
  // Seats 2..(1+oppCount). Dealer = the seat after which hero (seat 1) has exactly `behind` live
  // opponents left to act: dealer at seat (1 + behind) when behind < oppCount, else the last seat.
  const seats = Array.from({ length: oppCount }, (_, i) => i + 2);
  const dealerSeat = behind >= oppCount ? 1 + oppCount : 1 + behind === 1 ? 1 : 1 + behind;
  return {
    street,
    heroSeat: 1,
    dealerSeat,
    heroStack: 1000,
    pot: 100,
    board: cards('Kh9d4c'),
    opponents: seats.map((seat) => ({ seat, stack: 1000, foldToBet: null })),
    ...extra,
  };
}

function behindCount(input: PricePlayersBehindInput): number {
  const hero = playersBehindSeatPosition(input.heroSeat, input.dealerSeat);
  return input.opponents.filter((o) => playersBehindSeatPosition(o.seat, input.dealerSeat) > hero)
    .length;
}

// ---- HorseLogic end-to-end spots -------------------------------------------------------------

function seat(n: number, id: string, stack: number, bet: number, hole = ''): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: 20 + bet,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
}

interface Spot {
  hero: SeatPlayer;
  gs: Record<string, unknown>;
}

/**
 * Hero (seat 1, first to act postflop with the dealer on the last seat) facing no bet, checked to by
 * nobody: every opponent acts after hero (behind = oppCount). `dealerSeat: 1` puts hero last.
 */
function spot(opts: {
  variant?: string;
  stage?: 'flop' | 'turn' | 'river';
  oppCount?: number;
  heroLast?: boolean;
  heroHole?: string;
  board?: string;
  board2?: string;
}): Spot {
  const variant = opts.variant ?? 'nlh';
  const stage = opts.stage ?? 'flop';
  const oppCount = opts.oppCount ?? 3;
  const holeLen = variantInfo(variant).holeCount;
  const heroHole = opts.heroHole ?? (holeLen === 4 ? 'Jh9h4d3c' : 'Jh9h');
  const oppHole = holeLen === 4 ? '8c7c6s5s' : '8c7c';
  const heroId = '41000000-0000-4000-8000-0000000000b1';
  const hero = seat(1, heroId, 600, 0, heroHole);
  const opps = Array.from({ length: oppCount }, (_, i) =>
    seat(i + 2, `41000000-0000-4000-8000-0000000000a${i + 1}`, 600, 0, oppHole)
  );
  const dealerSeat = opts.heroLast ? 1 : oppCount + 1;
  const order = opts.heroLast ? [...opps, hero] : [hero, ...opps];
  const history: ActionRecord[] = [];
  let ts = 1000;
  for (const p of [...opps, hero]) {
    history.push({
      stage: 'preflop',
      seat: p.seat,
      userId: p.user_id,
      action: p === opps[0] ? 'raise' : 'call',
      amount: 10,
      timestamp: ts++,
    });
  }
  const streets = stage === 'flop' ? [] : stage === 'turn' ? ['flop'] : ['flop', 'turn'];
  for (const s of streets) {
    for (const p of order) {
      history.push({
        stage: s as 'flop' | 'turn',
        seat: p.seat,
        userId: p.user_id,
        action: 'check',
        amount: 0,
        timestamp: ts++,
      });
    }
  }
  if (opts.heroLast) {
    for (const p of opps) {
      history.push({
        stage,
        seat: p.seat,
        userId: p.user_id,
        action: 'check',
        amount: 0,
        timestamp: ts++,
      });
    }
  }
  const boardText =
    opts.board ?? (stage === 'flop' ? 'Kd8s2c' : stage === 'turn' ? 'Kd8s2c5h' : 'Kd8s2c5h3d');
  const gs: Record<string, unknown> = {
    handNumber: 917001,
    stage,
    pot: 10 * (oppCount + 1),
    currentBet: 0,
    minRaise: 2,
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat,
    gameVariant: variant,
    format: 'cash',
    bombPot: opts.board2 !== undefined,
    communityCards: cards(boardText),
    ...(opts.board2 ? { communityCards2: cards(opts.board2) } : {}),
    players: [hero, ...opps],
    actionHistory: history,
  };
  return { hero, gs };
}

function decide(s: Spot, seed: number, extra: HorseDecideOpts = {}) {
  seedFastRandom(seed);
  drainFires();
  const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', undefined, {
    telemetry: true,
    observeMind: false,
    ...extra,
  });
  const next = fastRandom();
  return {
    stable: { action: d.action, amount: d.amount ?? null, thinkTime: d.thinkTime },
    next,
    fires: firesMap(),
    raw: d,
  };
}

describe('LAW: v17PosIsPriced (priced V17 players-behind bluff multiplier)', () => {
  beforeEach(() => {
    HorseMind.reset();
    _clearGtoPostflop();
    _clearGtoPostflopV31();
    enableBrainTelemetry();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  describe('the pure module', () => {
    it('draws no random number, imports nothing from opponentHud/ and reads no opponent cards', () => {
      const src = readFileSync(
        join(REPO, 'server/src/engine/HorsePlayersBehindBluffPriced.ts'),
        'utf8'
      );
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      expect(code).not.toMatch(/\bfastRandom\s*\(/);
      expect(code).not.toMatch(/Math\.random/);
      expect(code).not.toMatch(/opponentHud\//);
      expect(code).not.toMatch(/\.cards\b/);
      const input = pureInput('flop', 3, 3);
      seedFastRandom(99);
      const before = fastRandom();
      seedFastRandom(99);
      const a = pricePlayersBehindBluff(input);
      const b = pricePlayersBehindBluff(input);
      expect(fastRandom()).toBe(before);
      expect(a).toEqual(b);
    });

    it('places hero and the field exactly as HorseLogic playersBehind17 does', () => {
      for (const [opp, behind] of [
        [1, 0],
        [1, 1],
        [3, 0],
        [3, 1],
        [3, 2],
        [3, 3],
        [5, 4],
      ] as const) {
        const input = pureInput('flop', opp, behind);
        expect(behindCount(input)).toBe(behind);
        expect(pricePlayersBehindBluff(input)?.playersBehind).toBe(behind);
      }
    });

    it('is exactly 1 with zero or one player behind', () => {
      for (const street of ['flop', 'turn'] as const) {
        for (const [opp, behind] of [
          [1, 0],
          [1, 1],
          [2, 0],
          [2, 1],
          [4, 1],
        ] as const) {
          expect(pricePlayersBehindBluff(pureInput(street, opp, behind))?.multiplier).toBe(1);
        }
      }
    });

    it('prices strangers on the measured medium-size cells (flop and turn)', () => {
      const flop3 = pricePlayersBehindBluff(pureInput('flop', 3, 3))!;
      expect(flop3.band).toBe('medium');
      expect(flop3.sizeFrac).toBeCloseTo(PLAYERS_BEHIND_REFERENCE_SIZE, 12);
      // unpaired non-monotone flop: texture multiplier 1.
      expect(HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT.unpaired_nonmono.mult).toBe(1);
      expect(flop3.fieldFold).toBeCloseTo(FLOP_OOP ** 3, 12);
      expect(flop3.referenceFold).toBeCloseTo(FLOP_OOP * FLOP_IP ** 2, 12);
      // The field is far below the price: the trim is the measured seat ratio, squared.
      expect(flop3.multiplier).toBeCloseTo((FLOP_OOP / FLOP_IP) ** 2, 12);

      const flop2of3 = pricePlayersBehindBluff(pureInput('flop', 3, 2))!;
      expect(flop2of3.multiplier).toBeCloseTo(FLOP_OOP / FLOP_IP, 12);

      const turn3 = pricePlayersBehindBluff(pureInput('turn', 3, 3))!;
      expect(turn3.multiplier).toBeCloseTo((TURN_OOP / TURN_IP) ** 2, 12);
      expect(FLOP_OOP / FLOP_IP).toBeCloseTo(0.6903, 3);
      expect(TURN_OOP / TURN_IP).toBeCloseTo(0.8263, 3);
    });

    it('never rises with more players behind', () => {
      for (const street of ['flop', 'turn'] as const) {
        let prev = Infinity;
        for (let behind = 0; behind <= 5; behind++) {
          const m = pricePlayersBehindBluff(pureInput(street, 5, behind))!.multiplier;
          expect(m).toBeLessThanOrEqual(prev + 1e-12);
          expect(m).toBeGreaterThan(0);
          expect(m).toBeLessThanOrEqual(1);
          prev = m;
        }
      }
    });

    it('does not trim a field that still beats the risk-adjusted price', () => {
      const folder = { hit: 1000, opp: 1000 };
      const input = pureInput('flop', 2, 2);
      const p = pricePlayersBehindBluff({
        ...input,
        opponents: input.opponents.map((o) => ({ ...o, foldToBet: folder })),
      })!;
      expect(p.fieldFold).toBeGreaterThanOrEqual(p.breakEvenFold);
      expect(p.multiplier).toBe(1);
    });

    it('a measured over-folder never lowers it and a calling station never raises it', () => {
      for (const street of ['flop', 'turn'] as const) {
        for (const behind of [2, 3, 4]) {
          const base = pureInput(street, 4, behind);
          const stranger = pricePlayersBehindBluff(base)!.multiplier;
          const withRead = (hit: number, opp: number) =>
            pricePlayersBehindBluff({
              ...base,
              opponents: base.opponents.map((o) => ({ ...o, foldToBet: { hit, opp } })),
            })!.multiplier;
          expect(withRead(60, 60)).toBeGreaterThanOrEqual(stranger - 1e-12);
          expect(withRead(0, 60)).toBeLessThanOrEqual(stranger + 1e-12);
        }
      }
    });

    it('a bubble factor never raises it', () => {
      const folder = { hit: 40, opp: 60 };
      for (const behind of [2, 3]) {
        const base = pureInput('flop', 3, behind);
        const withBf = (bf: number) =>
          pricePlayersBehindBluff({
            ...base,
            heroBubbleFactor: bf,
            opponents: base.opponents.map((o) => ({ ...o, foldToBet: folder })),
          })!;
        let prev = Infinity;
        for (const bf of [1, 1.3, 2, 3.5, 5]) {
          const p = withBf(bf);
          expect(p.bubbleFactor).toBe(bf);
          expect(p.breakEvenFold).toBeCloseTo((bf * p.sizeFrac) / (1 + bf * p.sizeFrac), 12);
          expect(p.multiplier).toBeLessThanOrEqual(prev + 1e-12);
          prev = p.multiplier;
        }
      }
    });

    it('reads the flop texture from the board and caps size at the effective stack', () => {
      expect(playersBehindFlopTexture(cards('Kh9d4c'))).toBe('unpaired_nonmono');
      expect(playersBehindFlopTexture(cards('KhKd4c'))).toBe('paired');
      expect(playersBehindFlopTexture(cards('Kh9h4h'))).toBe('mono');
      const short = pricePlayersBehindBluff({
        ...pureInput('flop', 3, 3),
        heroStack: 20,
      })!;
      expect(short.sizeFrac).toBeCloseTo(0.2, 12);
      expect(short.band).toBe('small');
      const small = HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET;
      expect(short.multiplier).toBeCloseTo((small.oop.small.rate / small.ip.small.rate) ** 2, 12);
    });

    it('is label-neutral: the same counters give the same price for any seat holder', () => {
      const read = { hit: 30, opp: 50 };
      const a = pureInput('turn', 3, 3);
      const p1 = pricePlayersBehindBluff({
        ...a,
        opponents: a.opponents.map((o) => ({ ...o, foldToBet: read })),
      });
      const p2 = pricePlayersBehindBluff({
        ...a,
        opponents: [...a.opponents].reverse().map((o, i) => ({
          ...o,
          seat: a.opponents[i]!.seat,
          foldToBet: read,
        })),
      });
      expect(p2).toEqual(p1);
    });

    it('refuses unpriceable input instead of guessing', () => {
      const base = pureInput('flop', 3, 3);
      expect(pricePlayersBehindBluff({ ...base, opponents: [] })).toBeNull();
      expect(pricePlayersBehindBluff({ ...base, pot: 0 })).toBeNull();
      expect(pricePlayersBehindBluff({ ...base, heroStack: 0 })).toBeNull();
      expect(pricePlayersBehindBluff({ ...base, dealerSeat: Number.NaN })).toBeNull();
      expect(pricePlayersBehindBluff({ ...base, street: 'river' as unknown as 'flop' })).toBeNull();
    });
  });

  describe('HorseLogic wiring', () => {
    const SEEDS = [11, 207, 3301, 40441, 90917];

    it('OFF, unset and false are byte-identical (decision, next draw, receipts)', () => {
      const spots = [
        spot({ stage: 'flop', oppCount: 3 }),
        spot({ stage: 'turn', oppCount: 3 }),
        spot({ stage: 'flop', oppCount: 2, heroLast: true }),
        spot({ stage: 'river', oppCount: 3 }),
      ];
      for (const s of spots) {
        for (const seed of SEEDS) {
          const unset = decide(s, seed);
          const off = decide(s, seed, { v17PosIsPriced: false });
          expect(off.stable).toEqual(unset.stable);
          expect(off.next).toBe(unset.next);
          expect(off.fires).toEqual(unset.fires);
          for (const k of Object.keys(unset.fires))
            expect(k.startsWith('v17_pos_priced')).toBe(false);
        }
      }
    });

    it('ON leaves the river, Omaha, Short Deck, Fixed Limit and multi-board byte-identical', () => {
      const spots = [
        spot({ stage: 'river', oppCount: 3 }),
        spot({ variant: 'plo4', stage: 'flop', oppCount: 3 }),
        spot({ variant: 'plo5', stage: 'turn', oppCount: 3, heroHole: 'Jh9h4d3c2s' }),
        spot({ variant: 'short_deck', stage: 'flop', oppCount: 3, board: 'Kd8s7c' }),
        spot({ variant: 'flh', stage: 'flop', oppCount: 3 }),
        spot({ stage: 'flop', oppCount: 3, board2: 'Qh7d6s' }),
      ];
      expect(variantInfo('short_deck').isShortDeck).toBe(true);
      expect(variantInfo('flh').isFixedLimit).toBe(true);
      for (const s of spots) {
        for (const seed of SEEDS) {
          const off = decide(s, seed);
          const on = decide(s, seed, { v17PosIsPriced: true });
          expect(on.stable).toEqual(off.stable);
          expect(on.next).toBe(off.next);
          expect(on.fires).toEqual(off.fires);
        }
      }
    });

    it('ON in NLH flop and turn replaces the fixed table and stays legal', () => {
      let priced = 0;
      for (const stage of ['flop', 'turn'] as const) {
        for (const heroLast of [false, true]) {
          const s = spot({ stage, oppCount: 3, heroLast });
          for (const seed of SEEDS) {
            const on = decide(s, seed, { v17PosIsPriced: true });
            expect(on.fires.v17_pos_behind ?? 0).toBe(0);
            const receipts =
              (on.fires.v17_pos_priced_trim ?? 0) +
              (on.fires.v17_pos_priced_neutral ?? 0) +
              (on.fires.v17_pos_priced_unpriced ?? 0);
            priced += receipts;
            if (heroLast) expect(on.fires.v17_pos_priced_trim ?? 0).toBe(0);
            const state = calculateBettingState(s.gs.pot as number, 0, 0, 2, 2, false);
            expect(validateAction(on.raw.action, on.raw.amount, s.hero.stack, state).valid).toBe(
              true
            );
          }
        }
      }
      expect(priced).toBeGreaterThan(0);
    });

    it('ON, three players behind on the flop: the trim is priced, not the fixed 0.5', () => {
      const s = spot({ stage: 'flop', oppCount: 3 });
      let sawTrim = 0;
      for (const seed of SEEDS) {
        const off = decide(s, seed);
        const on = decide(s, seed, { v17PosIsPriced: true });
        sawTrim += on.fires.v17_pos_priced_trim ?? 0;
        if ((on.fires.v17_pos_priced_trim ?? 0) > 0) {
          expect(off.fires.v17_pos_behind ?? 0).toBeGreaterThan(0);
        }
      }
      expect(sawTrim).toBeGreaterThan(0);
    });
  });

  it('stays dark: OPTION_SWITCH_REFUSED, never in OPTION_SWITCH_NAMES', () => {
    expect(OPTION_SWITCH_REFUSED.v17PosIsPriced).toBeTruthy();
    expect(optionSwitchRefusal('v17PosIsPriced')).not.toBeNull();
    expect((OPTION_SWITCH_NAMES as readonly string[]).includes('v17PosIsPriced')).toBe(false);
  });
});
