/**
 * WHEN A HORSE SITS OUT (2026-11-07).
 *
 * People sit out now and then: a hand or two to answer a message, or a few
 * minutes to get a drink. A horse did one thing only - a 2-3 minute break -
 * and it could take that break while it still owed hands in profit. A sit-out
 * that is not ended in time is a LEAVE: the engine's sit-out clock (two button
 * passes or five minutes, DisconnectEngine) cashes the seat out. So a horse in
 * profit sitting out would be one missed sit-back away from leaving without
 * meeting the hit-and-run rule people are bound by (owner 2026-11-06), and a
 * sitting-out seat plays no hands, so it would not even be working the count
 * down meanwhile.
 *
 * This decides only WHETHER a horse steps away this cycle and for HOW LONG.
 * The step-away itself is the person's mechanism: the engine's own sitOut
 * (deferred to the hand end, never mid-hand), its missed-blind rules on the
 * way back, and its eviction clock. Every duration here ends well inside that
 * clock even with a full rotator cycle of slack.
 */
import { createHash } from 'node:crypto';

/** Chance per cycle, shared across the floor, that one horse steps away. */
export const SIT_OUT_RATE = 0.35;
/** At most this many horses on the whole floor are away at once. */
export const SIT_OUT_MAX_CONCURRENT = 2;
/** "A hand or two": sat back in at the first rotator cycle after this. */
export const SIT_OUT_SHORT_MS: readonly [number, number] = [30_000, 75_000];
/** "A few minutes" (ends before the five-minute eviction even with a 90 s cycle). */
export const SIT_OUT_LONG_MS: readonly [number, number] = [2 * 60_000, 3 * 60_000];
/** Share of step-aways that are only a hand or two. */
export const SIT_OUT_SHORT_SHARE = 0.6;

export type HorseSitOutKind = 'hand_or_two' | 'few_minutes';

export interface HorseSitOutPlan {
  kind: HorseSitOutKind;
  durationMs: number;
}

export interface HorseSitOutInput {
  horseId: string;
  tableId: string;
  /** The rotator cycle this is asked in (same cycle, same answer). */
  moment: number | string;
  /** The rotator's per-cycle draw in [0, 1), taken only once every other test passes. */
  draw: () => number;
  seatsAtTable: number;
  humanPresent: boolean;
  /** HIT AND RUN: hands this seat still owes in profit (engine mirror). */
  handsOwed: number;
  sittingOut: boolean;
  leaving: boolean;
  onBreakHere: boolean;
  breaksOnFloor: number;
  breakTakenThisCycle: boolean;
  tablesOnFloor: number;
}

export type HorseSitOutRefusal =
  | 'owes_hands'
  | 'already_away'
  | 'leaving'
  | 'short_table'
  | 'floor_busy'
  | 'not_drawn';

function unit(key: string): number {
  const hex = createHash('md5').update(key).digest('hex');
  return parseInt(hex.slice(0, 8), 16) / 0x1_0000_0000;
}

/** Why a horse would NOT step away now, or null when it may. */
export function sitOutRefusal(input: HorseSitOutInput): HorseSitOutRefusal | null {
  if ((Number(input.handsOwed) || 0) > 0) return 'owes_hands';
  if (input.sittingOut || input.onBreakHere) return 'already_away';
  if (input.leaving) return 'leaving';
  // The game never suffers: only at well-populated tables.
  if (input.seatsAtTable < (input.humanPresent ? 6 : 5)) return 'short_table';
  if (input.breakTakenThisCycle || input.breaksOnFloor >= SIT_OUT_MAX_CONCURRENT)
    return 'floor_busy';
  if (!(input.draw() < SIT_OUT_RATE / Math.max(1, input.tablesOnFloor))) return 'not_drawn';
  return null;
}

/** Step away this cycle? The kind and length are this horse's habit at this moment. */
export function horseSitOutPlan(input: HorseSitOutInput): HorseSitOutPlan | null {
  if (sitOutRefusal(input) !== null) return null;
  return sitOutLength(input);
}

/** The kind and length this horse takes at this moment, once it steps away. */
export function sitOutLength(
  input: Pick<HorseSitOutInput, 'horseId' | 'tableId' | 'moment'>
): HorseSitOutPlan {
  const key = `${input.horseId}:${input.tableId}:sitout:${input.moment}`;
  const kind: HorseSitOutKind =
    unit(`${key}:kind`) < SIT_OUT_SHORT_SHARE ? 'hand_or_two' : 'few_minutes';
  const [lo, hi] = kind === 'hand_or_two' ? SIT_OUT_SHORT_MS : SIT_OUT_LONG_MS;
  return { kind, durationMs: Math.round(lo + unit(`${key}:length`) * (hi - lo)) };
}
