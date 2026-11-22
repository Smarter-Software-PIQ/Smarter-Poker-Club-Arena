import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { reportError } from '../../utils/errorReporter';
import { useAppNavigate } from '../../context/InTabLobbyContext';
import {
  findNextOpenGame,
  inviteLandingState,
  nextOpenGamePath,
  openGamesListPath,
  readWhenFullGame,
  type NextOpenGame,
  type WhenFullGameRow,
} from '../../lib/nextOpenGame';
import { SpadeConsole } from '../console/SpadeConsole';
import './TableLoadFailureOverlay.css';

interface InviteLandedLateOverlayProps {
  /**
   * True only for an arrival by invite link (`?i=` or `?invite=`) at a
   * tournament table where the viewer holds no seat. The overlay then asks the
   * game itself before it draws anything.
   */
  active: boolean;
  tableId: string;
  tournamentId: string | null | undefined;
  userId: string | null | undefined;
}

/**
 * THE INVITED GAME ALREADY STARTED (2026-11-22, src/lib/nextOpenGame.ts).
 *
 * A friend who opens a table invite after the game filled used to be shown
 * the felt with two other players seated and nothing else: no word that the
 * game they were invited to had started, and no way to the open one. This is
 * that word and that way, on the spade console the unavailable-table notice
 * already uses. It is drawn only when the game row says the game can no
 * longer be entered AND the viewer holds no entry in it, so a player who is
 * in the game never sees it. Watching stays one tap away, and nothing is
 * bought or seated here.
 */
export function InviteLandedLateOverlay({
  active,
  tableId,
  tournamentId,
  userId,
}: InviteLandedLateOverlayProps) {
  const navigate = useAppNavigate();
  const [gone, setGone] = useState<{
    tableId: string;
    origin: WhenFullGameRow;
    next: NextOpenGame | null;
  } | null>(null);
  const [dismissedTableId, setDismissedTableId] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !tournamentId || !userId || userId === 'guest') return;
    let alive = true;
    void (async () => {
      try {
        const origin = await readWhenFullGame(tournamentId);
        if (!alive || !origin) return;
        const { data: entry, error } = await supabase
          .from('tournament_players')
          .select('id')
          .eq('tournament_id', tournamentId)
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();
        // An unreadable entry is not "no entry": say nothing rather than tell
        // a player who may be in this game that it started without them.
        if (!alive || error) return;
        if (inviteLandingState(origin, Boolean(entry)) !== 'gone') return;
        const next = await findNextOpenGame(origin);
        if (alive) setGone({ tableId, origin, next });
      } catch (err) {
        reportError(err, 'InviteLandedLateOverlay.read_failed', { tableId, tournamentId });
      }
    })();
    return () => {
      alive = false;
    };
  }, [active, tableId, tournamentId, userId]);

  if (!active || !gone || gone.tableId !== tableId || dismissedTableId === tableId) return null;

  return (
    <div className="table-load-failure-overlay" role="alert" data-testid="invite-landed-late">
      <div className="table-load-failure-box ac-popup">
        <SpadeConsole
          as="div"
          eyebrow="Your Invite"
          title="Game Already Started"
          titleId="invite-landed-late-title"
          pill="Full"
          pillInk="muted"
          plates={{
            secondary: {
              label: 'Watch This Game',
              onClick: () => setDismissedTableId(tableId),
            },
            primary: {
              label: gone.next ? 'Play New Game' : 'Browse Open Games',
              ink: 'white',
              onClick: () => {
                setDismissedTableId(tableId);
                navigate(gone.next ? nextOpenGamePath(gone.next) : openGamesListPath(gone.origin));
              },
            },
          }}
        >
          <p className="sc-copy sc-copy--center table-load-failure__body">
            {gone.next
              ? 'The Game You Were Invited To Filled And Started. A New One Is Open Now. Nothing Was Charged And No Seat Was Taken.'
              : 'The Game You Were Invited To Filled And Started. No New One Is Open Yet. Nothing Was Charged And No Seat Was Taken.'}
          </p>
        </SpadeConsole>
      </div>
    </div>
  );
}

export default InviteLandedLateOverlay;
