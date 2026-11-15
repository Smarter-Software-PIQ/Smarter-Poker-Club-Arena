import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { masterBus } from '../../core/MasterBus';
import { reportError } from '../../utils/errorReporter';

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
    async function refresh() {
      const request = ++serial;
      try {
        const { data, error } = await supabase.rpc('ca_player_menu_cash_stats', {
          p_table_id: tableId,
          p_player_id: playerId,
        });
        if (request !== serial) return;
        if (error) throw error;
        setGames(Array.isArray(data) ? data : []);
      } catch (error) {
        if (request !== serial) return;
        setGames([]);
        reportError(error, 'PlayerCashStats.read');
      }
    }
    void refresh();
    const unsubscribe = expanded
      ? [
          masterBus.subscribe('HAND_COMPLETED', refresh),
          masterBus.subscribe('CHIPS_ADDED', refresh),
          masterBus.subscribe('SESSION_ENDED', refresh),
          masterBus.subscribe('WS_CONNECTED', refresh),
        ]
      : [];
    return () => {
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
              Bought in {game.boughtIn ?? 'Unavailable'} · Up / Down{' '}
              {game.net == null ? 'Pending' : (game.net > 0 ? '+' : '') + game.net}
            </div>
            <div>
              {game.hands} hands · VPIP {game.vpip == null ? '—' : game.vpip + '%'} · PFR{' '}
              {game.pfr == null ? '—' : game.pfr + '%'}
            </div>
          </div>
        ))}
    </section>
  );
}
