/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REGULARS (owner request 2026-11-07): horses keep a personal schedule and a
 *  home game, the way the people in a card room do
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Cash rooms where horses behave the way people do." A real room has a
 * Friday-night 1/2 NLH crowd, a weekday-morning 0.25/0.50 player, the late
 * owls. Until now a horse's only rhythm was `isActiveNow`: a flat daily window
 * on the UTC clock with no day of the week, and any game in its band was as
 * good as any other.
 *
 * Two stable identities, both derived only from the horse id, so they survive
 * restarts and every process agrees:
 *
 *   PATTERN  2-5 sessions a week, all starting at the same Chicago hour (that
 *            is what makes someone a "regular"), 3-6 hours each, on days
 *            weighted by how busy the room is then. The anchor hour-of-week is
 *            drawn from the ROOM'S OWN CURVE (SECOND_TABLE_RATE per roomBandAt
 *            band), so the sum of every horse's pattern reproduces the room's
 *            weekend/evening shape instead of fighting it (pinned in
 *            HorseRegulars.test.ts).
 *   HOME     one or two variants (a related second one about 45% of the time)
 *            and one or two adjacent stakes inside whatever band the game sits
 *            in.
 *
 * NEITHER IS A GATE. Both only ORDER choices the existing gates already made:
 *
 *   - `availableNow` is `inRegularPattern || isActiveNow`: a superset of the
 *     pool the fleet drew from before, so no table that filled before can go
 *     short because of a schedule.
 *   - `regularSeatWeight` multiplies the random draw that orders an already
 *     eligible pool. The number of horses seated at a table is
 *     min(pool, seats), unchanged; only WHICH horses changes.
 *   - `regularSessionEndFactor` scales the rotator's discretionary session
 *     hazard. The departure it drives is the rotator's ordinary leave, which
 *     goes through owesHands (HIT AND RUN) and the engine's leave door, the
 *     same rule people have. A horse in profit that owes hands stays.
 *
 * Pure, deterministic, no I/O.
 */
import {
  SECOND_TABLE_RATE,
  chicagoHourAt,
  chicagoIsoDowAt,
  horseHash,
  isActiveNow,
  mix32,
  roomBandAt,
  stakeBandForBigBlind,
  type HorseStakeBand,
} from './HorseBehavior.js';

const HOURS_PER_WEEK = 168;

/** Hour of the Chicago week, 0 = Monday 00:00 ... 167 = Sunday 23:00. */
export function hourOfWeekAt(nowMs: number): number {
  return (chicagoIsoDowAt(nowMs) - 1) * 24 + chicagoHourAt(nowMs);
}

/** A reference Chicago week with no DST change in it: Monday 2026-01-05 00:00 CST. */
const REFERENCE_MONDAY_MS = Date.parse('2026-01-05T06:00:00Z');

let roomWeightsCache: number[] | null = null;

/**
 * How busy the room is in each hour of the week: the second-table rate of the
 * band roomBandAt gives that hour. Read through roomBandAt itself, so a change
 * to the room's curve moves the regulars with it.
 */
export function roomWeightByHourOfWeek(): readonly number[] {
  if (roomWeightsCache) return roomWeightsCache;
  const out: number[] = [];
  for (let how = 0; how < HOURS_PER_WEEK; how++) {
    out.push(SECOND_TABLE_RATE[roomBandAt(REFERENCE_MONDAY_MS + how * 3_600_000)]);
  }
  roomWeightsCache = out;
  return out;
}

function unit(id: string, salt: string): number {
  return mix32(horseHash(`${id}:regular:${salt}`)) / 4_294_967_296;
}

function weightedPick(weights: readonly number[], u: number): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = u * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export interface RegularPattern {
  /** ISO days (1 Monday ... 7 Sunday) a session starts on, ascending. */
  days: readonly number[];
  /** Chicago hour every session starts at. */
  startHour: number;
  /** Session length in hours. */
  hours: number;
  /** Hour-of-week each session starts at. */
  starts: readonly number[];
}

const patternCache = new Map<string, RegularPattern>();

