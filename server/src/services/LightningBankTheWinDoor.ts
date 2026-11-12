/**
 * The Leave door for LightningBankTheWin (owner 2026-11-10, 2026-11-11).
 *
 * Each ask from the pre-filter is decided from the database's facts
 * (fn_lightning_bank_the_win_reading): the durable start basis and orbit
 * counter, every hand owed under the Charles Rule, and the pool's real big
 * blind order. A horse that is due stands up from its anchor seat through the
 * ordinary `leaveTable` door a person uses (hit-and-run and receipt included).
 *
 * Retries are bounded and idempotent. A refusal (`success: false`) is a
 * definite answer: one failed attempt, asked again on a later hand. A thrown
 * or timed-out call is UNCERTAIN: the leave may have committed. It is never
 * resent blindly; the reading is taken again first, and only a seat that is
 * verifiably still seated and not leaving counts it as a failed attempt. The
 * tracker stops after MAX_LEAVE_ATTEMPTS. Leader-owned: started and stopped
 * with the other horse services in index.ts.
 */
import { supabase } from './supabase/client.js';
import { reportError } from './errorReporter.js';
import {
  decideLightningBankTheWin,
  onLightningBankTheWin,
  type LightningBankReading,
} from '../lightning/LightningBankTheWin.js';

interface LeaveDoorEngine {
  leaveTable(userId: string): Promise<{ success?: boolean; error?: string } | null | undefined>;
}

async function readFacts(
  clusterId: string,
  playerId: string
): Promise<LightningBankReading | null> {
  const { data, error } = await supabase.rpc('fn_lightning_bank_the_win_reading', {
    p_cluster_id: clusterId,
    p_player_id: playerId,
  });
  if (error || !data || typeof data !== 'object') return null;
  return data as LightningBankReading;
}

export function startLightningBankTheWin(
  getEngine: (tableId: string) => LeaveDoorEngine | null | undefined
): void {
  onLightningBankTheWin(({ clusterId, playerId, settle }) => {
    void (async () => {
      let facts: LightningBankReading | null = null;
      try {
        facts = await readFacts(clusterId, playerId);
      } catch (err) {
        reportError(err, 'LightningBankTheWin.read');
      }
      if (!facts) return settle('not_ready'); // could not tell: ask again on a later hand
      const basis = facts.start_basis ?? null;
      const verdict = decideLightningBankTheWin(playerId, facts);
      if (verdict !== 'leave') return settle(verdict, basis);
      const tableId = facts.table_id;
      const engine = tableId ? getEngine(tableId) : undefined;
      if (!tableId || !engine) return settle('not_ready', basis);
      try {
        const res = await engine.leaveTable(playerId);
        if (res?.success) {
          console.log(
            `[BankTheWin] Lightning horse ${playerId.slice(0, 8)} booked its win and left ${tableId.slice(0, 8)}`
          );
          return settle('done', basis);
        }
        return settle('attempt_failed', basis); // a definite refusal
      } catch (err) {
        // UNCERTAIN: the leave may have committed. Verify before counting it.
        reportError(err, 'LightningBankTheWin.leave');
        let after: LightningBankReading | null = null;
        try {
          after = await readFacts(clusterId, playerId);
        } catch {
          after = null;
        }
        // Gone from the seat or already leaving: it committed. Never resend.
        if (after && (!after.found || after.leave_pending)) return settle('done', basis);
        return settle('attempt_failed', basis);
      }
    })();
  });
}

export function stopLightningBankTheWin(): void {
  onLightningBankTheWin(null);
}
