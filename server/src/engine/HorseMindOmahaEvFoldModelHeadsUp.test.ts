/**
 * OMAHA EV FOLD MODEL, HEADS-UP POT (2026-11-19, lane HU-OMAHA; rebuild of the intent of 2301473c493):
 * HorseDecideOpts.omahaEvFoldModelHeadsUp / HorseMind.evFoldMul(userId, recencyBlend, headsUpStreet).
 *
 * With omahaEvFoldModel on, a PLO4 / PLO5 cash flop or turn EV bet into one opponent is priced on the measured
 * heads-up cell (people fold about MDF heads-up) and his fold to a bet, shrunk toward the heads-up population.
 * Off (unset, false, or a truthy non-boolean) every multiplier is exactly the pooled model's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HorseMind,
  OMAHA_EV_FOLD_HEADS_UP_MIN_N,
  OMAHA_EV_FOLD_MODEL,
  OMAHA_EV_FOLD_MODEL_HEADS_UP,
  omahaEvFoldHeadsUpCell,
  readScopeOf,
  type ReadScope,
} from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord } from '../types.js';

let clock = 1_792_000_000_000;
let handNo = 0;

function hand(flop: 'fold' | 'call'): ActionRecord[] {
  const t = (clock += 1000);
  const a = (
    seat: number,
    userId: string,
    action: ActionRecord['action'],
    amount: number,
    stage: ActionRecord['stage'],
    extra: Partial<ActionRecord> = {}
  ): ActionRecord => ({ seat, userId, action, amount, stage, timestamp: t, ...extra });
  return [
    a(1, 'hero', 'raise', 7, 'preflop', { isFullRaise: true }),
    a(2, 'villain', 'call', 7, 'preflop'),
    a(1, 'hero', 'bet', 10, 'flop', { isFullRaise: true }),
    flop === 'fold'
      ? a(2, 'villain', 'fold', 0, 'flop', { origin: 'player' })
      : a(2, 'villain', 'call', 10, 'flop'),
  ];
}

function play(scope: ReadScope, variant: string, flop: 'fold' | 'call', times: number): void {
  for (let i = 0; i < times; i++) {
    const h = hand(flop);
    handNo++;
    const identity = {
      version: 1 as const,
      tableId: '7d0c6a51-6f2e-4a52-9f0e-0b1d2c3e4f51',
      handNumber: 4_000_000 + handNo,
    };
    HorseMind.setDecisionScope(scope, variant);
    HorseMind.observe(h, [], identity, 2);
    HorseMind.setDecisionScope(null);
    HorseMind.observeHandComplete(`omaha-ev-hu:${handNo}`, h, 2, null, scope, false, {
      variant,
      boardCount: 1,
    });
  }
}

function within<T>(
  scope: ReadScope,
  variant: string,
  options: Record<string, unknown>,
  f: () => T,
  mode: 'cash' | 'tournament' = 'cash'
): T {
  HorseMind.setDecisionScope(scope, variant, mode);
  HorseMind.setDecisionReadOptions(
    options as Parameters<typeof HorseMind.setDecisionReadOptions>[0]
  );
  try {
    return f();
  } finally {
    HorseMind.setDecisionScope(null);
  }
}

beforeEach(() => {
  HorseMind.reset();
  handNo = 0;
});
afterEach(() => HorseMind.setDecisionScope(null));

describe('Omaha EV fold model, heads-up pot (omahaEvFoldModelHeadsUp)', () => {
  it('the cells are the measured heads-up person answers: about MDF, every cell above the minimum n', () => {
    for (const v of ['plo4', 'plo5'] as const) {
      for (const st of ['flop', 'turn', 'pooled'] as const) {
        const c = OMAHA_EV_FOLD_MODEL_HEADS_UP[v][st];
        expect(c.foldOverMdf).toBeGreaterThan(0.9);
        expect(c.foldOverMdf).toBeLessThan(1.0);
        expect(c.population).toBeGreaterThan(0.25);
        expect(c.population).toBeLessThan(0.4);
        expect(c.n).toBeGreaterThanOrEqual(OMAHA_EV_FOLD_HEADS_UP_MIN_N);
        // below the pooled model of the same game: the multiway answers are what carry the overfold
        expect(c.foldOverMdf).toBeLessThan(OMAHA_EV_FOLD_MODEL[v].foldOverMdf);
      }
    }
    expect(omahaEvFoldHeadsUpCell('PLO4', 'flop')).toBe(OMAHA_EV_FOLD_MODEL_HEADS_UP.plo4.flop);
    expect(omahaEvFoldHeadsUpCell('plo5', 'turn')).toBe(OMAHA_EV_FOLD_MODEL_HEADS_UP.plo5.turn);
    expect(omahaEvFoldHeadsUpCell('plo6', 'flop')).toBeNull();
    expect(omahaEvFoldHeadsUpCell('nlh', 'turn')).toBeNull();
    expect(omahaEvFoldHeadsUpCell(null, 'turn')).toBeNull();
  });

  it('off (unset, false, a truthy non-boolean) every multiplier is exactly the pooled model, street given or not', () => {
    const scope = readScopeOf('plo5', 6);
    play(scope, 'plo5', 'fold', 30);
    for (const off of [
      {},
      { omahaEvFoldModelHeadsUp: false },
      { omahaEvFoldModelHeadsUp: 'yes' },
    ]) {
      const r = within(scope, 'plo5', { omahaEvFoldModel: true, ...off }, () => ({
        base: HorseMind.evFoldMul('villain'),
        flop: HorseMind.evFoldMul('villain', true, 'flop'),
        turn: HorseMind.evFoldMul('villain', true, 'turn'),
        stranger: HorseMind.evFoldMul('stranger', true, 'flop'),
      }));
      expect(r.flop).toBe(r.base);
      expect(r.turn).toBe(r.base);
      expect(r.stranger).toBe(OMAHA_EV_FOLD_MODEL.plo5.foldOverMdf);
    }
  });

  it('on, a stranger heads-up is the heads-up cell of the street; multiway (no street) keeps the pooled model', () => {
    for (const v of ['plo4', 'plo5'] as const) {
      const scope = readScopeOf(v, 6);
      const r = within(scope, v, { omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true }, () => ({
        flop: HorseMind.evFoldMul('stranger', true, 'flop'),
        turn: HorseMind.evFoldMul('stranger', true, 'turn'),
        multiway: HorseMind.evFoldMul('stranger'),
      }));
      expect(r.flop).toBeCloseTo(OMAHA_EV_FOLD_MODEL_HEADS_UP[v].flop.foldOverMdf, 12);
      expect(r.turn).toBeCloseTo(OMAHA_EV_FOLD_MODEL_HEADS_UP[v].turn.foldOverMdf, 12);
      expect(r.multiway).toBe(OMAHA_EV_FOLD_MODEL[v].foldOverMdf);
    }
  });

  it('on, his measured folds move it from the heads-up population; a caller is priced below it', () => {
    const scope = readScopeOf('plo4', 6);
    play(scope, 'plo4', 'fold', 30);
    HorseMind.reset();
    play(scope, 'plo4', 'call', 30);
    const caller = within(
      scope,
      'plo4',
      { omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true },
      () => HorseMind.evFoldMul('villain', true, 'flop')
    );
    expect(caller).toBeLessThan(OMAHA_EV_FOLD_MODEL_HEADS_UP.plo4.flop.foldOverMdf);
    HorseMind.reset();
    play(scope, 'plo4', 'fold', 30);
    const folder = within(
      scope,
      'plo4',
      { omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true },
      () => HorseMind.evFoldMul('villain', true, 'flop')
    );
    expect(folder).toBeGreaterThan(OMAHA_EV_FOLD_MODEL_HEADS_UP.plo4.flop.foldOverMdf);
  });

  it('on, outside its scope nothing changes: PLO6, a tournament, the pooled model off', () => {
    const on = { omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true };
    const s6 = readScopeOf('plo6', 6);
    expect(within(s6, 'plo6', on, () => HorseMind.evFoldMul('stranger', true, 'flop'))).toBe(
      OMAHA_EV_FOLD_MODEL.plo6.foldOverMdf
    );
    const s4 = readScopeOf('plo4', 6);
    const t = within(
      s4,
      'plo4',
      on,
      () => HorseMind.omahaEvFoldMulOf('stranger', 'flop'),
      'tournament'
    );
    expect(t).toBeNull();
    const parentOff = within(s4, 'plo4', { omahaEvFoldModelHeadsUp: true }, () => ({
      model: HorseMind.omahaEvFoldMulOf('stranger', 'flop'),
      ev: HorseMind.evFoldMul('stranger', true, 'flop'),
      legacy: HorseMind.exploit('stranger').bluffMod,
    }));
    expect(parentOff.model).toBeNull();
    expect(parentOff.ev).toBe(parentOff.legacy);
  });

  it('the receipt fires only when the heads-up cell priced an opponent', () => {
    enableBrainTelemetry();
    drainFires();
    const fired = () =>
      drainFires().find((r) => r.feature === 'omaha_ev_fold_model_heads_up_priced')?.fires ?? 0;
    const scope = readScopeOf('plo5', 6);
    within(scope, 'plo5', { omahaEvFoldModel: true }, () =>
      HorseMind.evFoldMul('stranger', true, 'flop')
    );
    expect(fired()).toBe(0);
    within(scope, 'plo5', { omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true }, () => {
      HorseMind.evFoldMul('stranger', true, 'turn');
      HorseMind.evFoldMul('stranger');
    });
    expect(fired()).toBe(1);
  });
});
