/**
 * Phase 1 measurement foundation (2026-11-02): V74 and V76 had no dedicated
 * telemetry receipt, so their live activation could only be inferred. These
 * receipts are pure observation: they must fire exactly where the policy
 * acts and never change an action, amount or random draw.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { BB, holeFor, stateFor, type Vs3Ctx } from './HorseVs3BetDefence.test-support.js';

const CASH6: Vs3Ctx = {
  seats: 6,
  stackBB: 100,
  mode: 'cash',
  ante: false,
  openBB: 2.5,
  threeBetX: 4,
};
const MTT9: Vs3Ctx = {
  seats: 9,
  stackBB: 80,
  mode: 'tournament',
  ante: true,
  openBB: 2.3,
  threeBetX: 3.6,
};

type D = { action: string; amount?: number };
function run(
  build: () => ReturnType<typeof stateFor>,
  seed: number,
  opts: Record<string, unknown> = {}
) {
  const { hero, gs } = build();
  seedFastRandom(seed);
  HorseMind.reset();
  drainFires();
  const d = HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {} as never,
    {
      telemetry: true,
      mind: false,
      ...opts,
    } as never
  ) as D;
  const fired = new Set(drainFires().map((r) => r.feature));
  return { d, fired };
}

describe('Phase 1 receipts: V74 open size and V76 retired 4-bet bluff', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('V74 fires on every NLH raise-first-in drawn from the band, never with V74 off, and cash opens are >= 2.5bb', () => {
    let opens = 0;
    for (const ctx of [CASH6, MTT9]) {
      for (const seat of [3, 4, ctx.seats]) {
        for (const h of HAND_CLASSES.slice(0, 40)) {
          const on = run(() => stateFor(ctx, seat, -1, holeFor(h.cls, 1)), 31 + seat);
          const off = run(() => stateFor(ctx, seat, -1, holeFor(h.cls, 1)), 31 + seat, {
            v74NlhOpenSizes: false,
          });
          expect(off.fired.has('v74_nlh_open_size')).toBe(false);
          if (on.d.action === 'raise') {
            opens++;
            expect(on.fired.has('v74_nlh_open_size'), `${h.cls} seat ${seat}`).toBe(true);
            if (ctx.mode === 'cash') expect(on.d.amount!).toBeGreaterThanOrEqual(2.5 * BB - 1e-9);
          }
          if (on.d.action !== 'raise') expect(on.fired.has('v74_nlh_open_size')).toBe(false);
        }
      }
    }
    expect(opens).toBeGreaterThan(0);
  });

  it('V76 fires only where the retired band rolled, never alongside a raise, never with V76 off', () => {
    let fires = 0;
    for (const [ctx, hero] of [
      [CASH6, 4],
      [MTT9, 6],
    ] as const) {
      for (const h of HAND_CLASSES) {
        for (let seed = 1; seed <= 10; seed++) {
          const s0 = seed * 7919 + hero * 104729 + h.cls.charCodeAt(0) * 131;
          const on = run(() => stateFor(ctx, hero, 2, holeFor(h.cls, seed)), s0);
          const off = run(() => stateFor(ctx, hero, 2, holeFor(h.cls, seed)), s0, {
            v76RetireFourBetBluffBand: false,
          });
          expect(off.fired.has('v76_retired_four_bet_bluff')).toBe(false);
          if (on.fired.has('v76_retired_four_bet_bluff')) {
            fires++;
            expect(['call', 'fold', 'check']).toContain(on.d.action);
          }
        }
      }
    }
    expect(fires).toBeGreaterThan(0);
  });

  it('the receipts are observation only: telemetry on and off decide identically', () => {
    for (const ctx of [CASH6, MTT9]) {
      for (const h of HAND_CLASSES.filter((_, i) => i % 5 === 0)) {
        for (const [seat, three] of [
          [3, -1],
          [4, 2],
        ] as const) {
          const a = run(() => stateFor(ctx, seat, three, holeFor(h.cls, 2)), 77);
          const { hero, gs } = stateFor(ctx, seat, three, holeFor(h.cls, 2));
          seedFastRandom(77);
          HorseMind.reset();
          const b = HorseLogic.decide(
            hero,
            gs,
            'balanced',
            {} as never,
            {
              telemetry: false,
              mind: false,
            } as never
          ) as D;
          expect(b.action, h.cls).toBe(a.d.action);
          expect(b.amount, h.cls).toBe(a.d.amount);
        }
      }
    }
  });
});
