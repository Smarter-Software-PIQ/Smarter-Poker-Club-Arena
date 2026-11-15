import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { masterBus } from '../../core/MasterBus';
import { reportError } from '../../utils/errorReporter';
import './ThrowableSelector.css';

interface CashGameStats {
  tableId: string;
  table: string;
  unit: 'chips' | 'diamonds';
  boughtIn: number | null;
  net: number | null;
  hands: number;
  vpip: number | null;
  pfr: number | null;
}

export function PlayerCashStats({ tableId, playerId }: { tableId: string; playerId: string }) {
  const [games, setGames] = useState<CashGameStats[]>([]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let serial = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    async function read(attempt: number) {
      clearTimeout(retryTimer);
      const request = ++serial;
      try {
        const { data, error } = await supabase.rpc('ca_player_menu_cash_stats', {
          p_table_id: tableId,
          p_player_id: playerId,
        });
        if (request !== serial) return;
        if (error) throw error;
        const rows: CashGameStats[] = Array.isArray(data) ? data : [];
        setGames(rows);
        // Completion can precede the per-player hand facts by one database commit.
        if (expanded && attempt < 2 && rows.some((game) => game.net === null)) {
          retryTimer = setTimeout(() => void read(attempt + 1), 1000);
        }
      } catch (error) {
        if (request !== serial) return;
        setGames([]);
        reportError(error, 'PlayerCashStats.read');
      }
    }
    const refresh = () => void read(0);
    refresh();
    const unsubscribe = expanded
      ? [
          masterBus.subscribe('HAND_COMPLETED', refresh),
          masterBus.subscribe('CHIPS_ADDED', refresh),
          masterBus.subscribe('SESSION_ENDED', refresh),
          masterBus.subscribe('WS_CONNECTED', refresh),
        ]
      : [];
    return () => {
      clearTimeout(retryTimer);
      serial++;
      unsubscribe.forEach((stop) => stop());
    };
  }, [tableId, playerId, expanded]);
  if (!games.length) return null;
  return (
    <section className="player-cash-stats">
      <button
        type="button"
        className="throwable-selector__tab"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Player Stats
      </button>
      {expanded &&
        games.map((game) => (
          <div key={game.tableId} className="player-cash-stats__game">
            <strong>
              {game.table} · {game.unit}
            </strong>
            <div>
              Bought In {game.boughtIn ?? 'Unavailable'} · Up / Down{' '}
              {game.net == null ? 'Pending' : (game.net > 0 ? '+' : '') + game.net}
            </div>
            <div>
              {game.hands} Hands · VPIP {game.vpip == null ? 'N/A' : game.vpip + '%'} · PFR{' '}
              {game.pfr == null ? 'N/A' : game.pfr + '%'}
            </div>
          </div>
        ))}
    </section>
  );
}
