/**
 * LAW: H4 MONSTER SLOWPLAY MIX IS PRICED DETERMINISTICALLY WHEN `horseSlowplayIsPriced` IS ON,
 * AND BYTE-IDENTICAL WHEN OFF OR OUTSIDE NON-OMAHA / NON-FIXED-LIMIT SCOPE (2026-11-22).
 *
 * Criteria: CRITERIA-H4-SLOWPLAY-PRICED.md (HORSE DECISIONS lane); r2 (measured inputs):
 * CRITERIA-H4-SLOWPLAY-PRICED-R2.md.
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
 *        - r2: no free-card constant (board wetness is not priced; the check branch uses the raw
 *          equity), the called branch uses the equity against the continuing range
 *          `e ^ (1 + kappa * F / (1 - F))` with the measured NLH `kappa` (non-increasing in `F`), and
 *          the stab size is the measured per-street mean pot fraction, pinned with its provenance;
 *        - multiway (`oppCount = 2`) multiplies fold probabilities (`F_1 * F_2`);
 *        - r2b: in position (last to act, no bet faced) a check closes the street, so the stab
 *          probability is 0 and `EV(check) = e * P` exactly; out of position is unchanged from r2;
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
import { NLH_REFERENCE_CONTINUATION_SHARPNESS } from './HorseShortDeckMultiwayPriced.js';
import {
  classifyHoldemFlopTexture,
  priceMonsterSlowplay,
  riskAdjustedCallUtility,
  slowplayCalledEquity,
  SLOWPLAY_MEASURED_STAB_POT_FRAC,
  SLOWPLAY_PRICED_PROVENANCE,
  type PriceMonsterSlowplayInput,
  type SlowplayOpponentInput,
} from './HorseSlowplayPriced.js';
import { conditionEquityAgainstRaiseCallRange } from './holdemEmpiricalPriors.js';
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
  /** r2b: hero out of position (the opponent has the button and acts after the hero postflop). */
  heroOop?: boolean;
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
    dealerSeat: opts.heroOop ? 1 : 2,
    gameVariant: variant,
    format: 'cash',
    communityCards: cards(boardStr),
    players: [opp, hero],
    actionHistory: opts.heroOop
      ? [
          { stage: 'preflop', seat: 1, userId: oppId, action: 'raise', amount: 6 },
          { stage: 'preflop', seat: 2, userId: heroId, action: 'call', amount: 6 },
          ...(street === 'turn'
            ? [
                { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0 },
                { stage: 'flop', seat: 1, userId: oppId, action: 'check', amount: 0 },
              ]
            : []),
        ]
      : [
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
      // Out of position: an opponent still acts after a check, so a stab can come (r2b).
      inPosition: false,
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

    it('pins its measured inputs with provenance: stab size per street and the NLH continuation sharpness', () => {
      expect(SLOWPLAY_MEASURED_STAB_POT_FRAC).toEqual({ flop: 0.5009, turn: 0.6185 });
      expect(Object.isFrozen(SLOWPLAY_MEASURED_STAB_POT_FRAC)).toBe(true);
      expect(Object.isFrozen(SLOWPLAY_PRICED_PROVENANCE)).toBe(true);
      expect(SLOWPLAY_PRICED_PROVENANCE.criteria).toContain(
        '3178e72583229b197c3add048da6fbc7c8302cf12b8e3e7a9f224c4fe9fafe71'
      );
      expect(SLOWPLAY_PRICED_PROVENANCE.stabSize).toContain("game_variant = 'nlh'");
      expect(SLOWPLAY_PRICED_PROVENANCE.stabSize).toContain('statistic = mean');
      expect(SLOWPLAY_PRICED_PROVENANCE.stabSizeQuery).toContain(
        'dbbaa97bf5f8363b53c50d9da9433524f081eb9b8737a3101e8509ab9d1c04f0'
      );
      expect(SLOWPLAY_PRICED_PROVENANCE.stabSizeSample).toContain('mean 0.5009');
      expect(SLOWPLAY_PRICED_PROVENANCE.stabSizeSample).toContain('mean 0.6185');
      expect(NLH_REFERENCE_CONTINUATION_SHARPNESS.flop).toBe(0.3151);
      expect(NLH_REFERENCE_CONTINUATION_SHARPNESS.turn).toBe(0.4068);

      for (const street of ['flop', 'turn'] as const) {
        const r = priceMonsterSlowplay({ ...baseInput, street, pot: 100, effectiveStack: 400 });
        expect(r.stabSize).toBeCloseTo(SLOWPLAY_MEASURED_STAB_POT_FRAC[street] * 100, 10);
        // capped by the effective stack
        const capped = priceMonsterSlowplay({ ...baseInput, street, pot: 100, effectiveStack: 20 });
        expect(capped.stabSize).toBe(20);
      }
    });

    it('carries no free-card constant: wetness is not priced and the check branch uses the raw equity', () => {
      const raw = readFileSync(join(REPO, 'server/src/engine/HorseSlowplayPriced.ts'), 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/freeCardPenalty|freeCardEquity|SLOWPLAY_STAB_POT_FRAC\b/);
      expect(code).not.toMatch(/\b0\.55\b/);

      const opp: SlowplayOpponentInput = {
        hudOpp: { eff: { 'f.fb.bg.hu': [40, 34], 'f.betCk': [40, 28] } },
      };
      const dry = priceMonsterSlowplay({ ...baseInput, wetness: 0.1, opponents: [opp] });
      const wet = priceMonsterSlowplay({ ...baseInput, wetness: 0.85, opponents: [opp] });
      const none = priceMonsterSlowplay({ ...baseInput, wetness: undefined, opponents: [opp] });
      expect(wet).toEqual(dry);
      expect(none).toEqual(dry);
      expect(dry.checkEquity).toBe(baseInput.equity);
      // EV(check) = B * U(e, P, s, 1) + (1 - B) * e * P with the raw equity
      expect(dry.evCheck).toBeCloseTo(
        dry.stabProb * riskAdjustedCallUtility(0.92, 100, dry.stabSize, 1) +
          (1 - dry.stabProb) * 0.92 * 100,
        10
      );
    });

    it('conditions the called equity on the continuing range: e^(1 + kappa * meanG), measured kappa, non-increasing in meanG', () => {
      for (const street of ['flop', 'turn'] as const) {
        expect(slowplayCalledEquity(0.9, 0, street)).toBe(0.9);
        let prev = 1;
        for (const f of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95]) {
          const g = f / (1 - f);
          const ec = slowplayCalledEquity(0.9, g, street);
          expect(ec).toBeLessThanOrEqual(prev);
          expect(ec).toBeLessThanOrEqual(0.9);
          expect(ec).toBeCloseTo(
            Math.pow(0.9, 1 + NLH_REFERENCE_CONTINUATION_SHARPNESS[street] * g),
            12
          );
          expect(ec).toBeCloseTo(
            conditionEquityAgainstRaiseCallRange(0.9, f, {
              sharpness: NLH_REFERENCE_CONTINUATION_SHARPNESS[street],
            }),
            12
          );
          prev = ec;
        }
      }
      const opp = (folds: number): SlowplayOpponentInput => ({
        hudOpp: { eff: { 'f.fb.bg.hu': [40, folds], 'f.betCk': [40, 20] } },
      });
      const lowF = priceMonsterSlowplay({ ...baseInput, opponents: [opp(8)] });
      const highF = priceMonsterSlowplay({ ...baseInput, opponents: [opp(34)] });
      expect(highF.foldProb).toBeGreaterThan(lowF.foldProb);
      expect(highF.calledEquity).toBeLessThan(lowF.calledEquity);
      expect(lowF.calledEquity).toBeLessThan(baseInput.equity);
      // heads-up: meanG = F / (1 - F)
      expect(highF.calledEquity).toBeCloseTo(
        slowplayCalledEquity(0.92, highF.foldProb / (1 - highF.foldProb), 'flop'),
        12
      );
      // EV(bet) = F * P + (1 - F) * U(e_c, P, b, 1)
      expect(highF.evBet).toBeCloseTo(
        highF.foldProb * 100 +
          (1 - highF.foldProb) * riskAdjustedCallUtility(highF.calledEquity, 100, 80, 1),
        10
      );
    });

    it('r2c: a stab is charged only by opponents who act after the Horse (canStab); none -> stabProb 0 and EV(check) = e * P', () => {
      const stabber = (betCk: number, canStab?: boolean): SlowplayOpponentInput => ({
        hudOpp: {
          eff: { 'f.fb.bg.hu': [40, 30], 'f.fb.bg.mw': [40, 30], 'f.betCk': [40, betCk] },
        },
        ...(canStab === undefined ? {} : { canStab }),
      });
      for (const street of ['flop', 'turn'] as const) {
        for (const bf of [1, 2.2]) {
          // Horse last to act: nobody can stab, whatever the position flag says
          for (const inPosition of [true, false]) {
            for (const opps of [[stabber(34, false)], [stabber(34, false), stabber(30, false)]]) {
              const last = priceMonsterSlowplay({
                ...baseInput,
                street,
                inPosition,
                heroBubbleFactor: bf,
                oppCount: opps.length,
                opponents: opps,
              });
              expect(last.stabProb).toBe(0);
              expect(last.evCheck).toBe(baseInput.equity * baseInput.pot);
              expect(last.action).toBe(last.evCheck > last.evBet ? 'check' : 'bet');
            }
          }
          // Opp1 checked -> Horse -> Opp2: only Opp2 is charged
          const mid = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            oppCount: 2,
            opponents: [stabber(36, false), stabber(6, true)],
          });
          const opp2Only = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            oppCount: 2,
            opponents: [stabber(6, true), stabber(36, false)],
          });
          const both = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            oppCount: 2,
            opponents: [stabber(36, true), stabber(6, true)],
          });
          const hu2 = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            opponents: [stabber(6, true)],
          });
          expect(mid.stabProb).toBeCloseTo(hu2.stabProb, 12);
          expect(opp2Only.stabProb).toBeCloseTo(hu2.stabProb, 12);
          expect(both.stabProb).toBeGreaterThan(mid.stabProb);
          // fold side is unchanged by who can stab
          expect(mid.foldProb).toBeCloseTo(both.foldProb, 12);
          expect(mid.calledEquity).toBeCloseTo(both.calledEquity, 12);
        }
      }
      // in position no longer silences the stab by itself: an opponent still to act is charged
      const ipWithStabber = priceMonsterSlowplay({
        ...baseInput,
        inPosition: true,
        opponents: [stabber(34, true)],
      });
      expect(ipWithStabber.stabProb).toBeGreaterThan(0);
    });

    it('r2b/r2c: out of position heads-up is unchanged from r2 (pinned r2 numbers on the OOP fixture)', () => {
      const stabber = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 34], 'f.betCk': [40, 34] } } }],
      });
      const passive = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 34], 'f.betCk': [40, 4] } } }],
      });
      // Values produced by r2 (fd9e542d4cd8) on this exact fixture before the r2b change.
      expect(stabber.stabProb).toBeCloseTo(0.7028650355169692, 12);
      expect(stabber.evCheck).toBeCloseTo(121.5734680883978, 9);
      expect(stabber.evBet).toBeCloseTo(110.60346858473153, 9);
      expect(stabber.action).toBe('check');
      expect(passive.stabProb).toBeCloseTo(0.16715074980268352, 12);
      expect(passive.evCheck).toBeCloseTo(99.03296808839778, 9);
      expect(passive.evBet).toBeCloseTo(110.60346858473153, 9);
      expect(passive.action).toBe('bet');
    });

    it('multiway: fold probabilities multiply over the field; the called equity uses the per-opponent mean g (as kappa was measured)', () => {
      const opp: SlowplayOpponentInput = {
        hudOpp: {
          eff: { 'f.fb.bg.hu': [40, 32], 'f.fb.bg.mw': [40, 32], 'f.betCk': [40, 24] },
        },
      };
      const hu = priceMonsterSlowplay({ ...baseInput, oppCount: 1, opponents: [opp] });
      const mw = priceMonsterSlowplay({ ...baseInput, oppCount: 2, opponents: [opp, opp] });
      const fi = hu.foldProb;
      expect(mw.foldProb).toBeCloseTo(fi * fi, 6);
      // two identical opponents: meanG = g_i, so the called equity equals the heads-up one
      expect(mw.calledEquity).toBeCloseTo(hu.calledEquity, 10);
      // the field version (g = F / (1 - F), F = fi^2) would under-condition: it is NOT used
      const fieldG = (fi * fi) / (1 - fi * fi);
      expect(mw.calledEquity).toBeLessThan(slowplayCalledEquity(0.92, fieldG, 'flop'));
      expect(mw.stabProb).toBeGreaterThan(hu.stabProb);
      // different opponents: mean of the per-opponent odds
      const loose: SlowplayOpponentInput = {
        hudOpp: { eff: { 'f.fb.bg.hu': [40, 8], 'f.fb.bg.mw': [40, 8], 'f.betCk': [40, 24] } },
      };
      const huLoose = priceMonsterSlowplay({ ...baseInput, oppCount: 1, opponents: [loose] });
      const mixed = priceMonsterSlowplay({ ...baseInput, oppCount: 2, opponents: [opp, loose] });
      const gA = hu.foldProb / (1 - hu.foldProb);
      const gB = huLoose.foldProb / (1 - huLoose.foldProb);
      expect(mixed.calledEquity).toBeCloseTo(slowplayCalledEquity(0.92, (gA + gB) / 2, 'flop'), 10);
      // an all-in seat enters with g = 0
      const withAllIn = priceMonsterSlowplay({
        ...baseInput,
        oppCount: 2,
        opponents: [opp, { canRespond: false }],
      });
      expect(withAllIn.foldProb).toBe(0);
      expect(withAllIn.calledEquity).toBeCloseTo(slowplayCalledEquity(0.92, gA / 2, 'flop'), 10);
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

      // r2b: the priced slowplay check needs a player still to act after the check (out of position).
      const trapSpot = monsterFlopState({
        variant: 'nlh',
        street: 'turn',
        heroHole: '7h7c',
        board: 'Ks7d2c9h',
        oppId: oppTrapId,
        heroOop: true,
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

  it('r2c end-to-end: who can stab is read from seat order, not from the street-IQ position read', () => {
    const trapId = '10000000-0000-4000-8000-0000000000c1';
    const passiveId = '10000000-0000-4000-8000-0000000000c2';
    const profile = (user_id: string, foldToBet: number, betCheckedTo: number) => ({
      user_id,
      variant: 'nlh' as const,
      mode: 'cash' as const,
      size: 'hu' as const,
      observed_hands: 80,
      initialized: true,
      counters: {
        ...freshExploitCounters(),
        hands: 80,
        vpip: 40,
        pfr: 20,
        foldToBetOpp: 60,
        foldToBet,
        betCheckedToOpp: 60,
        betCheckedTo,
      },
    });
    HorseMind.importDurableOpponentProfiles([profile(trapId, 55, 54), profile(passiveId, 55, 2)]);
    const opts = (streetIQ: boolean): HorseDecideOpts => ({
      telemetry: true,
      observeMind: false,
      v38Ev: false,
      v29GtoFlop: false,
      v30GtoTurnRiver: false,
      streetIQ,
      horseSlowplayIsPriced: true,
    });
    // Heads-up, the Horse on the button acts last on the turn after the stabber checked: nobody
    // can stab its check, with the street-IQ read on or off (off, the position read is false).
    const last = monsterFlopState({
      variant: 'nlh',
      street: 'turn',
      heroHole: '7h7c',
      board: 'Ks7d2c9h',
      oppId: trapId,
    });
    for (const streetIQ of [true, false]) {
      for (const seed of [1, 7, 42]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          last.hero,
          last.gs as never,
          'balanced',
          undefined,
          opts(streetIQ)
        );
        const fires = firesMap();
        expect(fires['horse_slowplay_priced_bet']).toBe(1);
        expect(fires['horse_slowplay_priced_checked']).toBeUndefined();
        expect(dec.action).not.toBe('check');
      }
    }
    // Out of position against the same stabber (it acts after the Horse): the stab is charged and
    // the priced check wins, with the street-IQ read on or off.
    const first = monsterFlopState({
      variant: 'nlh',
      street: 'turn',
      heroHole: '7h7c',
      board: 'Ks7d2c9h',
      oppId: trapId,
      heroOop: true,
    });
    for (const streetIQ of [true, false]) {
      for (const seed of [1, 7, 42]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          first.hero,
          first.gs as never,
          'balanced',
          undefined,
          opts(streetIQ)
        );
        const fires = firesMap();
        expect(fires['horse_slowplay_priced_checked']).toBe(1);
        expect(dec.action).toBe('check');
      }
    }
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
