import type { NavigateFunction } from 'react-router-dom';
import haptic from '../../services/HapticService';
import { PlayerSearchService, type MemberLiveTable } from '../../services/PlayerSearchService';
import { reportError } from '../../utils/errorReporter';
import { writePlayerFollow } from '../../utils/followTournamentPlayer';

/**
 * One tap from a roster surface to the observer view of a member's table
 * (Dan 2026-10-16: "THERE SHOULD BE A BUTTON TO EASILY CLICK TO BE REDIRECTED
 * AND WATCH THEM"). Shared by the player record's Watch At Table shell, the
 * roster row's table chip and the Live Now strip (2026-11-12), so every door
 * revalidates access through fn_get_table_watch_access before it routes.
 */
export type WatchOutcome =
  | { status: 'opened' }
  | { status: 'left' }
  | { status: 'refused'; message: string }
  | { status: 'error' };

export async function watchMemberTable(
  navigate: NavigateFunction,
  table: Pick<MemberLiveTable, 'table_id' | 'tournament_id'>,
  member: { userId: string; name: string }
): Promise<WatchOutcome> {
  try {
    const access = await PlayerSearchService.getTableWatchAccess(table.table_id, member.userId);
    if (access.can_watch) {
      haptic.success();
      if (table.tournament_id) {
        const params = new URLSearchParams({ observer: '1' });
        writePlayerFollow(params, {
          tournamentId: table.tournament_id,
          userId: member.userId,
          username: member.name,
        });
        navigate(`/table/${table.table_id}?${params.toString()}`);
      } else {
        navigate(`/table/${table.table_id}?observer=1`);
      }
      return { status: 'opened' };
    }
    haptic.error();
    if (!access.found) return { status: 'left' };
    if (access.action === 'observers_restricted') {
      return { status: 'refused', message: 'This Table Does Not Allow Observers.' };
    }
    return { status: 'refused', message: 'This Game Is Not Available To Watch.' };
  } catch (error) {
    reportError(error, 'watchMemberTable.WatchAccess');
    return { status: 'error' };
  }
}

export const WATCH_LEFT_MESSAGE = 'This Player Has Left The Table.';
export const WATCH_ERROR_MESSAGE = 'Could Not Verify Table Access. Please Try Again.';
