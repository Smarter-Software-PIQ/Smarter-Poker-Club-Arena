import { buildLadder, type LadderSpeed } from '../../server/src/tournament/blindLadder';
import type { BlindLevel } from './blindStructures';

/**
 * THE SIX PREBUILT TOURNAMENT STRUCTURES (owner ruling 2026-11-08)
 *
 * Dan, verbatim: "Proceed with all six presets using these fixed level
 * durations. This explicitly supersedes the earlier clock floor and ceiling
 * for these presets." Hyper-Turbo 3, Turbo 5, Regular 8, Deep Stack 10,
 * Super Deep Stack 15, Slow / Deep-Regular 30. "Each preset must use its
 * stated duration consistently throughout its blind levels."
 *
 * So every playable level of a preset carries ONE duration. `buildLadder` is
 * given the same value for its opening and its floor, which switches off the
 * taper: a 30 minute preset is 30 minutes at level 1 and at level 40.
 *
 * WHY THESE ARE GENERATED AND NOT TYPED OUT. The four older ramps in
 * blindStructures.ts are hand-written arrays that open 10/20, 15/30, 20/40,
 * 25/50 — and `mttAndSngOpeningBlinds` then floors every one of those at
 * 25/50, so the first four levels collapse into four identical levels. That
 * is the repeat removed on 2026-11-08. These six open at 25/50 honestly, so
 * nothing is clamped and nothing has to be stripped back out afterwards.
 *
 * Breaks are inserted on a cadence rather than authored, so a break can never
 * drift away from the ladder it belongs to. Synchronized hourly breaks remain
 * the platform's own and are unaffected by these rows.
 */
export interface PrebuiltStructure {
  id: PrebuiltStructureId;
  label: string;
  minutes: number;
  speed: LadderSpeed;
  levels: number;
  /** Starting stack as a multiple of the opening big blind. */
  depthBB: number;
  /** A break after every N playable levels. */
  breakEvery: number;
  blurb: string;
}

export type PrebuiltStructureId =
  | 'hyper_turbo'
  | 'turbo'
  | 'regular'
  | 'deep_stack'
  | 'super_deep'
  | 'slow_regular';

export const OPENING_BIG_BLIND = 50;

export const PREBUILT_STRUCTURES: readonly PrebuiltStructure[] = [
  {
    id: 'hyper_turbo',
    label: 'Hyper-Turbo',
    minutes: 3,
    speed: 'HYPER_TURBO',
    levels: 18,
    depthBB: 100,
    breakEvery: 6,
    blurb: 'Fastest format. Push-or-fold almost immediately.',
  },
  {
    id: 'turbo',
    label: 'Turbo',
    minutes: 5,
    speed: 'TURBO',
    levels: 24,
    depthBB: 150,
    breakEvery: 6,
    blurb: 'Quick blinds, short decisions, finishes in a couple of hours.',
  },
  {
    id: 'regular',
    label: 'Regular',
    minutes: 8,
    speed: 'STANDARD',
    levels: 36,
    depthBB: 200,
    breakEvery: 6,
    blurb: 'The reference tournament. Standard and bounty events default here.',
  },
  {
    id: 'deep_stack',
    label: 'Deep Stack',
    minutes: 10,
    speed: 'STANDARD',
    levels: 40,
    depthBB: 300,
    breakEvery: 6,
    blurb: 'Deeper start and a slower climb. Room to play after the flop.',
  },
  {
    id: 'super_deep',
    label: 'Super Deep Stack',
    minutes: 15,
    speed: 'SLOW',
    levels: 50,
    depthBB: 500,
    breakEvery: 4,
    blurb: 'Mega Deep. 500 big blinds and a long, gradual climb.',
  },
  {
    id: 'slow_regular',
    label: 'Slow / Deep-Regular',
    minutes: 30,
    speed: 'SLOW',
    levels: 36,
    depthBB: 100,
    breakEvery: 4,
    blurb: 'A standard 100 big blind stack on very long levels.',
  },
] as const;

/** Chip-friendly ante, a quarter of the big blind, from level 5 onward. */
const ANTE_FROM_LEVEL = 5;

export function prebuiltStructure(id: PrebuiltStructureId): PrebuiltStructure {
  const found = PREBUILT_STRUCTURES.find((entry) => entry.id === id);
  if (!found) throw new Error('Unknown Tournament Structure');
  return found;
}

/** The full ladder for a preset: playable levels at ONE fixed duration, with
 *  breaks interleaved. Deterministic, so the same preset always persists the
 *  same array and a restart re-derives it exactly. */
export function prebuiltLadder(id: PrebuiltStructureId): BlindLevel[] {
  const spec = prebuiltStructure(id);
  const playable = buildLadder({
    startBigBlind: OPENING_BIG_BLIND,
    speed: spec.speed,
    levels: spec.levels,
    openingMinutes: spec.minutes,
    floorMinutes: spec.minutes,
    anteFromLevel: ANTE_FROM_LEVEL,
    anteFraction: 0.25,
  });

  const rows: BlindLevel[] = [];
  playable.forEach((row, index) => {
    rows.push({
      level: rows.length + 1,
      smallBlind: row.smallBlind,
      bigBlind: row.bigBlind,
      ante: row.ante,
      durationMinutes: spec.minutes,
    });
    const played = index + 1;
    if (played % spec.breakEvery === 0 && played < playable.length) {
      rows.push({
        level: rows.length + 1,
        smallBlind: 0,
        bigBlind: 0,
        ante: 0,
        durationMinutes: 5,
        isBreak: true,
      });
    }
  });
  return rows;
}

/** Starting stack bound to the ladder's own opening big blind. */
export function prebuiltStartingChips(id: PrebuiltStructureId): number {
  return OPENING_BIG_BLIND * prebuiltStructure(id).depthBB;
}

/**
 * A LATE ENTRANT MUST STILL HAVE A TOURNAMENT TO PLAY.
 *
 * The cutoff is DERIVED, never typed: registration closes at the end of the
 * last playable level where someone buying in right then still holds at least
 * MIN_LATE_ENTRY_BB big blinds. Hand-picked cutoffs are how the 2026-11-08
 * 40 Chip Freezeout ended up admitting entries at five big blinds - under one
 * orbit - and a generated ladder can drift past a typed number silently.
 *
 * Returned as a count of ROWS (breaks included), which is what
 * `late_reg_levels` counts on the event.
 */
export const MIN_LATE_ENTRY_BB = 20;

export function prebuiltLateRegLevels(id: PrebuiltStructureId): number {
  const chips = prebuiltStartingChips(id);
  const rows = prebuiltLadder(id);
  let played = 0;
  let last = 1;
  for (const row of rows) {
    if (row.isBreak) continue;
    played += 1;
    if (Math.floor(chips / row.bigBlind) >= MIN_LATE_ENTRY_BB) last = played;
  }
  return last;
}

export function prebuiltLateRegRows(id: PrebuiltStructureId): number {
  const target = prebuiltLateRegLevels(id);
  const rows = prebuiltLadder(id);
  let played = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (!rows[i].isBreak) played += 1;
    if (played === target) return i + 1;
  }
  return rows.length;
}