/** This horse's weekly pattern. Stable for the life of the id. */
export function regularPatternFor(horseId: string): RegularPattern {
  const cached = patternCache.get(horseId);
  if (cached) return cached;
  const w = roomWeightByHourOfWeek();
  const sessions = 2 + Math.floor(unit(horseId, 'sessions') * 4); // 2-5
  const hours = 3 + Math.floor(unit(horseId, 'hours') * 4); // 3-6
  const half = Math.floor(hours / 2);
  // The anchor is the MIDDLE of a session, drawn from the room's own curve,
  // so a horse is mostly in the room when the room is busy.
  const anchor = weightedPick(w, unit(horseId, 'anchor'));
  const centreHour = anchor % 24;
  const startHour = (centreHour - half + 24) % 24;
  const days = new Set<number>([Math.floor(anchor / 24) + 1]);
  // The other days keep the same hour, weighted by how busy that hour is on
  // each day: a 21:00 regular plays Friday and Saturday more than Tuesday.
  for (let i = 1; days.size < sessions && i < 40; i++) {
    const dayWeights = [1, 2, 3, 4, 5, 6, 7].map((d) =>
      days.has(d) ? 0 : w[(d - 1) * 24 + centreHour]
    );
    days.add(weightedPick(dayWeights, unit(horseId, `day${i}`)) + 1);
  }
  const sorted = [...days].sort((a, b) => a - b);
  const starts = sorted.map(
    (d) => ((d - 1) * 24 + centreHour - half + HOURS_PER_WEEK) % HOURS_PER_WEEK
  );
  const pattern: RegularPattern = Object.freeze({
    days: Object.freeze(sorted),
    startHour,
    hours,
    starts: Object.freeze(starts),
  });
  if (patternCache.size > 20_000) patternCache.clear();
  patternCache.set(horseId, pattern);
  return pattern;
}

/** Is this horse inside its own weekly pattern at `nowMs`? */
export function inRegularPattern(horseId: string, nowMs: number): boolean {
  const how = hourOfWeekAt(nowMs);
  const p = regularPatternFor(horseId);
  for (const s of p.starts) if ((how - s + HOURS_PER_WEEK) % HOURS_PER_WEEK < p.hours) return true;
  return false;
}

/**
 * May this horse be drawn for a cash seat at all this hour? Its pattern, OR the
 * daily window that was the whole rule before (`isActiveNow`). A superset of
 * the old pool by construction, so a schedule never shrinks what a table can
 * draw from; inside that pool `regularSeatWeight` puts the regulars first.
 */
export function availableNow(horseId: string, nowMs: number): boolean {
  return inRegularPattern(horseId, nowMs) || isActiveNow(horseId, new Date(nowMs).getUTCHours());
}

// ── HOME GAMES ───────────────────────────────────────────────────────────

/** How many players call each variant home: hold'em first, then the Omahas. */
const VARIANT_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['nlh', 30],
  ['plo4', 16],
  ['plo5', 14],
  ['plo6', 9],
  ['flh', 9],
  ['flo8', 7],
  ['plo8', 5],
  ['short_deck', 5],
  ['pineapple', 5],
];

/** The game a player of each variant most often plays as well. */
const RELATED: Readonly<Record<string, readonly string[]>> = {
  nlh: ['plo4', 'flh', 'short_deck'],
  plo4: ['plo5', 'nlh'],
  plo5: ['plo4', 'plo6'],
  plo6: ['plo5'],
  flh: ['nlh', 'flo8'],
  flo8: ['plo8', 'flh'],
  plo8: ['flo8', 'plo4'],
  short_deck: ['nlh'],
  pineapple: ['nlh'],
};

/** The stake rungs (big blinds) inside each band, low to high. */
export const BAND_RUNGS: Readonly<Record<HorseStakeBand, readonly number[]>> = Object.freeze({
  micro: [0.1, 0.25, 0.5],
  low: [1, 2],
  mid: [4, 5, 6],
  high: [10, 25, 50],
});

/** Normalise a variant name the way the cash tables spell it. */
export function canonicalVariant(variant: unknown): string {
  const v = String(variant ?? '')
    .trim()
    .toLowerCase();
  if (v === 'plo') return 'plo4';
  if (v === 'shortdeck' || v === '6+') return 'short_deck';
  return v;
}

