/**
 * LAW: THE V17 SHORT DECK MULTIWAY SHIFT IS PRICED WHEN `v17ShortDeckIsPriced` IS ON, AND NOTHING
 * ELSE CHANGES (2026-11-22, HORSE DECISIONS lane).
 *
 * Criteria: CRITERIA-V17-SHORTDECK-PRICED.md (sha256 420f5649922688c9f2fa406be518e6f5fcca67dd00fe9a2afb5d89675df8b73d).
 *
 *   1. OFF (unset, false) is byte-identical, including the next fastRandom() draw and every receipt;
 *      the fixed overlay's receipt `v17_short_deck` still fires there.
 *   2. NLH and PLO4 decisions are byte-identical with the option ON (zero priced receipts).
 *   3. The pure module draws no random number, imports nothing from opponentHud/, and is exact on its
 *      boundaries: e = 0, e = 1 and g = 0 give delta = 0; the river gives delta = 0 (no measured
 *      difference); flop and turn loosen (delta < 0, measured SD continuation is less sharp).
 *   4. The shift is player-dependent: an opponent who folds more to bets moves the shift further; an
 *      all-in opponent has f = 0; an opponent's own record shrinks onto the pool prior (k = 6).
 *   5. Unpriceable input gives delta = 0, never the fixed increment.
 *   6. ON in Short Deck: the fixed overlay's receipt never fires, a priced receipt does, and the
 *      decision is the same under every seed's draw of the priced shift (the shift itself draws none).
 *   7. The option stays in OPTION_SWITCH_REFUSED (zero SQL migrations).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { _clearGtoPostflop } from './GtoPostflop.js';
import { _clearGtoPostflopV31 } from './GtoPostflopV31.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_REFUSED,
  optionSwitchRefusal,
} from './HorseOptionSwitch.js';
import {
  NLH_REFERENCE_CONTINUATION_SHARPNESS,
  SHORT_DECK_CONTINUATION_SHARPNESS,
  SHORT_DECK_FOLD_TO_FIRST_BET,
  priceShortDeckMultiwayShift,
  shortDeckOpponentFoldProb,
} from './HorseShortDeckMultiwayPriced.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

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
  return Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
}

function seat(
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  hole = ''
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
}

const PRICED = [
  'v17_short_deck_priced_tighter',
  'v17_short_deck_priced_looser',
  'v17_short_deck_priced_neutral',
  'v17_short_deck_priced_unpriceable',
] as const;

/** A Short Deck (or other variant) flop or turn spot, three-handed, hero first to act or facing a bet. */
function spot(opts: {
  variant?: 'short_deck' | 'nlh' | 'plo4';
  street?: 'flop' | 'turn' | 'river';
  facing?: boolean;
  heroHole?: string;
}) {
  const variant = opts.variant ?? 'short_deck';
  const street = opts.street ?? 'flop';
  const heroId = 'horse-v17-hero';
  const a = '10000000-0000-4000-8000-0000000017a1';
  const b = '10000000-0000-4000-8000-0000000017b2';
  const heroHole =
    opts.heroHole ?? (variant === 'plo4' ? 'AhKhQdJd' : variant === 'nlh' ? 'AhQd' : 'AhQd');
  const board = street === 'flop' ? 'Qs9h7c' : street === 'turn' ? 'Qs9h7c6d' : 'Qs9h7c6dKc';
  const facing = opts.facing ?? false;
  const hero = seat(3, heroId, 300, 0, 10, heroHole);
  const p1 = seat(1, a, 300, facing ? 15 : 0, 10 + (facing ? 15 : 0));
  const p2 = seat(2, b, 300, 0, 10);
  const gs = {
    handNumber: 917017,
    stage: street,
    pot: 30 + (facing ? 15 : 0),
    currentBet: facing ? 15 : 0,
    minRaise: 2,
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 3,
    gameVariant: variant,
    format: 'cash',
    communityCards: cards(board),
    players: [p1, p2, hero],
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: heroId, action: 'raise', amount: 10 },
      { stage: 'preflop', seat: 1, userId: a, action: 'call', amount: 10 },
      { stage: 'preflop', seat: 2, userId: b, action: 'call', amount: 10 },
      ...(facing ? [{ stage: street, seat: 1, userId: a, action: 'bet', amount: 15 }] : []),
    ],
  };
  return { hero, gs };
}

