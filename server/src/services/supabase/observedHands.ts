import { supabase } from './client.js';
import { reportError } from '../errorReporter.js';

/** Only the authenticated transport supplies viewers, never a client request. */
export async function recordObservedHands(
  table: string,
  hand: string,
  number: number,
  viewers: string[]
): Promise<boolean> {
  if (!viewers.length) return true;
  try {
    const { error } = await supabase.from('ca_observed_hands').upsert(
      viewers.map((viewer) => ({
        viewer_id: viewer,
        hand_id: hand,
        table_id: table,
        hand_number: number,
      })),
      { onConflict: 'viewer_id,table_id,hand_id', ignoreDuplicates: true }
    );
    if (error) throw error;
    return true;
  } catch (error) {
    reportError(error, 'recordObservedHands');
    return false;
  }
}