/** This horse's home variants: one, or two related ones. */
export function homeVariantsFor(horseId: string): readonly string[] {
  const primary =
    VARIANT_WEIGHTS[
      weightedPick(
        VARIANT_WEIGHTS.map(([, w]) => w),
        unit(horseId, 'variant')
      )
    ][0];
  if (unit(horseId, 'second-variant') >= 0.45) return [primary];
  const rel = RELATED[primary] ?? [];
  const second = rel[Math.floor(unit(horseId, 'related') * rel.length)];
  return second ? [primary, second] : [primary];
}

/** Index of the rung `bigBlind` sits on inside its band (nearest rung). */
function rungIndex(band: HorseStakeBand, bigBlind: number): number {
  const rungs = BAND_RUNGS[band];
  let best = 0;
  for (let i = 1; i < rungs.length; i++) {
    if (Math.abs(rungs[i] - bigBlind) < Math.abs(rungs[best] - bigBlind)) best = i;
  }
  return best;
}

/** This horse's home stakes inside a band: one rung, or two adjacent ones. */
export function homeStakesFor(horseId: string, band: HorseStakeBand): readonly number[] {
  const rungs = BAND_RUNGS[band];
  const i = Math.floor(unit(horseId, `stake:${band}`) * rungs.length);
  if (rungs.length < 2 || unit(horseId, `second-stake:${band}`) >= 0.5) return [rungs[i]];
  const j =
    i === 0
      ? 1
      : i === rungs.length - 1
        ? i - 1
        : unit(horseId, `up:${band}`) < 0.5
          ? i - 1
          : i + 1;
  return [rungs[Math.min(i, j)], rungs[Math.max(i, j)]];
}

export type HomeAffinity = 'home' | 'near' | 'away';

/**
 * How much this game is this horse's game: its variant AND its stake ('home'),
 * one of the two ('near'), or neither ('away'). The band is the game's own, so
 * this never argues with the stake-band gate, which has already decided the
 * horse may sit there.
 */
export function homeAffinity(horseId: string, variant: unknown, bigBlind: unknown): HomeAffinity {
  const bb = Number(bigBlind);
  const v = canonicalVariant(variant);
  const variantHome = homeVariantsFor(horseId).includes(v);
  let stakeHome = false;
  if (Number.isFinite(bb) && bb > 0) {
    const band = stakeBandForBigBlind(bb);
    const rung = BAND_RUNGS[band][rungIndex(band, bb)];
    stakeHome = homeStakesFor(horseId, band).includes(rung);
  }
  if (variantHome && stakeHome) return 'home';
  if (variantHome || stakeHome) return 'near';
  return 'away';
}

/** Seat-draw multipliers. In pattern and at home is where a regular is found. */
export const PATTERN_SEAT_WEIGHT = 6;
export const AFFINITY_SEAT_WEIGHT: Readonly<Record<HomeAffinity, number>> = Object.freeze({
  home: 5,
  near: 2,
  away: 1,
});

/**
 * The multiplier on a horse's random draw for a seat at this table. Only an
 * ordering: it never adds a horse to, or removes one from, the pool.
 */
export function regularSeatWeight(
  horseId: string,
  table: { game_variant?: unknown; big_blind?: unknown },
  nowMs: number
): number {
  return (
    (inRegularPattern(horseId, nowMs) ? PATTERN_SEAT_WEIGHT : 1) *
    AFFINITY_SEAT_WEIGHT[homeAffinity(horseId, table.game_variant, table.big_blind)]
  );
}

/**
 * Sort rank for a waiting-list pick: 0 home, 1 near, 2 away. A ranking, never
 * a filter, so a full game's line still grows from whoever can stand in it.
 */
export function homeQueueRank(horseId: string, variant: unknown, bigBlind: unknown): number {
  const a = homeAffinity(horseId, variant, bigBlind);
  return a === 'home' ? 0 : a === 'near' ? 1 : 2;
}

/**
 * The rotator's session-end hazard multiplier. Inside its pattern a regular
 * settles in; once the pattern is over its session winds down; outside both
 * the pattern and the old daily window it is the 1.6 it always was. The
 * departure itself is the rotator's ordinary leave (HIT AND RUN applies).
 */
export function regularSessionEndFactor(horseId: string, nowMs: number): number {
  if (inRegularPattern(horseId, nowMs)) return 0.7;
  if (isActiveNow(horseId, new Date(nowMs).getUTCHours())) return 1.3;
  return 1.6;
}
