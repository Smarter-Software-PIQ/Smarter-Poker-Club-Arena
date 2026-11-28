import { describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { stateAt } from './HorseComplaintReplay.js';
import { publicMemoryDomainFromRules } from './HorsePublicMemoryDomain.js';
import {
  LIVE,
  PRODUCTION_28372C9A,
  SPOTS,
  buildFixture,
  cards,
  type Spot,
} from './HorseVpipFloorLimpOnly.test-support.js';
import { horsePhase6AttributionMismatch } from './HorsePhase6Attribution.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { limpReraiseStrongHand } from './HorseOmahaLimpReraise.js';
import { rrHands } from './HorseOmahaReraisedPotPriced.test-support.js';
import type { SeatPlayer } from '../types.js';

/*
 * THE LIMP RE-RAISE IS A REFERENCE RETURN (omahaLimpReraiseVsIsoRaiser, default OFF; owner order 2026-11-27).
 *
 * The option changes the proposal inside the reference node, after the source route has returned: a first-in raise
 * becomes the limp of the price, and the Horse's own limp facing one raise becomes the pot re-raise. The engine refuses
 * a receipt whose proposal its named route could not have returned (reference_shape) and folds the seat, so every
 * decision the option changes is checked here against the worker's own attribution and receipt checks, on the shared
 * six-seat fixture (blinds 1/2), PLO4 and PLO5 cash, synthetic seeded hands only (no recorded card).
 */

const ON: HorseDecideOpts = { ...PRODUCTION_28372C9A, omahaLimpReraiseVsIsoRaiser: true };
const OFF: HorseDecideOpts = { ...PRODUCTION_28372C9A };
type Snap = { player: SeatPlayer; gameState: HorseGameStateV2; opts: HorseDecideOpts };

const folds = (...s: number[]) => s.map((n) => [n, 'fold'] as [number, string]);
const MY_SPOTS: Record<string, Spot> = {
  btnFirstIn: SPOTS.btnFirstIn,
  sbFirstIn: SPOTS.sbFirstIn,
  btnLimpRaised: {
    hero: 4,
    prior: [...folds(1, 2, 3), [4, 'call'], [5, 'fold'], [6, 'pot']],
  } as Spot,
  sbLimpRaised: { hero: 5, prior: [...folds(1, 2, 3, 4), [5, 'call'], [6, 'pot']] } as Spot,
  coLimpRaised: {
    hero: 3,
    prior: [...folds(1, 2), [3, 'call'], [4, 'pot'], [5, 'fold'], [6, 'fold']],
  } as Spot,
};

function state(spot: Spot, variant: 'plo4' | 'plo5', hole: string) {
  const fx = buildFixture(spot, { variant, floor: 0 }, cards(hole));
  const st = stateAt(fx, fx.actions[fx.actions.length - 1]);
  const gs = st.gs as unknown as Record<string, unknown>;
  gs.publicMemoryDomain = publicMemoryDomainFromRules('table', 0, false);
  return { hero: st.hero, gs: gs as unknown as HorseGameStateV2 };
}

function decide(hero: SeatPlayer, gs: HorseGameStateV2, opts: HorseDecideOpts, seed: number) {
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseTimingRandom(seed);
  return HorseLogic.decide(hero, gs, LIVE.style, LIVE.mods, { mind: false, ...opts });
}

describe('omahaLimpReraiseVsIsoRaiser: every proposal it changes is a reference return', () => {
  for (const variant of ['plo5', 'plo4'] as const)
    it(`${variant}: no reference_shape mismatch and no receipt refusal on any limp or re-raise it makes`, () => {
      const hands = rrHands(400, variant === 'plo4' ? 4 : 5, 777)
        .filter((h) => limpReraiseStrongHand(cards(h)))
        .slice(0, 40);
      let changed = 0;
      for (const [name, spot] of Object.entries(MY_SPOTS))
        for (const [i, h] of hands.entries()) {
          let built: ReturnType<typeof state>;
          try {
            built = state(spot, variant, h);
          } catch {
            continue;
          }
          const off = decide(built.hero, built.gs, OFF, 900 + i);
          const on = decide(built.hero, built.gs, ON, 900 + i);
          if (on.action === off.action && on.amount === off.amount) continue;
          changed++;
          const snapshot: Snap = { player: built.hero, gameState: built.gs, opts: ON };
          expect([name, h, horsePhase6AttributionMismatch(on, snapshot)]).toEqual([name, h, null]);
          expect([name, h, horseDecisionReceiptRefusal(on, variant, snapshot as never)]).toEqual([
            name,
            h,
            null,
          ]);
        }
      expect(changed).toBeGreaterThan(0);
    }, 240_000);
});
