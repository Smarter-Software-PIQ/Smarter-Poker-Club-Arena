/**
 * omahaFacingBetValueShareIsMeasured (default OFF): the one place the facing-bet count asks the opponent memory
 * for the bettor's street record (HorseMind.omahaStreetReadOf, the counters only). HorseLogic calls it only with
 * the option on and the mind on, for the bettor alone; the pure read is HorseOmahaFacingBetValueShareMeasured.
 */
import { HorseMind } from './HorseMind.js';
import type { StreetReadCounters } from './HorseOmahaStreetRead.js';

/** The bettor's street record as the decision carries it, or null (no record, outside an Omaha decision). */
export function omahaMeasuredBettorRecord(userId: string): StreetReadCounters | null {
  return HorseMind.omahaStreetReadOf(userId)?.counters ?? null;
}
