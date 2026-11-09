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

/**
 * WHICH PRESETS PRODUCTION ACTUALLY PRESERVES, MEASURED 2026-11-09.
 *
 * Not assumed. Each authored duration was pushed through the live database's
 * own clock functions and the result read back:
 *
 *   authored | fn_ca_minimum_tournament_levels | fn_ca_lock_structure_clock
 *   minutes  | floor 5    floor 8              | unpinned      pinned
 *   ---------+------------------------------------+-------------------------
 *      3     |    5          8                 |    5            5
 *      5     |    5          8                 |    5            5
 *      8     |    8          8                 |    8            8
 *     10     |   10         10                 |    8           10
 *     15     |   15         15                 |    8           10
 *     30     |   30         30                 |    8           10
 *
 * Three triggers enforce this on every write: tournaments_lock_level_clock,
 * zzzzzzzzzz_tournament_level_clock_floor and
 * tournament_schedule_level_clock_floor. The cap is in
 * fn_ca_lock_structure_clock, reached through fn_ca_tournament_lock_level_clock
 * as LEAST(m, is_pinned ? 10 : 8); the 5 minute floor is in
 * fn_ca_minimum_tournament_levels.
 *
 * So, end to end today:
 *   Turbo 5 and Regular 8      - preserved exactly. Offered.
 *   Deep Stack 10              - preserved ONLY on a pinned event; an
 *                                unpinned one is rewritten to 8. Offered only
 *                                where the event is pinned.
 *   Hyper-Turbo 3              - raised to 5 by the floor. NOT offered.
 *   Super Deep 15, Slow 30     - cut to 8 (or 10 pinned) by the cap. NOT
 *                                offered.
 *
 * A preset is never shown to a creator while production would silently
 * rewrite its stated duration: a control labelled "30 minute levels" that
 * produces eight minute levels misstates the game to whoever sits down. The
 * floor and the cap are database-side and move only through the owning
 * release operation; when they do, flip the entry here and the picker follows.
 */
export type ClockSupport = 'preserved' | 'pinned-only' | 'rewritten';

export const PRESET_CLOCK_SUPPORT: Record<PrebuiltStructureId, ClockSupport> = {
  hyper_turbo: 'rewritten',
  turbo: 'preserved',
  regular: 'preserved',
  deep_stack: 'pinned-only',
  super_deep: 'rewritten',
  slow_regular: 'rewritten',
};

/** True when production keeps this preset's stated duration for this event. */
export function presetClockIsPreserved(id: PrebuiltStructureId, isPinned = false): boolean {
  const support = PRESET_CLOCK_SUPPORT[id];
  if (support === 'preserved') return true;
  if (support === 'pinned-only') return isPinned;
  return false;
}

/** The presets a creator may choose for this event, in ladder order. */
export function offerablePrebuiltStructures(isPinned = false): PrebuiltStructure[] {
  return PREBUILT_STRUCTURES.filter((spec) => presetClockIsPreserved(spec.id, isPinned));
}

/**
 * Stored config keys are NAMESPACED, and that is not cosmetic.
 *
 * config.blindStructure is a preset KEY by established contract, and the keys
 * already in use are 'slow' | 'standard' | 'turbo' | 'hyper_turbo'. Three of
 * the six prebuilt ids (turbo, regular, hyper_turbo) would collide with those,
 * so storing a bare id would silently re-point every existing table and
 * schedule holding 'turbo' or 'hyper_turbo' at a DIFFERENT ladder. The prefix
 * keeps the two sets disjoint: an existing stored value can never be read as a
 * prebuilt structure, and a prebuilt structure can never be read as a legacy
 * ramp.
 */
export const PREBUILT_KEY_PREFIX = 'prebuilt:';

export function prebuiltStructureKey(id: PrebuiltStructureId): `prebuilt:${string}` {
  return `${PREBUILT_KEY_PREFIX}${id}` as `prebuilt:${string}`;
}

/** The prebuilt id a stored config value names, or null for any other value. */
export function parsePrebuiltStructureKey(value: unknown): PrebuiltStructureId | null {
  if (typeof value !== 'string' || !value.startsWith(PREBUILT_KEY_PREFIX)) return null;
  const id = value.slice(PREBUILT_KEY_PREFIX.length);
  return PREBUILT_STRUCTURES.some((spec) => spec.id === id) ? (id as PrebuiltStructureId) : null;
}

/**
 * THE CLIENT CLAMPS THE CLOCK TOO (third enforcement point, found 2026-11-09).
 *
 * tournamentFromTableConfig applies `Math.max(5, config.blindsUpMinutes)` to
 * every playable level before anything reaches the database. So a 3 minute
 * Hyper-Turbo is already raised to 5 in the browser, independently of the two
 * database triggers. Any future 3 minute support has to move this clamp as
 * well as the database floor, or the preset still will not survive creation.
 *
 * New MTT authoring also strips break rows (`newTournamentPlayingLevels`, and
 * `assertNoNewMttBreakRows` refuses them), so a preset's breaks are advisory
 * for an MTT: the platform's own synchronized hourly breaks are what the event
 * actually plays. The break cadence in a preset therefore describes the ladder,
 * it does not add breaks to a created MTT. Sit and Go keeps its preset breaks.
 */
export const CLIENT_LEVEL_MINUTES_FLOOR = 5;
