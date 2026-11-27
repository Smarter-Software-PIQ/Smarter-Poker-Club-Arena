/**
 * Test support for omahaFlopPressureCapIsPriced (PLO-OWNER lead-7 2026-11-26): the 445 audited PLO4 heads-up flop
 * facing-bet decisions (plo4-audit, Nov 19 to 26; public state and the deciding Horse's OWN cards only, every other
 * seat's cards stripped, user ids replaced by seat names), the recorded live action and the live decision options of
 * the audit, and one decide call.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';

export interface FlopCapNode {
  k: string;
  /** flop.hu.P: the bettor is a person; flop.hu.H: a Horse */
  tag: string;
  recorded: string;
  potBb: number;
  toCallBb: number;
  gs: HorseGameStateV2;
  player: SeatPlayer;
  opts: Record<string, unknown>;
}

export function loadFlopCapNodes(): FlopCapNode[] {
  return gunzipSync(readFileSync(join(__dirname, 'HorseOmahaFlopPressureCap.states.ndjson.gz')))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as FlopCapNode);
}

export const FLOP_CAP_MODS = {
  tightness: 0.98,
  aggression: 1.18,
  bluffFreq: 0.91,
  sizingMultiplier: 0.94,
};

/** One engine decide on a copy of the state: opponent memory off, the given seed and options. */
export function flopCapDecide(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: Record<string, unknown>,
  seed = 1,
  telemetry = true
): { decision: HorseDecision; fired: ReadonlySet<string> } {
  if (telemetry) enableBrainTelemetry();
  const run = (): HorseDecision => {
    HorseMind.reset();
    seedFastRandom(seed);
    return HorseLogic.decide(
      structuredClone(player),
      structuredClone(gs),
      'grinder' as never,
      FLOP_CAP_MODS as never,
      { ...opts, mind: false, telemetry } as never
    ) as HorseDecision;
  };
  const r = withDecisionFireScope(run);
  return { decision: r.value, fired: r.fired };
}

/** The decision as compared (action and chips). */
export function flopCapKey(d: HorseDecision): string {
  return `${d.action}:${typeof d.amount === 'number' ? d.amount.toFixed(2) : '-'}`;
}
