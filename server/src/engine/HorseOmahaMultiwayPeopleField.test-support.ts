/**
 * The audited PLO4 multiway turn and river facing-bet decisions (plo-lead7-01TLQer8/plo4-audit, PLO4 cash Nov 19 23Z
 * to Nov 26 23Z, hands with a person and a Horse seated): the public state and the deciding Horse's OWN cards only
 * (every other seat's cards removed, account ids replaced by the seat), with the action the live Horse took.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';

export interface MultiwayAuditedState {
  k: string;
  /** street.mw.(H|P): the bettor was a Horse or a person */
  tag: string;
  recorded: string;
  gs: HorseGameStateV2;
  player: SeatPlayer;
}

export function loadMultiwayAuditedStates(): MultiwayAuditedState[] {
  return gunzipSync(readFileSync(join(__dirname, 'HorseOmahaMultiwayPeopleField.states.ndjson.gz')))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as MultiwayAuditedState);
}

const MODS = { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 };
export const MULTIWAY_PEOPLE_FIELD_OPTION = 'omahaMultiwayFieldIsPeopleMeasured';

/** The engine's own decide on the live PLO4/PLO5 switch rows of the flop raise fixture (omahaFacingBetEv on). */
export function decideMultiway(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  telemetry: boolean,
  seed = 1
): HorseDecision {
  HorseMind.reset();
  seedFastRandom(seed);
  return HorseLogic.decide(
    structuredClone(player),
    structuredClone(gs),
    'grinder' as never,
    MODS as never,
    {
      ...FLOP_RAISE_FIXTURE.opts,
      ...(on ? { [MULTIWAY_PEOPLE_FIELD_OPTION]: true } : {}),
      mind: false,
      telemetry,
    } as never
  ) as HorseDecision;
}
