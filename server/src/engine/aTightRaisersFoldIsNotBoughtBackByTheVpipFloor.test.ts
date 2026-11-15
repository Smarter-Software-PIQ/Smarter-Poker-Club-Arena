/**
 * LATER LAYERS KEEP THE STYLE READ, rule 1 (2026-11-15).
 *
 * styleTightReRaiserRespect folds more against a credibly tight opener or
 * re-raiser. The VPIP-floor cheap call-down (vpipFloorCallDown) ran after it
 * and bought every such fold back with probability min(1, 10 * gap): the
 * receipt said the read acted and the hand was played anyway (reproduction
 * claim 1 on a796551420a5). Now a fold the respect produced (the same intent
 * without that read is not a fold) is kept, unless the horse's own windowed
 * VPIP is within one hand of its floor (rate < floor + 1/window), where the
 * floor still buys it. Option off: every decision is byte-identical to the
 * commit before (pins captured there with the same helpers).
 *
 * Spot: cash 6-max, blinds 1/2, 100bb; a credibly tight opener
 * (valueHeavyGrinder) opens to 6 under the gun, hero on the button, 3bb to call.
 */
import { describe, expect, it } from 'vitest';
import { install, VILLAINS } from './HorseOpponentStyle.contexts.test-support.js';
import {
  decide,
  openSpot,
  pinAll,
  seeds,
  supply,
  tally,
} from './laterLayersKeepTheStyleRead.test-support.js';
import { vpipFloorCallDown, vpipFloorKeepsRespectFold } from './HorseLogic.js';
import type { HorseDecision } from '../types.js';

const RESPECT = { styleTightReRaiserRespect: true };
const run = (
  hand: string,
  floor: number | null,
  own: number,
  opts: Record<string, unknown>,
  n = 60
) =>
  seeds(n).map((s) => {
    install(VILLAINS.grinder!, 'cash');
    supply(120);
    return decide(
      openSpot(
        6,
        hand,
        floor === null ? {} : { vpipFloor: floor, ownVpip: { hands: 10, vpip: own } }
      ),
      opts,
      s
    );
  });
// Captured on a668406c (before the change), seeds 1..60.
const BASE = {
  callSixty: '904e4d7140b11810dc3021b6',
  foldSixty: '6f2cf24c96e9ce764b47d3d0',
  kh9d70: '6921661781a1ca63e8592b8b',
  kh9dCallDown: '63b45787ff3daf7f62b95c89',
  acesOff: 'f8d928cba1792b26b8317920',
  acesOn: '906915ec45ed55224fc98fa1',
};

describe("a tight raiser's fold is not bought back by the VPIP floor", () => {
  it('option off: byte-identical to the commit before', () => {
    expect(pinAll(run('Ah2d', 30, 45, {}))).toBe(BASE.callSixty);
    expect(pinAll(run('Kh9d', 50, 60, {}))).toBe(BASE.callSixty);
    expect(pinAll(run('Kh9d', 50, 59, {}))).toBe(BASE.callSixty);
    expect(pinAll(run('Kh9d', 50, 70, {}))).toBe(BASE.kh9d70);
    expect(pinAll(run('AsAh', 30, 45, {}))).toBe(BASE.acesOff);
    expect(pinAll(run('Ah2d', null, 0, {}))).toBe(BASE.callSixty);
  });

  it('the respect fold is kept when the horse is more than one hand above its floor', () => {
    // Before: 24 of 60 called through the floor (Ah2d, floor 30, own 45: q = 0.38)
    // and all 60 (Kh9d, floor 50, own 60: q = 1).
    for (const [hand, floor, own] of [
      ['Ah2d', 30, 45],
      ['Kh9d', 50, 60],
    ] as const) {
      const ds = run(hand, floor, own, RESPECT);
      expect(tally(ds), `${hand} floor ${floor} own ${own}`).toEqual({ fold: 60 });
      expect(ds.every((d) => d.fires.style_tight_opener_respect_seen === 1)).toBe(true);
      expect(ds.some((d) => d.fires.vpip_floor_call_down)).toBe(false);
      expect(ds.every((d) => d.fires.style_tight_respect_fold_kept_from_floor_seen === 1)).toBe(
        true
      );
    }
  });

  it('within one hand of the floor the call-down still buys the hand (unchanged)', () => {
    // floor 50, window 10: 59% < 50% + 1/10; the decision equals the commit before.
    const ds = run('Kh9d', 50, 59, RESPECT);
    expect(tally(ds)).toEqual({ call: 60 });
    expect(ds.every((d) => d.fires.vpip_floor_call_down === 1)).toBe(true);
    expect(pinAll(ds)).toBe(BASE.kh9dCallDown);
  });

  it('a fold the respect did not produce is still bought by the floor (unchanged)', () => {
    // Kh9d, floor 50, own 70: the same hand folds without the respect read too,
    // so the floor's call-down (3 of 60) is the commit before's.
    const ds = run('Kh9d', 50, 70, RESPECT);
    expect(pinAll(ds)).toBe(BASE.kh9d70);
    expect(ds.some((d) => d.fires.style_tight_respect_fold_kept_from_floor_seen)).toBe(false);
  });

  it('value hands and folds the floor never touched are unchanged with the option on', () => {
    expect(pinAll(run('AsAh', 30, 45, RESPECT))).toBe(BASE.acesOn);
    expect(pinAll(run('Ah2d', null, 0, RESPECT))).toBe(BASE.foldSixty);
  });

  it('the one-hand line, the window, and a table without a floor (Lightning carries none)', () => {
    const fold: HorseDecision = { action: 'fold', thinkTime: 0 };
    const player = { bet: 0, stack: 194 };
    const gs = (floor: number, own: number, window = 10) => ({
      stage: 'preflop',
      currentBet: 6,
      bigBlind: 2,
      gameVariant: 'nlh',
      vpipFloor: floor,
      vpipWindowHands: window,
      ownVpip: { hands: window, vpip: own },
    });
    const draw = () => 0;
    // floor 50, window 10: 59% is within one hand (59 < 50 + 10), 60% is not.
    expect(vpipFloorKeepsRespectFold(fold, player, gs(50, 59))).toBe(false);
    expect(vpipFloorKeepsRespectFold(fold, player, gs(50, 60))).toBe(true);
    // A 20-hand window: one hand is 5 points.
    expect(vpipFloorKeepsRespectFold(fold, player, gs(50, 54, 20))).toBe(false);
    expect(vpipFloorKeepsRespectFold(fold, player, gs(50, 55, 20))).toBe(true);
    // Only where the call-down would act: over target, or a price above the cap, keeps nothing.
    expect(vpipFloorKeepsRespectFold(fold, player, gs(50, 95))).toBe(false);
    expect(vpipFloorKeepsRespectFold(fold, { bet: 0, stack: 30 }, gs(50, 60))).toBe(false);
    // The call-down itself is exactly what it was.
    expect(vpipFloorCallDown(fold, player, gs(50, 60), draw).action).toBe('call');
    // Lightning hold'em: its snapshot carries no vpipFloor (LightningHorse.ts),
    // so neither the call-down nor the keep-rule acts there.
    expect(vpipFloorKeepsRespectFold(fold, player, gs(0, 0))).toBe(false);
    expect(vpipFloorCallDown(fold, player, gs(0, 0), draw)).toBe(fold);
  });
});
