import { supabase } from '../lib/supabase';
import { readLocalSession } from '../lib/authUtils';
import { reportError } from '../utils/errorReporter';
import { runWithRequestDeadline } from '../utils/requestDeadline';

export const VPIP_HOUR_MS = 60 * 60 * 1000;
export interface TournamentVpipHand {
  played_at: string;
  vpip: boolean;
}

/** Private, settled, actually dealt hands in this tournament only. Never use
 * career/session rollups for the rolling-hour label. RLS independently enforces
 * the identity check; only the two required facts leave the database. */
export async function readTournamentHourVpip(
  tournamentId: string,
  userId: string,
  now: number
): Promise<TournamentVpipHand[] | null> {
  if (readLocalSession()?.userId !== userId) return null;
  try {
    const { data, count, error } = await runWithRequestDeadline((signal) =>
      supabase
        .from('ca_hand_facts')
        .select('played_at, vpip', { count: 'exact' })
        .eq('user_id', userId)
        .eq('tournament_id', tournamentId)
        .gte('seat', 1)
        .lte('seat', 10)
        .gte('players_dealt', 2)
        .gt('played_at', new Date(now - VPIP_HOUR_MS).toISOString())
        .lte('played_at', new Date(now).toISOString())
        .limit(1000)
        .abortSignal(signal)
    );
    // Refuse an incomplete sample, including PostgREST row-limit truncation.
    if (error || !data || count !== data.length) {
      reportError(error ?? new Error('Incomplete VPIP Sample'), 'readTournamentHourVpip');
      return null;
    }
    if (readLocalSession()?.userId !== userId) return null;
    if (
      data.some(
        (row) => typeof row.vpip !== 'boolean' || !Number.isFinite(Date.parse(row.played_at))
      )
    ) {
      reportError(new Error('Invalid VPIP Facts'), 'readTournamentHourVpip');
      return null;
    }
    return data as TournamentVpipHand[];
  } catch (error) {
    reportError(error, 'readTournamentHourVpip');
    return null;
  }
}

export function tournamentHourVpip(hands: TournamentVpipHand[], now: number) {
  const current = hands.filter((hand) => {
    const at = Date.parse(hand.played_at);
    return at > now - VPIP_HOUR_MS && at <= now;
  });
  const voluntary = current.filter((hand) => hand.vpip).length;
  return {
    hands: current.length,
    percent: current.length ? (100 * voluntary) / current.length : null,
    expiresAt: current.length
      ? Math.min(...current.map((hand) => Date.parse(hand.played_at) + VPIP_HOUR_MS))
      : null,
  };
}
