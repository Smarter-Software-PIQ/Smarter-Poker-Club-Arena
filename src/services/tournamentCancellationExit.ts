import { fetchTournamentResult, type TournamentResultRead } from './tournamentResult';
import { supabase } from '../lib/supabase';
import { awaitTournamentResultEnrichment } from '../utils/tournamentResultEnrichment';
import { reportError } from '../utils/errorReporter';

/** Cancellation settlement preserves earned ranks and qualification records. */
export function isUnrankedTournamentCancellation(
  result:
    | {
        tournamentStatus?: unknown;
        finishPlace?: unknown;
        satelliteQualification?: unknown;
      }
    | null
    | undefined
): boolean {
  return (
    result?.tournamentStatus === 'CANCELLED' &&
    !result.satelliteQualification &&
    !(Number.isInteger(result.finishPlace) && Number(result.finishPlace) > 0)
  );
}

/** A committed cancellation is terminal, but a participant's still-live or
 * unreadable seat must not be mistaken for a released seat. Observers require
 * no entrant/result row. This performs reads only, never cash-out or refund. */
export async function exitCancelledTournament(input: {
  tournamentStatus: unknown;
  tableId: string;
  tournamentId: string;
  userId: string | null | undefined;
  isCurrent: () => boolean;
  onExit: () => void;
  onResult: (result: TournamentResultRead) => void;
}): Promise<boolean> {
  if (input.tournamentStatus !== 'CANCELLED' || !input.isCurrent()) return false;
  let result: TournamentResultRead | undefined;
  if (input.userId && input.userId !== 'guest') {
    try {
      result = await awaitTournamentResultEnrichment(
        fetchTournamentResult(input.tournamentId, input.userId)
      );
      // The result reader returns an unknown fallback on error. That is never
      // an absent entrant, an unranked cancellation, or permission to discard
      // an already scheduled earned result.
      if (!result || result.tournamentStatus !== 'CANCELLED' || !input.isCurrent()) return false;
      if (result.entryStatus === 'playing' || result.entryStatus === 'registered') return false;
      if (
        !isUnrankedTournamentCancellation(result) &&
        !['winner', 'eliminated'].includes(result.entryStatus ?? '')
      )
        return false;
      const seats = await awaitTournamentResultEnrichment(
        supabase
          .from('table_seats')
          .select('id')
          .eq('table_id', input.tableId)
          .eq('user_id', input.userId)
          .is('left_at', null)
          .limit(1)
      );
      if (!seats || seats.error || !Array.isArray(seats.data)) {
        throw seats?.error ?? new Error('Cancelled Tournament Seat Read Unavailable');
      }
      if (seats.data.length > 0) return false;
    } catch (error) {
      reportError(error, 'TablePage.cancelled_tournament_seat_unreadable');
      return false;
    }
  }
  if (!input.isCurrent()) return false;
  if (result && !isUnrankedTournamentCancellation(result)) input.onResult(result);
  else input.onExit();
  return true;
}
