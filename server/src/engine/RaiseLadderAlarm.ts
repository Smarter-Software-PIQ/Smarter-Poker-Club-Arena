/**
 * THE LIVE RAISE-LADDER ALARM (2026-11-18, Horse Switch lane, SAFETY). MEASUREMENT ONLY.
 *
 * Offline, two Horses facing each other's minimum raise re-raised by the minimum 46 times on one street (the
 * BLANKET-LOO-1 cells truncated at the league's 48-action street cap). The live engine has no such cap in pot or no
 * limit (HandController.getAvailableActions offers `raise` as long as a full raise is possible), so a ladder at a live
 * table would run until the stacks are in. This file makes one visible: it changes no action, menu, amount, record,
 * broadcast or hand history.
 *
 * HOW. HandController counts, per street, the run of consecutive MINIMUM raises: a full raise (or a full-raise all
 * in) whose increment over the bet it raises is the minimum legal raise (within a cent). Calls, checks and folds
 * between raises do not break the run; a larger raise, a short all-in or a new street ends it. Fixed limit is not
 * counted: every fixed-limit raise is the minimum by structure and the street is capped. The run at each counted
 * raise is retained against the accepted action record by object identity (the pattern of HorseTurnClockReceipt.ts),
 * so it never enters the record, the public event or the stored hand. The engine's PLAYER_ACTION handler reads it
 * and, when the run reaches RAISE_LADDER_ALARM_RUN exactly, fires ONE receipt for that street:
 *
 *   raise_ladder_<variant>_<horse_only|mixed>_seen
 *
 * <variant> is the watchcounter variant (BrainTelemetry.normalizeWatchcounterVariant: a fixed set), <horse_only> when
 * every raiser of the run is a Horse, <mixed> when any raiser is not (or is not seated any more). It is an occurrence
 * counter in horse_brain_telemetry (registered in HorseDataLedger.ts, family raise_ladder_*), so its quiet days are
 * normal and the drift audit does not read silence as a dead layer.
 */
import { noteFire, normalizeWatchcounterVariant } from './BrainTelemetry.js';
import {
  RAISE_LADDER_ALARM_RUN,
  raiseLadderStampOf,
  type RaiseLadderStamp,
} from './RaiseLadderStamp.js';

export {
  RAISE_LADDER_ALARM_RUN,
  carryRaiseLadder,
  raiseLadderStampOf,
  retainRaiseLadder,
  type RaiseLadderStamp,
} from './RaiseLadderStamp.js';

/** The variant and the raisers of a stamp that reaches the alarm, or null (it fires once per street). Pure. */
export function raiseLadderAlarmOf(
  stamp: RaiseLadderStamp | undefined,
  isHorse: (userId: string) => boolean
): { variant: string; raisers: 'horse_only' | 'mixed' } | null {
  if (!stamp || stamp.run !== RAISE_LADDER_ALARM_RUN) return null;
  const horses = stamp.raisers.length > 0 && stamp.raisers.every((id) => isHorse(id));
  return {
    variant: normalizeWatchcounterVariant(stamp.variant),
    raisers: horses ? 'horse_only' : 'mixed',
  };
}

/** The engine's PLAYER_ACTION handler: fires the one receipt when this action's run reaches the alarm. Never throws. */
export function noteRaiseLadder(
  record: object | undefined,
  isHorse: (userId: string) => boolean
): void {
  try {
    const alarm = raiseLadderAlarmOf(raiseLadderStampOf(record), isHorse);
    if (alarm) noteFire(`raise_ladder_${alarm.variant}_${alarm.raisers}_seen`);
  } catch {
    /* measurement only: a receipt can never break a hand */
  }
}
