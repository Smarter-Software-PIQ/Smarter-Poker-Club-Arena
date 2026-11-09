/**
 * OMAHA EV FOLD MODEL (2026-11-08, Omaha threshold calibration):
 * HorseDecideOpts.omahaEvFoldModel / HorseMind.evFoldMul.
 *
 * The EV bet engine prices each opponent's fold as MDF times a fold
 * multiplier. Off, that multiplier is the exploit bluff multiplier, exactly
 * as before. On, in PLO4 / PLO5 / PLO6, it is the game's measured fold share
 * over MDF scaled by the opponent's postflop fold-to-bet read shrunk toward
 * the game's population. Preflop calls never move it, so an Omaha player who
 * calls raises and folds flops is not read as a station.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HorseMind,
  OMAHA_EV_FOLD_MODEL,
  OMAHA_EV_FOLD_PRIOR_STRENGTH,
  readScopeOf,
  type ReadScope,
} from './HorseMind.js';
import { mdfFold } from './HorseEvEngine.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord } from '../types.js';

let clock = 1_791_000_000_000;
let handNo = 0;

/** Villain calls the preflop raise, then folds (or calls) the flop bet. */
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
      tableId: '7d0c6a51-6f2e-4a52-9f0e-0b1d2c3e4f50',
      handNumber: 3_000_000 + handNo,
    };
    HorseMind.setDecisionScope(scope, variant);
    HorseMind.observe(h, [], identity, 2);
    HorseMind.setDecisionScope(null);
    HorseMind.observeHandComplete(`omaha-ev:${handNo}`, h, 2, null, scope, false, {
      variant,
      boardCount: 1,
    });
  }
}

