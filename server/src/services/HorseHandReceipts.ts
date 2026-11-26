/**
 * THE HAND'S OPTION RECEIPTS ARE WRITTEN AFTER THE HAND, NEVER WITH IT
 * (2026-11-25, Hold'em Strategy lane; engine/HorseHandOptionReceipts.ts).
 *
 * One row per (hand, receipt) in public.ca_horse_hand_receipts, for a hand a
 * person was dealt into. Called from logHandHistory after the hand's own
 * commit has returned, fire-and-forget like writeHandFacts and
 * recordHorseHandReviews: the hand save never waits for it, and a failed or
 * refused write (the table not installed yet, a timeout) is reported once per
 * minute and is never thrown. Insert only; a replayed hand inserts nothing
 * twice (the primary key is (hand_id, receipt)).
 *
 * A row is an option name, two action kinds and a count. No card of any kind
 * can reach it: the rows are rebuilt here from the closed row text
 * (horseHandReceiptRows), and the table refuses anything else.
 */
import { supabase } from './supabase/client.js';
import { reportThrottled } from './errorReporter.js';
import { horseHandReceiptRows } from '../engine/HorseHandOptionReceipts.js';

export const HORSE_HAND_RECEIPTS_TABLE = 'ca_horse_hand_receipts';
export const HORSE_HAND_RECEIPTS_WRITE_TIMEOUT_MS = 5_000;

/** True when this hand writes receipt rows: a person was dealt in and an option changed a decision. */
export function handWritesOptionReceipts(
  rosterHasHuman: boolean | undefined,
  counts: Readonly<Record<string, number>> | null | undefined
): counts is Readonly<Record<string, number>> {
  return rosterHasHuman === true && !!counts && Object.keys(counts).length > 0;
}

/** Writes the hand's rows; resolves to how many were sent (0 on nothing to write or any failure). Never rejects. */
export async function writeHorseHandReceipts(
  handId: string,
  counts: Readonly<Record<string, number>> | null | undefined
): Promise<number> {
  try {
    const rows = horseHandReceiptRows(handId, counts);
    if (rows.length === 0) return 0;
    const { error } = await supabase
      .from(HORSE_HAND_RECEIPTS_TABLE)
      .upsert(rows, { onConflict: 'hand_id,receipt', ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(HORSE_HAND_RECEIPTS_WRITE_TIMEOUT_MS));
    if (error) throw error;
    return rows.length;
  } catch (error) {
    try {
      reportThrottled(
        'HorseHandReceipts.write_failed',
        `hand option receipts not written: ${String((error as { message?: unknown })?.message ?? error).slice(0, 200)}`
      );
    } catch {
      /* reporting a lost receipt never throws */
    }
    return 0;
  }
}
