import { tournamentAddOnEntryBoundaryPassed } from '../utils/tournamentAddOnBoundary';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { subscribeTournamentStandings } from '../services/tournamentStandingsUpdates';
import { reportError } from '../utils/errorReporter';
import { serverNow } from '../utils/serverClock';

export interface TournamentAddOnBreak {
  phase: 'last_hand' | 'counting_down';
  endsAtMs: number | null;
  cost: number;
  chips: number;
}

/** The public pause notice is independent of the viewer's purchase entitlement.
 * Free Buy's early offer is not a break: its owner replaces that window only
 * after every dealer parks. Read that durable closing minute, never infer it
 * from the early entitlement's approaching deadline.
 */
export function useTournamentAddOnBreak(tournamentId: string | null | undefined) {
  const [shown, setShown] = useState<(TournamentAddOnBreak & { tournamentId: string }) | null>(
    null
  );
  useEffect(() => {
    setShown(null);
    if (!tournamentId) return;
    let active = true;
    let reading = false;
    let pending = false;
    let boundary: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!active) return;
      if (reading) {
        pending = true;
        return;
      }
      reading = true;
      pending = false;
      try {
        const { data: row, error } = await supabase
          .from('tournaments')
          .select(
            'current_level, late_reg_levels, rebuy_levels, late_reg_mins, started_at, status, add_on_available, addon_from_start, addon_period_triggered, addon_period_started_at, addon_period_ends_at, prize_pool_finalized, addon_cost, addon_chips, buy_in_amount, starting_chips'
          )
          .eq('id', tournamentId)
          .maybeSingle();
        if (!active || pending) return;
        if (boundary) clearTimeout(boundary);
        boundary = undefined;
        if (error) throw error;
        const start = Date.parse(String(row?.addon_period_started_at ?? ''));
        const end = Date.parse(String(row?.addon_period_ends_at ?? ''));
        const cost = Number(row?.addon_cost || row?.buy_in_amount);
        /* AN ADD-ON PAYS THE STARTING STACK, EXACTLY (Dan 2026-11-01): "THE
           ADD ON SHOULD BE THE SAME AMOUNT OF CHIPS THAT YOU START WITH IN THE
           TOURNAMENT, NEVER LESS" and it "CAN NEVER EXCEED" it. The starting
           stack is the authority; addon_chips is only a fallback for a legacy
           row with no starting stack. */
        const chips = Number(row?.starting_chips || row?.addon_chips);
        const entryClosed = tournamentAddOnEntryBoundaryPassed(row, serverNow());
        const awaitingLastHand =
          entryClosed &&
          row?.add_on_available === true &&
          row.prize_pool_finalized !== true &&
          (row.addon_period_triggered === false ||
            (row.addon_from_start === true &&
              row.addon_period_triggered === true &&
              row.addon_period_started_at === null &&
              row.addon_period_ends_at === null));
        const eligible =
          row?.status === 'RUNNING' &&
          entryClosed &&
          row.add_on_available === true &&
          row.addon_period_triggered === true &&
          row.prize_pool_finalized !== true &&
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          end > start &&
          Number.isFinite(cost) &&
          cost > 0 &&
          Number.isFinite(chips) &&
          chips > 0 &&
          !(row.addon_from_start === true && end - start > 60_000);
        const paint = () => {
          if (!active) return;
          const now = serverNow();
          if (
            awaitingLastHand &&
            Number.isFinite(cost) &&
            cost > 0 &&
            Number.isFinite(chips) &&
            chips > 0
          ) {
            setShown({ tournamentId, phase: 'last_hand', endsAtMs: null, cost, chips });
            return;
          }
          if (!eligible || now >= end) {
            setShown(null);
            return;
          }
          const noticeStarts = Math.max(start, end - 60_000);
          if (now < noticeStarts) {
            setShown(null);
            boundary = setTimeout(paint, noticeStarts - now);
            return;
          }
          setShown({ tournamentId, phase: 'counting_down', endsAtMs: end, cost, chips });
          boundary = setTimeout(paint, end - now);
        };
        paint();
      } catch (error) {
        if (active && !pending) {
          if (boundary) clearTimeout(boundary);
          boundary = undefined;
          setShown(null);
          reportError(error, 'useTournamentAddOnBreak.load', { tournamentId });
        }
      } finally {
        reading = false;
        if (active && pending) void load();
      }
    };
    const stop = subscribeTournamentStandings(tournamentId, () => void load());
    void load();
    return () => {
      active = false;
      stop();
      if (boundary) clearTimeout(boundary);
    };
  }, [tournamentId]);
  return shown?.tournamentId === tournamentId ? shown : null;
}