function within<T>(
  scope: ReadScope,
  variant: string,
  options: { omahaEvFoldModel?: boolean },
  f: () => T,
  mode: 'cash' | 'tournament' = 'cash'
): T {
  HorseMind.setDecisionScope(scope, variant, mode);
  HorseMind.setDecisionReadOptions(options);
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

describe('Omaha EV fold model (omahaEvFoldModel)', () => {
  const run = <T>(f: () => T): T => f();

  it('the constants are the measured cells and keep the multiplier inside the engine clamp', () => {
    for (const v of ['plo4', 'plo5', 'plo6'] as const) {
      const c = OMAHA_EV_FOLD_MODEL[v];
      expect(c.foldOverMdf).toBeGreaterThan(1.2);
      expect(c.foldOverMdf).toBeLessThan(1.5);
      expect(c.population).toBeGreaterThan(0.45);
      expect(c.population).toBeLessThan(0.56);
    }
    expect(OMAHA_EV_FOLD_PRIOR_STRENGTH).toBe(16);
  });

  it('off, the EV fold multiplier is exactly the exploit bluff multiplier', () =>
    run(() => {
      const scope = readScopeOf('plo5', 6);
      play(scope, 'plo5', 'fold', 30);
      const off = within(scope, 'plo5', {}, () => ({
        ev: HorseMind.evFoldMul('villain'),
        legacy: HorseMind.exploit('villain').bluffMod,
        model: HorseMind.omahaEvFoldMulOf('villain'),
      }));
      expect(off.model).toBeNull();
      expect(off.ev).toBe(off.legacy);
    }));

  it('a stranger is priced at the game population: fold share over MDF', () =>
    run(() => {
      const scope = readScopeOf('plo4', 6);
      const mul = within(scope, 'plo4', { omahaEvFoldModel: true }, () =>
        HorseMind.evFoldMul('stranger')
      );
      expect(mul).toBeCloseTo(OMAHA_EV_FOLD_MODEL.plo4.foldOverMdf, 10);
      // a 0.75-pot bet: MDF 0.4286 -> about 0.547 folds, the measured PLO4 rate
      expect(mdfFold(1, 0.75, mul)).toBeCloseTo(
        (0.75 / 1.75) * OMAHA_EV_FOLD_MODEL.plo4.foldOverMdf,
        10
      );
    }));

  it('a player who calls preflop and folds flops is a folder, not a station', () =>
    run(() => {
      const scope = readScopeOf('plo5', 6);
      play(scope, 'plo5', 'fold', 30);
      const r = within(scope, 'plo5', { omahaEvFoldModel: true }, () => ({
        model: HorseMind.evFoldMul('villain'),
      }));
      const off = within(scope, 'plo5', {}, () => HorseMind.evFoldMul('villain'));
      expect(r.model).toBeGreaterThan(OMAHA_EV_FOLD_MODEL.plo5.foldOverMdf);
      expect(r.model).toBeGreaterThan(off);
    }));

  it('a player who calls every flop bet is priced below the population', () =>
    run(() => {
      const scope = readScopeOf('plo6', 6);
      play(scope, 'plo6', 'call', 30);
      const mul = within(scope, 'plo6', { omahaEvFoldModel: true }, () =>
        HorseMind.evFoldMul('villain')
      );
      expect(mul).toBeLessThan(OMAHA_EV_FOLD_MODEL.plo6.foldOverMdf);
      expect(mul).toBeGreaterThanOrEqual(0);
    }));

  it('the shrink pulls a short sample toward the population', () =>
    run(() => {
      const scope = readScopeOf('plo4', 6);
      play(scope, 'plo4', 'fold', 2);
      const short = within(scope, 'plo4', { omahaEvFoldModel: true }, () =>
        HorseMind.evFoldMul('villain')
      );
      play(scope, 'plo4', 'fold', 40);
      const long = within(scope, 'plo4', { omahaEvFoldModel: true }, () =>
        HorseMind.evFoldMul('villain')
      );
      const pop = OMAHA_EV_FOLD_MODEL.plo4.foldOverMdf;
      expect(short).toBeGreaterThan(pop);
      expect(long).toBeGreaterThan(short);
    }));

  it("hold'em and other games keep the exploit multiplier even with the option on", () =>
    run(() => {
      for (const v of ['nlh', 'plo8', 'short_deck']) {
        const scope = readScopeOf(v, 6);
        const r = within(scope, v, { omahaEvFoldModel: true }, () => ({
          model: HorseMind.omahaEvFoldMulOf('villain'),
          ev: HorseMind.evFoldMul('villain'),
          legacy: HorseMind.exploit('villain').bluffMod,
        }));
        expect(r.model).toBeNull();
        expect(r.ev).toBe(r.legacy);
      }
    }));

  it('a tournament decision keeps the exploit multiplier: tournament players fold about MDF', () =>
    run(() => {
      const scope = readScopeOf('plo4', 6);
      play(scope, 'plo4', 'fold', 30);
      const r = within(
        scope,
        'plo4',
        { omahaEvFoldModel: true },
        () => ({
          model: HorseMind.omahaEvFoldMulOf('villain'),
          ev: HorseMind.evFoldMul('villain'),
          legacy: HorseMind.exploit('villain').bluffMod,
        }),
        'tournament'
      );
      expect(r.model).toBeNull();
      expect(r.ev).toBe(r.legacy);
    }));

  it('outside a decision the option cannot be set', () =>
    run(() => {
      HorseMind.setDecisionScope(null);
      HorseMind.setDecisionReadOptions({ omahaEvFoldModel: true });
      expect(HorseMind.currentDecisionReadOptions().omahaEvFoldModel).toBeUndefined();
      expect(HorseMind.omahaEvFoldMulOf('villain')).toBeNull();
    }));

  it("every opponent the model prices leaves one omaha_ev_fold_model_priced receipt; off, Hold'em and tournaments leave none", () =>
    run(() => {
      enableBrainTelemetry();
      drainFires();
      const fired = () =>
        drainFires().find((r) => r.feature === 'omaha_ev_fold_model_priced')?.fires ?? 0;
      const scope = readScopeOf('plo4', 6);
      within(scope, 'plo4', { omahaEvFoldModel: true }, () => {
        HorseMind.evFoldMul('villain');
        HorseMind.evFoldMul('stranger');
      });
      expect(fired()).toBe(2);
      within(scope, 'plo4', {}, () => HorseMind.evFoldMul('villain'));
      within(readScopeOf('nlh', 6), 'nlh', { omahaEvFoldModel: true }, () =>
        HorseMind.evFoldMul('villain')
      );
      within(
        scope,
        'plo4',
        { omahaEvFoldModel: true },
        () => HorseMind.evFoldMul('villain'),
        'tournament'
      );
      expect(fired()).toBe(0);
    }));
});
