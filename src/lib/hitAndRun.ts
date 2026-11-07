/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HIT AND RUN - the player's side of the ten-hand rule (owner 2026-11-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   "ONCE A PLAYER 'IS IN PROFIT' AT A TABLE... THEY CAN NOT LEAVE THE TABLE
 *    UNTIL THEY PLAY 10 HANDS IN PROFIT ... THOSE 10 HANDS SHOULD BE DISPLAYED
 *    AND COUNTED DOWN AFTER THE COMPLETION OF EACH HAND SO THE USER CAN SEE
 *    IT. IF THEY TRY TO LEAVE THE GAME BEFORE THE HANDS ARE COMPLETED, THEY
 *    SHOULD RECEIVE A FULL SCREEN POP UP ... YOU WILL BE BLINDED OFF FOR THE
 *    REMAINING HANDS."  Plus the Charles Rule: ten more hands per double.
 *
 * The database owns the count (cash_player_session, advanced once per dealt
 * hand) and the engine enforces it at the voluntary leave door. The client
 * only reads it - to show the count and to ask before a leave - and never
 * decides anything: a leave the engine refuses is still refused.
 */
import { supabase } from './supabase';

export const HIT_RUN_CONFIRM_TITLE = 'Your Hand Count Is Not Completed';
export const HIT_RUN_CONFIRM_QUESTION = 'Are You Sure You Want To Leave?';
export const HIT_RUN_CONFIRM_CONSEQUENCE = 'You Will Be Blinded Off For The Remaining Hands.';

export function handsRemainingText(hands: number): string {
  const n = Math.max(0, Math.floor(hands));
  return `${n} ${n === 1 ? 'Hand' : 'Hands'} Remaining`;
}

/** The seat-side count label: shown after every hand while hands are owed. */
export const HIT_RUN_COUNT_LABEL = 'Hands Before You Can Leave';

export function blindOffLeaveText(hands: number): string {
  const n = Math.max(1, Math.floor(hands));
  return `You Are Blinded Off For The Remaining ${n} ${n === 1 ? 'Hand' : 'Hands'}. Your Chips Return To Your Wallet When They Are Played`;
}

/** A positive whole hand count, or null for "none owed" / unknown. */
export function owedHands(value: unknown): number | null {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The caller's hands still owed at one table (a classic table, or a Lightning
 * player's anchor table). Null when none are owed AND when the answer could
 * not be read: the engine's door decides either way, so an unreadable status
 * never blocks a leave on its own.
 */
export async function fetchMyHandsOwed(tableId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('fn_my_hit_run_status', { p_table_id: tableId });
    if (error || !Array.isArray(data)) return null;
    let most: number | null = null;
    for (const row of data as Array<Record<string, unknown>>) {
      if (row?.table_id !== tableId) continue;
      const n = owedHands(row.hands_remaining);
      if (n !== null && (most === null || n > most)) most = n;
    }
    return most;
  } catch {
    return null;
  }
}
