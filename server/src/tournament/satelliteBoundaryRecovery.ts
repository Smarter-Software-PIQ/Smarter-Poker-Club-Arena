import { supabase } from '../services/supabase.js';

export type SatelliteBoundaryProgress =
  | { kind: 'hand'; handId: string; tableId: string; startedAt: number }
  | { kind: 'settlement'; receiptVersion: number; settledAt: string; payoutIds: string[] };

/** Only the original episode may be closed, including after manager adoption. */
export async function observeSatelliteBoundaryProgress(
  tournamentId: string,
  progress: SatelliteBoundaryProgress,
  stillCurrent: () => boolean
): Promise<boolean> {
  const source = 'Tournament.satellite_boundary_held';
  const { data, error } = await supabase
    .from('financial_alerts')
    .select('id,created_at,context')
    .eq('source', source)
    .eq('context->>dedupe_key', `satellite-boundary-held:${tournamentId}`)
    .eq('resolved', false)
    .maybeSingle();
  if (error) throw error;
  if (!data) return true;

  if (progress.kind === 'hand') {
    const since = Math.max(
      Date.parse(data.created_at),
      Date.parse(data.context?.held_since ?? data.created_at)
    );
    if (
      !(progress.startedAt > since) ||
      (data.context?.blocked_table_id && data.context.blocked_table_id !== progress.tableId)
    )
      return false;
  }
  if (!stillCurrent()) return false;
  const at = new Date().toISOString();
  const resolution =
    progress.kind === 'hand'
      ? `Committed hand ${progress.handId} at table ${progress.tableId} after the qualifier hold.`
      : `Verified satellite settlement v${progress.receiptVersion} for ${tournamentId} at ${progress.settledAt}.`;
  const result = await supabase
    .from('financial_alerts')
    .update({
      resolved: true,
      resolved_at: at,
      resolution,
      context: { ...data.context, recovery_evidence: progress },
    })
    .eq('id', data.id)
    .eq('source', source)
    .eq('resolved', false)
    .eq('context', JSON.stringify(data.context))
    .select('id')
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.id === data.id;
}
