import { useCashGameLobby } from './useCashGameLobby';
import { CASH_CLUSTER_HUD_POLL_MS } from './CashClusterHUD';
import { WaitlistCallToAction } from './WaitlistCallToAction';

/** The game lobby owns a cluster's entry queue, never table_waitlist. */
export function ClusterWaitlistCallToAction({
  gameId,
  onClick,
  refreshKey = 0,
  enabled = true,
}: {
  gameId: string;
  onClick: () => void;
  refreshKey?: number;
  enabled?: boolean;
}) {
  const { lobby, error } = useCashGameLobby(gameId, enabled, CASH_CLUSTER_HUD_POLL_MS, refreshKey);
  const waiting = lobby?.waitlist?.waiting;
  const countKnown = typeof waiting === 'number' && Number.isSafeInteger(waiting) && waiting >= 0;
  const mine = lobby?.me?.seated ? null : lobby?.me?.waitlist;
  /* A must-move game is ONE game: a chair open at any live table of it is a
     seat a player can take now (the game's Join door seats them there), so a
     full table of a game with such a chair never reads "0 Waiting". The count
     is the database's own open_seats, which already leaves out held chairs. */
  const openElsewhere = (lobby?.tables ?? []).reduce((sum, table) => {
    const open = Number(table?.open_seats);
    const live = table?.lifecycle === 'live' || table?.lifecycle === 'opening';
    return live && Number.isSafeInteger(open) && open > 0 ? sum + open : sum;
  }, 0);
  return (
    <WaitlistCallToAction
      onClick={onClick}
      waitingCount={countKnown ? waiting : 0}
      position={mine?.on_list ? mine.position : null}
      onList={mine?.on_list === true}
      openElsewhere={openElsewhere}
      queueState={countKnown ? undefined : error ? 'unavailable' : 'loading'}
    />
  );
}
