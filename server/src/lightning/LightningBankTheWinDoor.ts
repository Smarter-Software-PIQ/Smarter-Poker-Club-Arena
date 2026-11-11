/**
 * The Leave door for LightningBankTheWin (owner 2026-11-10): a horse that
 * books its win between pool hands stands up from its anchor seat through the
 * ordinary `leaveTable` door a person uses (hit-and-run and receipt included).
 * A refused or failed leave re-arms the tracker for the next pool hand.
 * Leader-owned: started and stopped with the other horse services in index.ts.
 */
import { supabase } from '../services/supabase/client.js';
import { reportError } from '../services/errorReporter.js';
import { onLightningBankTheWin } from './LightningBankTheWin.js';

interface LeaveDoorEngine {
  leaveTable(userId: string): Promise<{ success?: boolean } | null | undefined>;
}

export function startLightningBankTheWin(
  getEngine: (tableId: string) => LeaveDoorEngine | null | undefined
): void {
  onLightningBankTheWin(({ clusterId, playerId, release }) => {
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('table_seats')
          .select('table_id, tables!table_seats_table_id_fkey!inner(cluster_id)')
          .eq('user_id', playerId)
          .is('left_at', null)
          .eq('tables.cluster_id', clusterId)
          .limit(1)
          .maybeSingle();
        const tableId = !error ? (data as { table_id?: string } | null)?.table_id : undefined;
        const engine = tableId ? getEngine(tableId) : undefined;
        if (!tableId || !engine) return release();
        const res = await engine.leaveTable(playerId);
        if (!res?.success) return release();
        console.log(
          `[BankTheWin] Lightning horse ${playerId.slice(0, 8)} booked its win and left ${tableId.slice(0, 8)}`
        );
      } catch (err) {
        release();
        reportError(err, 'LightningBankTheWin.leave');
      }
    })();
  });
}

export function stopLightningBankTheWin(): void {
  onLightningBankTheWin(null);
}
