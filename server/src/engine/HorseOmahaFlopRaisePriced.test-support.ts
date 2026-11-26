/** Test support for the heads-up flop raise price laws (omahaFlopRaiseIsPriced): the real audited fixture and one decide. */
import { readFileSync } from 'node:fs';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';

export interface FlopRaiseFixtureNode {
  set: string;
  hand: string;
  audit: { verdict: string; best: string; finding: string | null };
  player: SeatPlayer;
  gs: HorseGameStateV2;
  style: never;
  mods: never;
  expect: { flopraise: string; flopraiseBb: number | null; off: string; offBb: number | null };
}
export const FLOP_RAISE_FIXTURE = JSON.parse(
  readFileSync(
    new URL('./HorseOmahaFlopRaisePriced.realHands.fixture.json', import.meta.url),
    'utf8'
  )
) as { opts: Record<string, unknown>; nodes: FlopRaiseFixtureNode[] };

export function flopRaiseDecide(
  n: FlopRaiseFixtureNode,
  on: Record<string, boolean>
): HorseDecision {
  HorseMind.reset();
  seedFastRandom(1);
  return HorseLogic.decide(structuredClone(n.player), structuredClone(n.gs), n.style, n.mods, {
    ...FLOP_RAISE_FIXTURE.opts,
    ...on,
    mind: false,
    telemetry: false,
  } as never) as HorseDecision;
}
