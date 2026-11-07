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

/** THE CHARLES RULE, said the moment it adds hands. */
export function charlesRuleText(added: number): string {
  const n = Math.max(1, Math.floor(added));
  return `You Doubled Up. ${n} ${n === 1 ? 'Hand' : 'Hands'} Added Before You Can Leave`;
}

/**
 * Hands owed per table, as each TablePage last read them. The multi-table
 * container asks before it takes the player off a table (the tab's X), so the
 * confirmation can be shown on that table instead of behind the lobby.
 */
const owedByTable = new Map<string, number>();
export function noteHandsOwedAt(tableId: string, hands: number | null): void {
  if (!tableId) return;
  if (hands !== null && hands > 0) owedByTable.set(tableId, Math.floor(hands));
  else owedByTable.delete(tableId);
}
export function handsOwedAt(tableId: string): number | null {
  return owedByTable.get(tableId) ?? null;
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
  return (await fetchMyHandCount(tableId)).owed;
}

export interface HandCount {
  /** Hands still owed in profit; null: none (or unreadable). */
  owed: number | null;
  /** This countdown's total (10 plus 10 per double); null with nothing owed. */
  required: number | null;
}

/** The caller's count at one table, owed and total together. */
export async function fetchMyHandCount(tableId: string): Promise<HandCount> {
  const none: HandCount = { owed: null, required: null };
  try {
    const { data, error } = await supabase.rpc('fn_my_hit_run_status', { p_table_id: tableId });
    if (error || !Array.isArray(data)) return none;
    let best = none;
    for (const row of data as Array<Record<string, unknown>>) {
      if (row?.table_id !== tableId) continue;
      const n = owedHands(row.hands_remaining);
      if (n !== null && (best.owed === null || n > best.owed))
        best = { owed: n, required: owedHands(row.hands_required) };
    }
    return best;
  } catch {
    return none;
  }
}

/** The hand counts a club may choose (fn_set_club_hit_run accepts only these). */
export const HIT_RUN_HAND_CHOICES = [5, 10, 15, 20] as const;

export interface ClubHandCountSetting {
  enabled: boolean;
  hands: number;
  canEdit: boolean;
}

/** fn_club_hit_run_setting's answer; null when refused or malformed. */
export function parseClubHandCountSetting(data: unknown): ClubHandCountSetting | null {
  const d = data as { enabled?: unknown; hands?: unknown; can_edit?: unknown } | null;
  if (!d || typeof d !== 'object' || typeof d.enabled !== 'boolean') return null;
  const hands = Math.floor(Number(d.hands));
  if (!(HIT_RUN_HAND_CHOICES as readonly number[]).includes(hands)) return null;
  return { enabled: d.enabled, hands, canEdit: d.can_edit === true };
}

export function clubHandCountRefusalText(reason: string): string {
  switch (reason) {
    case 'not_a_club_admin':
      return 'Only A Club Owner, Co-Owner Or Admin Can Change This.';
    case 'not_signed_in':
      return 'You Are Signed Out. Sign In Again To Change This.';
    case 'club_not_found':
      return 'That Club No Longer Exists.';
    case 'hands_not_offered':
      return 'Choose 5, 10, 15 Or 20 Hands.';
    default:
      return 'The Hand Count Setting Could Not Be Saved. Nothing Changed.';
  }
}

/** Said once, the hand a countdown starts. */
export function countdownStartedText(hands: number): string {
  const n = Math.max(1, Math.floor(hands));
  return `You Are In Profit. Play ${n} ${n === 1 ? 'Hand' : 'Hands'} Before You Can Leave`;
}
