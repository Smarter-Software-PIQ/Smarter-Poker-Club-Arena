/**
 * A RETAINED HAND A REPLACEMENT ENGINE COMMITS IS COUNTED (2026-11-12,
 * HVH2D-EXE-002, the verifier's follow-up to #10640).
 *
 * `fn_ca_resume_hand_submission` commits a retained original through the same
 * door as every other hand, so the exact-memory trigger fires inside that call
 * on the row the ORIGINAL engine built. That engine's `logHandHistory` threw
 * before its own count (the hand was retained because its commit could not be
 * proved), so the hand was on neither side of the signal.
 *
 * `resumeRetainedHandSubmission` calls this only when the door answers
 * `financial_handoff: true`, which it does for the one call whose transaction
 * made the commit; any later call finds the receipt and answers false. The
 * resume answer carries no row facts, so the four columns the trigger reads
 * are read back from the stored row: one primary-key read per handed-off
 * hand, and a read only (the row is written by the accepted-hand transaction
 * and nowhere else). Not awaited, and it cannot throw: a failed or empty read
 * leaves the hand uncounted and the admission exactly as it was.
 */
import { supabase } from './client.js';
import { countStoredHandMemoryDomain } from './handMemoryDomainSignal.js';

export function countHandedOffHandMemoryDomain(handId: string): void {
  void (async () => {
    try {
      const { data, error } = await supabase
        .from('hand_history')
        .select('public_memory_domain,game_variant,tournament_id,showdown')
        .eq('id', handId)
        .maybeSingle();
      if (!error) countStoredHandMemoryDomain(data);
    } catch {
      /* a signal must never endanger an accepted hand */
    }
  })();
}
