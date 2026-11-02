/**
 * IS THIS PREVIOUS HAND'S RUN-OUT ACTUALLY ON FILE? (2026-11-02)
 *
 * The replayer used to infer availability from the hand's age alone, so while
 * the engine that saves run-outs was not yet serving (or after a hand's saved
 * run-out was missing) a VIP saw a live "Show What Would Have Come" button
 * whose only possible answer was "No Longer Available" - which reads as "this
 * hand expired" when the truth was "this feature is not live yet".
 *
 * fn_rabbit_hunt_replay_status answers from the sealed rabbit_hunt_offers
 * table WITHOUT returning any card: whether this caller's hand is saved and
 * until when, whether they were dealt in, or - when no run-out at all has
 * been saved platform-wide recently - that previous-hand rabbit hunting is
 * not live. It decides nothing about money; the engine still does.
 */
import { supabase } from '../lib/supabase';

export type ReplayRabbitStatus =
  | { status: 'saved'; expiresAt: number }
  | { status: 'unavailable' | 'not_saved' | 'not_eligible' | 'expired' | 'signed_out' }
  | { status: 'error' };

export async function fetchReplayRabbitStatus(
  tableId: string,
  handNumber: number
): Promise<ReplayRabbitStatus> {
  try {
    const { data, error } = await supabase.rpc('fn_rabbit_hunt_replay_status', {
      p_table_id: tableId,
      p_hand_number: handNumber,
    });
    if (error || !data || typeof data !== 'object') return { status: 'error' };
    const row = data as { status?: string; expires_at?: string };
    if (row.status === 'saved') {
      const expiresAt = Date.parse(row.expires_at ?? '');
      return Number.isFinite(expiresAt) ? { status: 'saved', expiresAt } : { status: 'error' };
    }
    if (
      row.status === 'unavailable' ||
      row.status === 'not_saved' ||
      row.status === 'not_eligible' ||
      row.status === 'expired' ||
      row.status === 'signed_out'
    ) {
      return { status: row.status };
    }
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}
