/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A HORSE KEEPS ITS WORK SCHEDULE AND ITS DAYS OFF (owner 2026-11-12)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-12 10:47 Chicago: "HORSES MUST BE FOLLOWING THERE 'DAILY WORK
 * SCHEDULE' AND ALSO THERE DAYS OFF. MAKE SURE THIS IS FULLY FOLLOWED AND
 * IMPLEMENTED."
 *
 * A horse is ON DUTY for a cash seat only when all three hold:
 *   - it is not its rest day (stable_hand_horse_state.rest_weekday),
 *   - it has not played out its day (daily_cap_minutes, today's counter),
 *   - it is inside its work hours: its weekly regular pattern or its daily
 *     activity window (HorseRegulars.availableNow).
 *
 * This is a GATE, not texture. Before this rule the hour was widened for a
 * human short at a table, an opening feeder, a cluster table under the
 * dealable minimum and the PLO Lightning game, the rest day and daily cap were
 * waived for a human short at a table, and nothing ever sent a seated horse
 * home when its shift, its day or its cap ended (the old
 * StableHand.forceLeaveReason had no caller and was removed). Measured 2026-11-12 16:49Z: of 103 seated cash horses, 11
 * were outside their work hours, 1 was on its rest day and 4 were past their
 * daily cap.
 *
 * Every seating path asks `offDutyReason` before a sit; the rotator asks it of
 * every seated horse and an off-duty horse leaves through the ordinary leave
 * door (HIT AND RUN and the big-pot orbit still decide WHEN, never WHETHER).
 * A missing state row is not a rest day and not a played-out cap (the tag
 * book's fail-open rule), but the work hours are derived from the id alone and
 * always apply.
 *
 * The rule is pure and deterministic; the evidence counters below are the
 * only state, counts with no identities, read by /health.
 */
import { availableNow } from './HorseRegulars.js';
import { dailyCapReached, isRestDayFor, type HorseState } from './StableHandTags.js';

export type OffDutyReason = 'rest_day' | 'daily_cap' | 'off_shift';

/**
 * Why this horse may not hold a cash seat right now, or null when it may.
 * `chicagoWeekday` is Sunday-first 0-6 (chicagoNow().weekday) and `todayKey`
 * is chicagoCounterDay(), the same inputs the tag book is read with.
 */
export function offDutyReason(
  horseId: string,
  state: HorseState | undefined,
  nowMs: number,
  chicagoWeekday: number,
  todayKey: string
): OffDutyReason | null {
  if (isRestDayFor(state, chicagoWeekday)) return 'rest_day';
  if (dailyCapReached(state, todayKey)) return 'daily_cap';
  if (!availableNow(horseId, nowMs)) return 'off_shift';
  return null;
}

/** Convenience: may this horse take or keep a cash seat right now? */
export function onDuty(
  horseId: string,
  state: HorseState | undefined,
  nowMs: number,
  chicagoWeekday: number,
  todayKey: string
): boolean {
  return offDutyReason(horseId, state, nowMs, chicagoWeekday, todayKey) === null;
}

/* ── EVIDENCE (owner 2026-11-12: "fully wired in and tested") ──────────────
   Counts only, no horse identities or amounts, read by /health so anyone can
   see the work schedule being kept without engine logs. Cumulative since the
   process started, except `lastCycle`, which is the fleet's latest census. */
export interface HorseScheduleSupply {
  hostId: string;
  /** Cash bodies eligible on the host (the fleet's own census). */
  eligible: number;
  /** Of those, on duty right now (offDutyReason === null). */
  onDuty: number;
  /** The planner's occupancy cap for the host at this minute of the daily
   *  curve (stableHandHostCaps), or null. */
  target: number | null;
  /** Every seat held on the host when the cycle began (the lobby's count). */
  seats?: number;
  /** The most seats the curve allows the host right now (hostSeatCeiling). */
  seatCeiling?: number | null;
}

const leaves: Record<OffDutyReason, number> = { rest_day: 0, daily_cap: 0, off_shift: 0 };
let leavesDeferred = 0;
let seatCallsDeclined = 0;
let listRowsCancelled = 0;
let lastCycle: {
  at: string;
  seatingRefused: { rest_day: number; daily_cap: number; asleep: number };
  supply: HorseScheduleSupply[];
} | null = null;

const bump = (n: number) => Math.min(Number.MAX_SAFE_INTEGER, n + 1);

/** A seated off-duty horse left through the ordinary leave door. */
export function recordOffDutyLeave(reason: OffDutyReason): void {
  if (Object.prototype.hasOwnProperty.call(leaves, reason)) leaves[reason] = bump(leaves[reason]);
}
/** An off-duty horse still owes hands (HIT AND RUN) or a big-pot orbit: later. */
export function recordOffDutyDeferred(): void {
  leavesDeferred = bump(leavesDeferred);
}
/** An off-duty horse let a seat call lapse. */
export function recordSeatCallDeclined(): void {
  seatCallsDeclined = bump(seatCallsDeclined);
}
/** An off-duty horse's waiting-list row was cancelled. */
export function recordListRowCancelled(): void {
  listRowsCancelled = bump(listRowsCancelled);
}
/** The fleet's per-cycle census. `seatingRefused` counts (horse, table)
 *  candidate PAIRS this cycle dropped, by reason, not distinct horses: one
 *  resting horse is counted once per table it could otherwise have taken. */
export function recordScheduleCycle(
  seatingRefused: { rest_day: number; daily_cap: number; asleep: number },
  supply: HorseScheduleSupply[],
  nowMs: number = Date.now()
): void {
  lastCycle = {
    at: new Date(nowMs).toISOString(),
    seatingRefused: { ...seatingRefused },
    supply: supply.map((s) => ({ ...s })),
  };
}

export function horseWorkScheduleEvidence() {
  return Object.freeze({
    offDutyLeaves: Object.freeze({ ...leaves }),
    offDutyLeavesDeferred: leavesDeferred,
    seatCallsDeclined,
    listRowsCancelled,
    lastCycle: lastCycle
      ? Object.freeze({
          at: lastCycle.at,
          seatingRefused: Object.freeze({ ...lastCycle.seatingRefused }),
          supply: Object.freeze(lastCycle.supply.map((s) => Object.freeze({ ...s }))),
        })
      : null,
  });
}

/** Tests only. */
export function resetHorseWorkScheduleEvidenceForTests(): void {
  leaves.rest_day = 0;
  leaves.daily_cap = 0;
  leaves.off_shift = 0;
  leavesDeferred = 0;
  seatCallsDeclined = 0;
  listRowsCancelled = 0;
  lastCycle = null;
}
