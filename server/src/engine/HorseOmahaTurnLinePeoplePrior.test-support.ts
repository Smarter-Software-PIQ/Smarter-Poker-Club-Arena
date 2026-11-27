/**
 * Real PLO4/PLO5 cash turn decisions of Horses facing a PERSON's first turn wager (lead-8 lane OFB, Oct 27 - Nov 27,
 * hands with a person and a Horse seated; up to 40 per street line x heads-up/multiway x size x game): the public state
 * and the deciding Horse's OWN cards only (every other seat's cards removed, account ids replaced by the seat), with
 * the action the live Horse took. tag = turn.(hu|mw).(checked|led).(s|m|l).(plo4|plo5).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';

export interface TurnLineState {
  k: string;
  tag: string;
  recorded: string;
  gs: HorseGameStateV2;
  player: SeatPlayer;
}

export function loadTurnLineStates(): TurnLineState[] {
  return gunzipSync(readFileSync(join(__dirname, 'HorseOmahaTurnLinePeoplePrior.states.ndjson.gz')))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TurnLineState);
}

const MODS = { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 };
export const TURN_LINE_OPTION = 'omahaTurnFacingBetPriorIsLineSplit';

/** The engine's own decide on the live PLO4/PLO5 switch rows of the flop raise fixture (omahaFacingBetEv on). */
export function decideTurnLine(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  telemetry: boolean,
  extra: Record<string, boolean> = {},
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
      ...(on ? { [TURN_LINE_OPTION]: true } : {}),
      ...extra,
      mind: false,
      telemetry,
    } as never
  ) as HorseDecision;
}
