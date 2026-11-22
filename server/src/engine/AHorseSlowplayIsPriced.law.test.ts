/**
 * LAW: H4 MONSTER SLOWPLAY MIX IS PRICED DETERMINISTICALLY WHEN `horseSlowplayIsPriced` IS ON,
 * AND BYTE-IDENTICAL WHEN OFF OR OUTSIDE NON-OMAHA / NON-FIXED-LIMIT SCOPE (2026-11-22).
 *
 * Criteria: CRITERIA-H4-SLOWPLAY-PRICED.md (HORSE DECISIONS lane).
 *
 * Invariants proven here:
 *   1. OFF / unset / false is 100% byte-identical to origin/main, including exact `fastRandom()`
 *      consumption and next-draw RNG state.
 *   2. Omaha (`plo4`, `plo5`, `plo6`) and Fixed-Limit (`flh`) are 100% untouched even when
 *      `horseSlowplayIsPriced: true` (identical action, amount, RNG state, zero slowplay-priced
 *      receipts).
 *   3. Pure pricing module `HorseSlowplayPriced.ts` is deterministic (zero `fastRandom()` draw),
 *      public-info-only (zero opponent hole cards, zero `opponentHud/` import), and satisfies
 *      monotonicity:
 *        - higher opponent fold-to-bet rate `F` favors check (raises `evCheck - evBet`);
 *        - higher opponent `betWhenCheckedTo` rate `B` favors check (raises `evCheck - evBet`);
 *        - drier board (lower `wetness`) reduces `freeCardPenalty` and favors check; higher
 *          `wetness` favors bet continuously across `0.5` with no hard cliff;
 *        - multiway (`oppCount = 2`) multiplies fold probabilities (`F_1 * F_2`) and increases
 *          `freeCardPenalty`, favoring bet;
 *        - tournament `heroBubbleFactor > 1` scales the `(1 - e) * wager` loss side while
 *          `bf = 1` reduces identically to `e * (P + 2 * w) - w`.
 *   4. End-to-end `HorseLogic.decide` with `horseSlowplayIsPriced: true` is deterministic across
 *      RNG seeds on the check-vs-bet decision and emits `horse_slowplay_priced_checked` on a
 *      priced slowplay check and `horse_slowplay_priced_bet` on a priced value bet.
 *   5. `horseSlowplayIsPriced` stays strictly dark in `OPTION_SWITCH_REFUSED` (never registered
 *      in `OPTION_SWITCH_NAMES`, zero SQL migrations).
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
import { freshExploitCounters } from './HorseOpponentExploit.js';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_REFUSED,
  optionSwitchRefusal,
} from './HorseOptionSwitch.js';
import {
  classifyHoldemFlopTexture,
  freeCardPenalty,
  priceMonsterSlowplay,
  riskAdjustedCallUtility,
  type PriceMonsterSlowplayInput,
  type SlowplayOpponentInput,
} from './HorseSlowplayPriced.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const SUITS: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

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
  hole = '',
  folded = false
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: hole ? cards(hole) : [],
    is_folded: folded,
    is_all_in: false,
    is_sitting_out: false,
  };
}

function monsterFlopState(opts: {
  variant?: 'nlh' | 'plo4' | 'plo5' | 'plo6' | 'flh';
  heroHole?: string;
  board?: string;
  oppId?: string;
  pot?: number;
  stack?: number;
  street?: 'flop' | 'turn';
}) {
  const variant = opts.variant ?? 'nlh';
  const heroId = 'horse-h4-hero';
  const oppId = opts.oppId ?? '10000000-0000-4000-8000-0000000000a1';
  const pot = opts.pot ?? 60;
  const stack = opts.stack ?? 400;
  const street = opts.street ?? 'flop';
  const heroHole =
    opts.heroHole ??
    (variant === 'plo4'
      ? 'KhKdAsQc'
      : variant === 'plo5'
        ? 'KhKdAsQcJc'
        : variant === 'plo6'
          ? 'KhKdAsQcJcTs'
          : 'KhKd');
  const boardStr = opts.board ?? (street === 'turn' ? 'Ks7d2c2h' : 'Ks7d2c');
  const hero = seat(2, heroId, stack, 0, 30, heroHole);
  const opp = seat(1, oppId, stack, 0, 30);
  const gs = {
    handNumber: 777101,
    stage: street,
    pot,
    currentBet: 0,
    minRaise: 2,
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 2,
    gameVariant: variant,
    format: 'cash',
    communityCards: cards(boardStr),
    players: [opp, hero],
    actionHistory: [
      { stage: 'preflop', seat: 2, userId: heroId, action: 'raise', amount: 6 },
      { stage: 'preflop', seat: 1, userId: oppId, action: 'call', amount: 6 },
      { stage: 'flop', seat: 1, userId: oppId, action: 'check', amount: 0 },
      ...(street === 'turn'
        ? [
            { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0 },
            { stage: 'turn', seat: 1, userId: oppId, action: 'check', amount: 0 },
          ]
        : []),
    ],
  };
  return { hero, opp, oppId, gs };
}

function stableDecision(d: ReturnType<typeof HorseLogic.decide>) {
  return {
    action: d.action,
    amount: d.amount ?? null,
    thinkTime: d.thinkTime,
    continuationGuard: d.continuationGuard ?? null,
  };
}

describe('LAW: horseSlowplayIsPriced (H4 Monster Slowplay Mix Priced Replacement)', () => {
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

  describe('pure pricing invariants & public-info discipline', () => {
    const baseInput: PriceMonsterSlowplayInput = {
      equity: 0.92,
      pot: 100,
      candidateBet: 80,
      effectiveStack: 400,
      oppCount: 1,
      wetness: 0.12,
      street: 'flop',
      inPosition: true,
      spr: 4,
      flopTexture: 'unpaired_nonmono',
      heroBubbleFactor: 1,
    };

    it('contains zero fastRandom calls and zero opponentHud imports', () => {
      const raw = readFileSync(join(REPO, 'server/src/engine/HorseSlowplayPriced.ts'), 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/\bfastRandom\s*\(/);
      expect(code).not.toMatch(/from\s+['"][^'"]*opponentHud\//);
    });

    it('is 100% deterministic and never consumes fastRandom()', () => {
      seedFastRandom(12345);
      const r1 = priceMonsterSlowplay(baseInput);
      const nextAfter1 = fastRandom();

      seedFastRandom(12345);
      const nextWithoutCall = fastRandom();
      expect(nextAfter1).toBe(nextWithoutCall);

      seedFastRandom(999999);
      const r2 = priceMonsterSlowplay(baseInput);
      expect(r2).toEqual(r1);
    });

    it('riskAdjustedCallUtility reduces identically to e*(P+2w)-w at bf=1 and scales the loss side when bf>1', () => {
      const e = 0.85;
      const p = 100;
      const w = 75;
      expect(riskAdjustedCallUtility(e, p, w, 1)).toBeCloseTo(e * (p + 2 * w) - w, 10);
      const u1 = riskAdjustedCallUtility(e, p, w, 1);
      const u15 = riskAdjustedCallUtility(e, p, w, 1.5);
      const u2 = riskAdjustedCallUtility(e, p, w, 2.0);
      expect(u15).toBeLessThan(u1);
      expect(u2).toBeLessThan(u15);
      expect(u1 - u15).toBeCloseTo((1 - e) * 0.5 * w, 10);
    });

    it('higher opponent fold rate favors check; lower fold rate favors bet', () => {
      const sticky = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 6], 'f.betCk': [40, 26] } } }],
      });
      const folder = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 36], 'f.betCk': [40, 26] } } }],
      });
      expect(folder.foldProb).toBeGreaterThan(sticky.foldProb);
      expect(folder.evCheck - folder.evBet).toBeGreaterThan(sticky.evCheck - sticky.evBet);
      expect(sticky.action).toBe('bet');
      expect(folder.action).toBe('check');
      expect(folder.reason).toBe('ev_check_exceeds_ev_bet');
      expect(sticky.reason).toBe('ev_bet_exceeds_or_equals_ev_check');
    });

    it('higher opponent betWhenCheckedTo favors check; lower betWhenCheckedTo favors bet', () => {
      const passive = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 34], 'f.betCk': [40, 4] } } }],
      });
      const stabber = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 34], 'f.betCk': [40, 34] } } }],
      });
      expect(stabber.stabProb).toBeGreaterThan(passive.stabProb);
      expect(stabber.evCheck - stabber.evBet).toBeGreaterThan(passive.evCheck - passive.evBet);
      expect(passive.action).toBe('bet');
      expect(stabber.action).toBe('check');
    });

    it('wetness continuously increases freeCardPenalty and favors betting with no cliff at 0.5', () => {
      const w49 = freeCardPenalty(0.49, 1, 'flop');
      const w51 = freeCardPenalty(0.51, 1, 'flop');
      expect(w51).toBeGreaterThan(w49);
      expect(w51 - w49).toBeLessThan(0.005);

      const opp: SlowplayOpponentInput = {
        hudOpp: { eff: { 'f.fb.bg.hu': [40, 34], 'f.betCk': [40, 28] } },
      };
      const dry = priceMonsterSlowplay({ ...baseInput, wetness: 0.1, opponents: [opp] });
      const wet = priceMonsterSlowplay({ ...baseInput, wetness: 0.85, opponents: [opp] });
      expect(dry.freeCardEquity).toBeGreaterThan(wet.freeCardEquity);
      expect(dry.evCheck - dry.evBet).toBeGreaterThan(wet.evCheck - wet.evBet);
      expect(dry.action).toBe('check');
      expect(wet.action).toBe('bet');
    });

    it('multiway multiplies fold probabilities and increases free-card penalty, favoring bet', () => {
      const opp: SlowplayOpponentInput = {
        hudOpp: {
          eff: { 'f.fb.bg.hu': [40, 32], 'f.fb.bg.mw': [40, 32], 'f.betCk': [40, 24] },
        },
      };
      const hu = priceMonsterSlowplay({ ...baseInput, oppCount: 1, opponents: [opp] });
      const mw = priceMonsterSlowplay({ ...baseInput, oppCount: 2, opponents: [opp, opp] });
      expect(mw.foldProb).toBeCloseTo(hu.foldProb * hu.foldProb, 6);
      expect(mw.freeCardEquity).toBeLessThan(hu.freeCardEquity);
      expect(mw.evBet - mw.evCheck).toBeGreaterThan(hu.evBet - hu.evCheck);
      expect(mw.action).toBe('bet');
    });

    it('bubble factor scales the losing branch and shifts borderline risk spots toward pot control', () => {
      const spot: PriceMonsterSlowplayInput = {
        ...baseInput,
        equity: 0.84,
        candidateBet: 120,
        wetness: 0.05,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 14], 'f.betCk': [40, 12] } } }],
      };
      const cash = priceMonsterSlowplay({ ...spot, heroBubbleFactor: 1.0 });
      const bubble = priceMonsterSlowplay({ ...spot, heroBubbleFactor: 2.2 });
      expect(bubble.bubbleFactor).toBe(2.2);
      // With a larger bet than stab and low fold rate, bubble pressure hurts EV(bet) more than EV(check).
      expect(bubble.evCheck - bubble.evBet).toBeGreaterThan(cash.evCheck - cash.evBet);
    });

    it('handles degenerate pot/stack safely and classifies public flop textures', () => {
      expect(priceMonsterSlowplay({ ...baseInput, pot: 0 }).reason).toBe('degenerate_pot_or_stack');
      expect(priceMonsterSlowplay({ ...baseInput, effectiveStack: 0 }).reason).toBe(
        'degenerate_pot_or_stack'
      );
      expect(classifyHoldemFlopTexture(cards('Ks7s2s'))).toBe('mono');
      expect(classifyHoldemFlopTexture(cards('KsKd2c'))).toBe('paired');
      expect(classifyHoldemFlopTexture(cards('Ks7d2c'))).toBe('unpaired_nonmono');
    });
  });

  describe('end-to-end HorseLogic.decide scope, OFF-identity, determinism, and receipts', () => {
    it('OFF (unset and false) is 100% byte-identical including exact fastRandom() sequence', () => {
      const { hero, gs } = monsterFlopState({ variant: 'nlh' });
      for (const seed of [1, 7, 42, 101, 555]) {
        seedFastRandom(seed);
        const unsetDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
          telemetry: true,
        });
        const rngAfterUnset = fastRandom();
        const firesUnset = firesMap();

        seedFastRandom(seed);
        const falseDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
          telemetry: true,
          horseSlowplayIsPriced: false,
        });
        const rngAfterFalse = fastRandom();
        const firesFalse = firesMap();

        expect(stableDecision(falseDec)).toEqual(stableDecision(unsetDec));
        expect(rngAfterFalse).toBe(rngAfterUnset);
        expect(firesFalse).toEqual(firesUnset);
        expect(firesFalse['horse_slowplay_priced_checked']).toBeUndefined();
        expect(firesFalse['horse_slowplay_priced_bet']).toBeUndefined();
      }
    });

    it.each(['plo4', 'plo5', 'plo6', 'flh'] as const)(
      '%s is 100% untouched even when horseSlowplayIsPriced: true (including RNG sequence and zero receipts)',
      (variant) => {
        const { hero, gs } = monsterFlopState({ variant });
        for (const seed of [1, 7, 42]) {
          seedFastRandom(seed);
          const offDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            telemetry: true,
            horseSlowplayIsPriced: false,
          });
          const rngOff = fastRandom();
          drainFires();

          seedFastRandom(seed);
          const onDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            telemetry: true,
            horseSlowplayIsPriced: true,
          });
          const rngOn = fastRandom();
          const firesOn = firesMap();

          expect(stableDecision(onDec)).toEqual(stableDecision(offDec));
          expect(rngOn).toBe(rngOff);
          expect(firesOn['horse_slowplay_priced_checked']).toBeUndefined();
          expect(firesOn['horse_slowplay_priced_bet']).toBeUndefined();
        }
      }
    );

    it('fires horse_slowplay_priced_checked deterministically against a high-fold high-stab opponent and horse_slowplay_priced_bet against a sticky passive opponent', () => {
      const oppTrapId = '10000000-0000-4000-8000-0000000000b1';
      const oppValueId = '10000000-0000-4000-8000-0000000000b2';
      HorseMind.importDurableOpponentProfiles([
        {
          user_id: oppTrapId,
          variant: 'nlh',
          mode: 'cash',
          size: 'hu',
          observed_hands: 80,
          initialized: true,
          counters: {
            ...freshExploitCounters(),
            hands: 80,
            vpip: 40,
            pfr: 24,
            foldToBetOpp: 60,
            foldToBet: 55,
            betCheckedToOpp: 60,
            betCheckedTo: 54,
          },
        },
        {
          user_id: oppValueId,
          variant: 'nlh',
          mode: 'cash',
          size: 'hu',
          observed_hands: 80,
          initialized: true,
          counters: {
            ...freshExploitCounters(),
            hands: 80,
            vpip: 60,
            pfr: 10,
            foldToBetOpp: 60,
            foldToBet: 6,
            betCheckedToOpp: 60,
            betCheckedTo: 6,
          },
        },
      ]);

      const commonOpts: HorseDecideOpts = {
        telemetry: true,
        observeMind: false,
        v38Ev: false,
        v29GtoFlop: false,
        v30GtoTurnRiver: false,
        horseSlowplayIsPriced: true,
      };

      const trapSpot = monsterFlopState({
        variant: 'nlh',
        street: 'turn',
        heroHole: '7h7c',
        board: 'Ks7d2c9h',
        oppId: oppTrapId,
      });
      for (const seed of [1, 7, 42, 99]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          trapSpot.hero,
          trapSpot.gs as never,
          'balanced',
          undefined,
          commonOpts
        );
        const fires = firesMap();
        expect(dec.action).toBe('check');
        expect(fires['horse_slowplay_priced_checked']).toBe(1);
        expect(fires['horse_slowplay_priced_bet']).toBeUndefined();
      }

      const valueSpot = monsterFlopState({
        variant: 'nlh',
        street: 'turn',
        heroHole: '7h7c',
        board: 'Ks7d2c9h',
        oppId: oppValueId,
      });
      for (const seed of [1, 7, 42, 99]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          valueSpot.hero,
          valueSpot.gs as never,
          'balanced',
          undefined,
          commonOpts
        );
        const fires = firesMap();
        expect(['bet', 'all_in']).toContain(dec.action);
        expect(fires['horse_slowplay_priced_bet']).toBe(1);
        expect(fires['horse_slowplay_priced_checked']).toBeUndefined();
      }
    });
  });

  describe('3-way all-in opponent handling (audit Finding #6)', () => {
    it('treats an all-in opponent (canRespond=false) as never folding and never stabbing', () => {
      const base = {
        equity: 0.9,
        pot: 200,
        candidateBet: 120,
        effectiveStack: 400,
        oppCount: 2,
        wetness: 0.1,
        street: 'flop' as const,
        inPosition: false,
        flopTexture: 'unpaired_nonmono' as const,
        spr: 2,
        bubbleFactor: 1,
      };
      const livePassive = {
        canRespond: true,
        exploitCounters: {
          foldToBet: 45,
          foldToBetOpp: 50,
          betCheckedTo: 2,
          betCheckedToOpp: 50,
        },
      };
      const allInAggro = {
        canRespond: false,
        exploitCounters: {
          foldToBet: 45,
          foldToBetOpp: 50,
          betCheckedTo: 48,
          betCheckedToOpp: 50,
        },
      };
      const withAllIn = priceMonsterSlowplay({
        ...base,
        opponents: [livePassive, allInAggro],
      });
      const allInNoCounters = priceMonsterSlowplay({
        ...base,
        opponents: [livePassive, { canRespond: false }],
      });
      // An all-in seat cannot fold (so hero cannot take the pot uncontested: foldProb === 0)
      expect(withAllIn.foldProb).toBe(0);
      // An all-in seat cannot stab when checked to, so its historical betCheckedTo never inflates stabProb
      expect(withAllIn.stabProb).toBeCloseTo(allInNoCounters.stabProb, 10);
      expect(withAllIn.stabProb).toBeLessThan(0.25);
    });
  });

  describe('zero-migration OPTION_SWITCH_REFUSED governance', () => {
    it('keeps horseSlowplayIsPriced refused and unregistered in the SQL switch', () => {
      expect(Object.hasOwn(OPTION_SWITCH_REFUSED, 'horseSlowplayIsPriced')).toBe(true);
      expect(optionSwitchRefusal('horseSlowplayIsPriced')).toBeTruthy();
      expect(OPTION_SWITCH_NAMES).not.toContain('horseSlowplayIsPriced');
    });
  });
});