function stableDecision(d: ReturnType<typeof HorseLogic.decide>) {
  return { action: d.action, amount: d.amount ?? null, thinkTime: d.thinkTime };
}

const ISOLATE: HorseDecideOpts = {
  telemetry: true,
  observeMind: false,
  v38Ev: false,
  v29GtoFlop: false,
  v30GtoTurnRiver: false,
};

describe('LAW: v17ShortDeckIsPriced (priced Short Deck multiway shift)', () => {
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

  describe('pure module', () => {
    it('draws no random number and imports nothing from opponentHud/', () => {
      const raw = readFileSync(
        join(REPO, 'server/src/engine/HorseShortDeckMultiwayPriced.ts'),
        'utf8'
      );
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/\bfastRandom\s*\(/);
      expect(code).not.toMatch(/Math\.random\s*\(/);
      expect(code).not.toMatch(/from\s+['"][^'"]*opponentHud\//);
      seedFastRandom(4242);
      const r1 = priceShortDeckMultiwayShift({
        street: 'flop',
        equity: 0.6,
        opponents: [{ canRespond: true }, { canRespond: true }],
      });
      const next = fastRandom();
      seedFastRandom(4242);
      expect(fastRandom()).toBe(next);
      seedFastRandom(7);
      expect(
        priceShortDeckMultiwayShift({
          street: 'flop',
          equity: 0.6,
          opponents: [{ canRespond: true }, { canRespond: true }],
        })
      ).toEqual(r1);
    });

    it('pins the measured inputs of the criteria', () => {
      expect(SHORT_DECK_CONTINUATION_SHARPNESS).toEqual({
        flop: 0.2396,
        turn: 0.3432,
        river: 0.9415,
      });
      expect(NLH_REFERENCE_CONTINUATION_SHARPNESS).toEqual({
        flop: 0.3151,
        turn: 0.4068,
        river: 0.9415,
      });
      expect(SHORT_DECK_FOLD_TO_FIRST_BET.flop).toMatchObject({ folds: 442, responses: 1280 });
      expect(SHORT_DECK_FOLD_TO_FIRST_BET.turn).toMatchObject({ folds: 514, responses: 1266 });
      expect(SHORT_DECK_FOLD_TO_FIRST_BET.river).toMatchObject({ folds: 423, responses: 785 });
    });

    it('is exact on its boundaries and computes delta = e - e^rho in between', () => {
      const opp = [{ canRespond: true }];
      for (const street of ['flop', 'turn', 'river'] as const) {
        for (const e of [0, 1]) {
          const r = priceShortDeckMultiwayShift({ street, equity: e, opponents: opp });
          expect(r.kind).toBe('priced');
          expect(r.delta).toBe(0);
        }
      }
      const r = priceShortDeckMultiwayShift({ street: 'flop', equity: 0.6, opponents: opp });
      if (r.kind !== 'priced') throw new Error('expected priced');
      const f = SHORT_DECK_FOLD_TO_FIRST_BET.flop.rate;
      const g = f / (1 - f);
      const rho = (1 + 0.2396 * g) / (1 + 0.3151 * g);
      expect(r.meanG).toBeCloseTo(g, 12);
      expect(r.rho).toBeCloseTo(rho, 12);
      expect(r.delta).toBeCloseTo(0.6 - Math.pow(0.6, rho), 12);
    });

    it('loosens on the flop and turn, and is zero on the river (no measured difference)', () => {
      const opp = [{ canRespond: true }, { canRespond: true }];
      for (const e of [0.25, 0.45, 0.65, 0.85]) {
        expect(
          priceShortDeckMultiwayShift({ street: 'flop', equity: e, opponents: opp }).delta
        ).toBeLessThan(0);
        expect(
          priceShortDeckMultiwayShift({ street: 'turn', equity: e, opponents: opp }).delta
        ).toBeLessThan(0);
        expect(
          priceShortDeckMultiwayShift({ street: 'river', equity: e, opponents: opp }).delta
        ).toBe(0);
      }
    });

    it('is player-dependent: more folding moves the shift further; all-in opponents give f = 0; records shrink onto the prior', () => {
      const folder = { canRespond: true, foldToBet: { hits: 45, opportunities: 50 } };
      const sticky = { canRespond: true, foldToBet: { hits: 5, opportunities: 50 } };
      const dFold = priceShortDeckMultiwayShift({
        street: 'turn',
        equity: 0.55,
        opponents: [folder],
      }).delta;
      const dPool = priceShortDeckMultiwayShift({
        street: 'turn',
        equity: 0.55,
        opponents: [{ canRespond: true }],
      }).delta;
      const dSticky = priceShortDeckMultiwayShift({
        street: 'turn',
        equity: 0.55,
        opponents: [sticky],
      }).delta;
      expect(dFold).toBeLessThan(dPool);
      expect(dPool).toBeLessThan(dSticky);
      expect(dSticky).toBeLessThan(0);
      expect(
        shortDeckOpponentFoldProb('flop', {
          canRespond: false,
          foldToBet: { hits: 50, opportunities: 50 },
        })
      ).toBe(0);
      const allIn = priceShortDeckMultiwayShift({
        street: 'flop',
        equity: 0.5,
        opponents: [{ canRespond: false }],
      });
      expect(allIn.delta).toBe(0);
      const prior = SHORT_DECK_FOLD_TO_FIRST_BET.flop.rate;
      expect(shortDeckOpponentFoldProb('flop', { canRespond: true })).toBeCloseTo(prior, 12);
      expect(
        shortDeckOpponentFoldProb('flop', {
          canRespond: true,
          foldToBet: { hits: 6, opportunities: 6 },
        })
      ).toBeCloseTo((6 + 6 * prior) / 12, 12);
    });

    it('unpriceable input gives delta 0, never the fixed increment', () => {
      for (const input of [
        { street: 'preflop', equity: 0.5, opponents: [{ canRespond: true }] },
        { street: 'flop', equity: Number.NaN, opponents: [{ canRespond: true }] },
        { street: 'turn', equity: 0.5, opponents: [] },
      ]) {
        const r = priceShortDeckMultiwayShift(input);
        expect(r.kind).toBe('unpriceable');
        expect(r.delta).toBe(0);
      }
    });
  });

  describe('end to end (HorseLogic.decide)', () => {
    it('OFF (unset, false) is byte-identical including the next draw, and the fixed overlay still fires', () => {
      for (const facing of [false, true]) {
        const { hero, gs } = spot({ facing });
        for (const seed of [1, 7, 42, 101]) {
          seedFastRandom(seed);
          const unset = HorseLogic.decide(hero, gs as never, 'balanced', undefined, { ...ISOLATE });
          const rngUnset = fastRandom();
          const firesUnset = firesMap();
          seedFastRandom(seed);
          const off = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            ...ISOLATE,
            v17ShortDeckIsPriced: false,
          });
          const rngOff = fastRandom();
          const firesOff = firesMap();
          expect(stableDecision(off)).toEqual(stableDecision(unset));
          expect(rngOff).toBe(rngUnset);
          expect(firesOff).toEqual(firesUnset);
          expect(firesOff['v17_short_deck']).toBeGreaterThan(0);
          for (const k of PRICED) expect(firesOff[k]).toBeUndefined();
        }
      }
    });

    it.each(['nlh', 'plo4'] as const)('%s is byte-identical with the option ON', (variant) => {
      for (const facing of [false, true]) {
        const { hero, gs } = spot({ variant, facing });
        // Warm the once-per-process caches (e.g. the Omaha reservoir and its one-time receipt) so
        // both arms see the same process state.
        seedFastRandom(99);
        HorseLogic.decide(hero, gs as never, 'balanced', undefined, { ...ISOLATE });
        drainFires();
        for (const seed of [1, 7, 42]) {
          seedFastRandom(seed);
          const off = HorseLogic.decide(hero, gs as never, 'balanced', undefined, { ...ISOLATE });
          const rngOff = fastRandom();
          const firesOff = firesMap();
          seedFastRandom(seed);
          const on = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            ...ISOLATE,
            v17ShortDeckIsPriced: true,
          });
          const rngOn = fastRandom();
          const firesOn = firesMap();
          expect(stableDecision(on)).toEqual(stableDecision(off));
          expect(rngOn).toBe(rngOff);
          expect(firesOn).toEqual(firesOff);
          for (const k of PRICED) expect(firesOn[k]).toBeUndefined();
        }
      }
    });

    it('ON in Short Deck replaces the fixed overlay with a priced receipt, on every street', () => {
      for (const street of ['flop', 'turn', 'river'] as const) {
        for (const facing of [false, true]) {
          const { hero, gs } = spot({ street, facing });
          seedFastRandom(17);
          HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            ...ISOLATE,
            v17ShortDeckIsPriced: true,
          });
          const fires = firesMap();
          expect(fires['v17_short_deck']).toBeUndefined();
          const priced = PRICED.reduce((n, k) => n + (fires[k] ?? 0), 0);
          expect(priced).toBeGreaterThan(0);
          expect(fires['v17_short_deck_priced_unpriceable']).toBeUndefined();
          if (street === 'river') expect(fires['v17_short_deck_priced_tighter']).toBeUndefined();
        }
      }
    });

    it('classifies the shift by its sign: river (zero, no measured difference) is neutral, a typical flop or turn equity is looser, never tighter', () => {
      for (const street of ['flop', 'turn', 'river'] as const) {
        for (const facing of [false, true]) {
          const { hero, gs } = spot({ street, facing });
          seedFastRandom(17);
          HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            ...ISOLATE,
            v17ShortDeckIsPriced: true,
          });
          const fires = firesMap();
          expect(fires['v17_short_deck_priced_tighter']).toBeUndefined();
          if (street === 'river') {
            expect(fires['v17_short_deck_priced_neutral']).toBeGreaterThan(0);
            expect(fires['v17_short_deck_priced_looser']).toBeUndefined();
          } else {
            expect(fires['v17_short_deck_priced_looser']).toBeGreaterThan(0);
            expect(fires['v17_short_deck_priced_neutral']).toBeUndefined();
          }
        }
      }
    });

    it('ON also replaces the overlay when the fixed overlay is switched off (v17ShortDeck: false)', () => {
      const { hero, gs } = spot({ street: 'turn' });
      seedFastRandom(3);
      HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
        ...ISOLATE,
        v17ShortDeck: false,
        v17ShortDeckIsPriced: true,
      });
      const fires = firesMap();
      expect(fires['v17_short_deck']).toBeUndefined();
      expect(PRICED.reduce((n, k) => n + (fires[k] ?? 0), 0)).toBeGreaterThan(0);
    });
  });

  describe('governance', () => {
    it('keeps v17ShortDeckIsPriced refused and out of the SQL switch', () => {
      expect(Object.hasOwn(OPTION_SWITCH_REFUSED, 'v17ShortDeckIsPriced')).toBe(true);
      expect(optionSwitchRefusal('v17ShortDeckIsPriced')).toBeTruthy();
      expect(OPTION_SWITCH_NAMES).not.toContain('v17ShortDeckIsPriced');
    });
  });
});
