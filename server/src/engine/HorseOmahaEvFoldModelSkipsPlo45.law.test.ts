/**
 * LAW (lane NOV8, 2026-11-19): omahaEvFoldModelSkipsPlo45 (default OFF).
 *
 * Release bff6eed3 (Nov 9 2026 1:41 PM Chicago) put the Omaha EV fold model (#10104, omahaEvFoldModel,
 * default on) live. At that release the PLO5 Horses' flop c-bet rose 0.539 -> 0.740 and their showdown
 * share after a flop fell 0.326 -> 0.198 (ca_hand_facts); PLO4 moved little. With this option on:
 *   1. PLO4 / PLO5 cash price every opponent fold with the exploit bluff multiplier, exactly as before
 *      #10104 (HorseMind.evFoldMul === HorseMind.exploit().bluffMod), and leave a receipt;
 *   2. PLO6 is byte-identical: the model prices it exactly as with the option off, and no receipt;
 *   3. tournaments are unchanged (the model never priced them);
 *   4. off (absent or false) changes nothing anywhere;
 *   5. HorseLogic.decide carries the option only on an explicit true.
 * Synthetic hands only (no production hole cards).
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseMind, readScopeOf, type ReadScope } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord } from '../types.js';

let clock = 1_791_500_000_000;
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
      tableId: '5b7e1c9a-2d4f-4e61-8a3b-9c0d1e2f3a4b',
      handNumber: 4_000_000 + handNo,
    };
    HorseMind.setDecisionScope(scope, variant);
    HorseMind.observe(h, [], identity, 2);
    HorseMind.setDecisionScope(null);
    HorseMind.observeHandComplete(`nov8-skip:${handNo}`, h, 2, null, scope, false, {
      variant,
      boardCount: 1,
    });
  }
}

type Opts = { omahaEvFoldModel?: boolean; omahaEvFoldModelSkipsPlo45?: boolean };
function priced(
  variant: string,
  options: Opts,
  user: string,
  mode: 'cash' | 'tournament' = 'cash'
): { ev: number; legacy: number; model: number | null } {
  const scope = readScopeOf(variant, 6);
  HorseMind.setDecisionScope(scope, variant, mode);
  HorseMind.setDecisionReadOptions(options);
  try {
    return {
      ev: HorseMind.evFoldMul(user),
      legacy: HorseMind.exploit(user).bluffMod,
      model: HorseMind.omahaEvFoldMulOf(user),
    };
  } finally {
    HorseMind.setDecisionScope(null);
  }
}

const skipFires = (): number =>
  drainFires().find((r) => r.feature === 'omaha_ev_fold_model_skipped_plo45')?.fires ?? 0;

beforeEach(() => {
  HorseMind.reset();
  handNo = 0;
  enableBrainTelemetry();
  drainFires();
});
afterEach(() => HorseMind.setDecisionScope(null));

describe('omahaEvFoldModelSkipsPlo45 (default off; PLO4 / PLO5 cash only; PLO6 untouched)', () => {
  for (const variant of ['plo4', 'plo5'] as const) {
    it(`${variant} cash: on, the EV fold multiplier is the exploit bluff multiplier (pre-#10104 price)`, () => {
      play(readScopeOf(variant, 6), variant, 'fold', 30);
      play(readScopeOf(variant, 6), variant, 'call', 5);
      for (const user of ['villain', 'stranger']) {
        const before = priced(variant, { omahaEvFoldModel: true }, user);
        drainFires();
        const on = priced(
          variant,
          { omahaEvFoldModel: true, omahaEvFoldModelSkipsPlo45: true },
          user
        );
        expect(on.model).toBeNull();
        expect(on.ev).toBe(on.legacy);
        expect(skipFires()).toBeGreaterThan(0);
        // the model did price this spot with the option off, so the option is what changed it
        expect(before.model).not.toBeNull();
        expect(before.ev).toBe(before.model);
      }
      const v = priced(variant, { omahaEvFoldModel: true }, 'villain');
      const s = priced(
        variant,
        { omahaEvFoldModel: true, omahaEvFoldModelSkipsPlo45: true },
        'villain'
      );
      expect(s.ev).not.toBe(v.ev);
    });
  }

  it('PLO6 cash: on is byte-identical to off (the model keeps pricing PLO6), no receipt', () => {
    play(readScopeOf('plo6', 6), 'plo6', 'fold', 30);
    for (const user of ['villain', 'stranger']) {
      const off = priced('plo6', { omahaEvFoldModel: true }, user);
      drainFires();
      const on = priced('plo6', { omahaEvFoldModel: true, omahaEvFoldModelSkipsPlo45: true }, user);
      expect(skipFires()).toBe(0);
      expect(Object.is(on.ev, off.ev)).toBe(true);
      expect(Object.is(on.model, off.model)).toBe(true);
      expect(on.model).not.toBeNull();
    }
  });

  it('tournaments are unchanged in every Omaha variant', () => {
    for (const variant of ['plo4', 'plo5', 'plo6']) {
      play(readScopeOf(variant, 6), variant, 'fold', 20);
      const off = priced(variant, { omahaEvFoldModel: true }, 'villain', 'tournament');
      const on = priced(
        variant,
        { omahaEvFoldModel: true, omahaEvFoldModelSkipsPlo45: true },
        'villain',
        'tournament'
      );
      expect(Object.is(on.ev, off.ev)).toBe(true);
    }
    expect(skipFires()).toBe(0);
  });

  it('off (absent or false) changes nothing in PLO4, PLO5 or PLO6', () => {
    for (const variant of ['plo4', 'plo5', 'plo6']) {
      play(readScopeOf(variant, 6), variant, 'fold', 20);
      const base = priced(variant, { omahaEvFoldModel: true }, 'villain');
      const f = priced(
        variant,
        { omahaEvFoldModel: true, omahaEvFoldModelSkipsPlo45: false },
        'villain'
      );
      expect(Object.is(f.ev, base.ev)).toBe(true);
    }
    expect(skipFires()).toBe(0);
  });

  it('HorseLogic.decide carries the option into the decision read options only on an explicit true', () => {
    const src = readFileSync(new URL('./HorseLogic.ts', import.meta.url), 'utf8');
    // The key exists only on an explicit true, so with the option off the read options are byte-identical
    // to what they were before it (HorseMindReadCalibration pins the off shape).
    expect(src).toContain(
      '...(opts.omahaEvFoldModelSkipsPlo45 === true ? { omahaEvFoldModelSkipsPlo45: true } : {}),'
    );
  });
});
