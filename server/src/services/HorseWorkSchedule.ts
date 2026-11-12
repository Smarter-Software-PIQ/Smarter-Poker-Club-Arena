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
 * home when its shift, its day or its cap ended (StableHand.forceLeaveReason
 * had no caller). Measured 2026-11-12 16:49Z: of 103 seated cash horses, 11
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
 * Pure, deterministic, no I/O.
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
