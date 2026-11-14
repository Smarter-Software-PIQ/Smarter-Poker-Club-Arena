/**
 * Test support for HorseHoldemPersonaReRaiseMix.test.ts: the seeded preflop
 * runs, and the recorder of the OFF control.
 *
 * The control in fixtures/horse-holdem-persona-reraise-off-control.json was
 * recorded by `recordOffControl()` from the parent commit of the persona
 * re-raise mix, 8a8656b17b5 (main, before the option existed): this file and
 * benchmark/HoldemPreflopProbe.ts were copied into a `git archive` of that
 * commit and run under its own vitest setup. Each line is one decision:
 * action, amount and the shared random stream's state after it. Not
 * production code and not imported by any.
 *
 * To record again after an intended preflop change on main, do the same from
 * the new parent with HOLDEM_PERSONA_OFF_CONTROL_RECORD=<output path> (see
 * the record test in HorseHoldemPersonaReRaiseMix.test.ts).
 */
import { seedFastRandom } from './HorseEval.js';
import {
  playProbeHand,
  probeRng,
  syntheticFleet,
  type ProbeArm,
  type ProbeMode,
  type ProbeRead,
  type ProbeSpot,
  type ProbeTable,
  type ProbeVariant,
} from '../benchmark/HoldemPreflopProbe.js';

export interface OffRun {
  name: string;
  variant: ProbeVariant;
  mode: ProbeMode;
  seats: number;
  depthBB: number | readonly [number, number];
  hands: number;
  bettingStructure?: 'pot_limit';
  allInOrFold?: boolean;
  /** The persona sites can be reached with the option on. */
  persona: boolean;
}

export const OFF_RUNS: readonly OffRun[] = [
  {
    name: 'nlh cash',
    variant: 'nlh',
    mode: 'cash',
    seats: 6,
    depthBB: 100,
    hands: 150,
    persona: true,
  },
  {
    name: 'nlh cash 30bb',
    variant: 'nlh',
    mode: 'cash',
    seats: 6,
    depthBB: [26, 35],
    hands: 150,
    persona: true,
  },
  {
    name: 'nlh tournament',
    variant: 'nlh',
    mode: 'tournament',
    seats: 9,
    depthBB: [20, 40],
    hands: 110,
    persona: true,
  },
  {
    name: 'plo4',
    variant: 'plo4',
    mode: 'cash',
    seats: 6,
    depthBB: 100,
    hands: 70,
    persona: false,
  },
  {
    name: 'plo5',
    variant: 'plo5',
    mode: 'cash',
    seats: 6,
    depthBB: 100,
    hands: 70,
    persona: false,
  },
  {
    name: 'plo6',
    variant: 'plo6',
    mode: 'cash',
    seats: 6,
    depthBB: 100,
    hands: 70,
    persona: false,
  },
  {
    name: 'short deck',
    variant: 'short_deck',
    mode: 'cash',
    seats: 6,
    depthBB: 100,
    hands: 70,
    persona: false,
  },
  {
    name: 'fixed limit',
    variant: 'flh',
    mode: 'cash',
    seats: 6,
    depthBB: 100,
    hands: 70,
    persona: false,
  },
  {
    name: 'pot-limit holdem',
    variant: 'nlh',
    mode: 'cash',
    seats: 6,
    depthBB: 100,
    hands: 70,
    bettingStructure: 'pot_limit',
    persona: false,
  },
  {
    name: 'all-in-or-fold holdem',
    variant: 'nlh',
    mode: 'cash',
    seats: 6,
    depthBB: 10,
    hands: 70,
    allInOrFold: true,
    persona: false,
  },
];

const FLEET = syntheticFleet();

/** Play a run's hands; the table changes its six or nine ids every ten hands. */
export function playOffRun(
  run: OffRun,
  index: number,
  arms: readonly ProbeArm[],
  onSpot: (spot: ProbeSpot) => void
): void {
  const r = probeRng(0x51ab + index * 7919);
  seedFastRandom((0x9e37 + index * 104729) >>> 0);
  for (let h = 0; h < run.hands; h++) {
    const from = ((index * 97 + Math.floor(h / 10) * run.seats) % (FLEET.length - run.seats)) | 0;
    const table: ProbeTable = {
      variant: run.variant,
      mode: run.mode,
      ids: FLEET.slice(from, from + run.seats),
      depthBB: run.depthBB,
      ...(run.bettingStructure ? { bettingStructure: run.bettingStructure } : {}),
      ...(run.allInOrFold ? { allInOrFold: true } : {}),
    };
    playProbeHand(table, r, arms, onSpot);
  }
}

export const offLine = (r: ProbeRead): string => `${r.action}|${r.amount}|${r.rngAfter}`;

export interface OffControl {
  recordedFrom: string;
  runs: Record<string, string[]>;
}

/** Every run with no option set: one line per decision. */
export function recordOffControl(): Record<string, string[]> {
  const runs: Record<string, string[]> = {};
  OFF_RUNS.forEach((run, index) => {
    const lines: string[] = [];
    playOffRun(run, index, [{ opts: {} }], (spot) => lines.push(offLine(spot.reads[0])));
    runs[run.name] = lines;
  });
  return runs;
}
