import { formatWalletChips } from '../utils/format';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FLASH POOL PAGE — Fast-Fold Poker Lobby
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Entry point for the Flash Pool (fast-fold) poker experience:
 * - Browse active flash pools by stakes
 * - Join a pool with configurable buy-in
 * - Live player count + tables running
 * - Connects to FlashPoolEngine for instant fold → reassign flow
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useIsMounted } from '../hooks/useIsMounted';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { masterBus } from '../core/MasterBus';
// [MIGRATION] flashPoolEngine removed — server-authoritative (join via Supabase RPC)
import { useAuthUser } from '../hooks/useAuthUser';
import { useToast } from '../components/common/Toast';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';
import PageSkeleton from '../components/common/PageSkeleton';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import '../components/ops/ArenaOps.css';
import './FlashPoolPage.css';
import { reportError } from '../utils/errorReporter';
import { resolvePageClubId } from '../utils/resolvePageClubId';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface PoolDisplay {
  poolId: string;
  stakes: string;
  smallBlind: number;
  bigBlind: number;
  activePlayers: number;
  tablesRunning: number;
  buyInMin: number;
  buyInMax: number;
  status: 'active' | 'waiting' | 'closed';
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function FlashPoolPage() {
  const navigate = useNavigate();
  /* Explicit, because `location.search` without this resolves to the GLOBAL
     `window.location` — which type-checks, reads correctly on first paint, and
     is not part of React's render cycle, so the dependency below would be
     lying about what it tracks. */
  const location = useLocation();
  const { user } = useAuthUser();
  const toast = useToast();
  useVisibilityRefresh(() => loadPools());

  const [loading, setLoading] = useState(true);
  const [pools, setPools] = useState<PoolDisplay[]>([]);
  const [joiningPool, setJoiningPool] = useState<string | null>(null);
  const [buyInAmounts, setBuyInAmounts] = useState<Record<string, number>>({});
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const isMounted = useIsMounted();

  const loadingRef = useRef(false);

  // ── Load available pools ──
  const loadPools = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { data, error } = await supabase
        .from('flash_pools')
        .select(
          'id, small_blind, big_blind, active_players, tables_running, buy_in_min, buy_in_max, status'
        )
        .in('status', ['active', 'waiting'])
        .order('big_blind', { ascending: true });

      if (error) throw error;

      const poolList: PoolDisplay[] = (data || []).map((row: any) => ({
        poolId: row.id,
        stakes: `${row.small_blind}/${row.big_blind}`,
        smallBlind: row.small_blind,
        bigBlind: row.big_blind,
        activePlayers: row.active_players || 0,
        tablesRunning: row.tables_running || 0,
        buyInMin: row.buy_in_min || row.big_blind * 40,
        buyInMax: row.buy_in_max || row.big_blind * 200,
        status: row.status || 'active',
      }));

      if (!isMounted.current) return;
      setPools(poolList);
    } catch (err) {
      reportError(err, 'FlashPoolPage.Failed_to_load_pools');
      if (!isMounted.current) return;
      toast.error('Failed to load pools');
      setPools([]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  /* ── THE BALANCE ON THIS PAGE BELONGS TO A CLUB ───────────────────────────
     `club_members.chip_balance` is PER CLUB. This read it with `.limit(1)`
     and no `.order()`, twice — once on mount and again on every
     BALANCE_UPDATED — so a player in more than one club saw an arbitrary
     club's chips, and the two copies could even disagree with each other
     after a refresh. On a page where those chips get spent, showing the wrong
     club's number is a money-facing bug, not a cosmetic one.

     Both copies are now one function that names the club first, through the
     same resolver every other global page uses: `?club=` if the URL carries
     it, else the club the player was last in. */
  const loadBalance = useCallback(async () => {
    if (!user?.id) return;
    try {
      const clubId = await resolvePageClubId({ search: location.search, userId: user.id });
      if (!clubId) {
        setUserBalance(0);
        return;
      }
      const { data, error } = await supabase
        .from('club_members')
        .select('chip_balance')
        .eq('user_id', user.id)
        .eq('club_id', clubId)
        .maybeSingle();
      if (error) throw error;
      setUserBalance(data?.chip_balance || 0);
    } catch (e) {
      reportError(e, 'FlashPoolPage.loadBalance');
      /* best effort */
    }
  }, [user?.id, location.search]);

  // ── Load user's chip balance ──
  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  // ── Bus listener: keep balance in sync when chips change on other pages ──
  useEffect(() => {
    if (!user?.id) return;
    const unsub = masterBus.subscribeDebounced('BALANCE_UPDATED', () => void loadBalance(), 500);
    return () => unsub();
  }, [user?.id, loadBalance]);

  // GAME_STATE_UPDATED listener removed 2026-08-28: nothing emits it on the
  // client bus, so this pool-stats patch never ran. The Supabase realtime
  // channel below is the live path that actually works.

  // ── Supabase real-time for live pool stats ──
  useEffect(() => {
    const channelKey = 'flash-pools-live';
    const channel = masterBus.getOrCreateChannel(channelKey);
    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'flash_pools' },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          setPools((prev) =>
            prev.map((p) =>
              p.poolId === row.id
                ? {
                    ...p,
                    activePlayers: row.active_players ?? p.activePlayers,
                    tablesRunning: row.tables_running ?? p.tablesRunning,
                    status: row.status ?? p.status,
                  }
                : p
            )
          );
        }
      )
      .subscribe((status: string, err?: Error) => {
        if (status === 'CHANNEL_ERROR') {
          if (err) reportError(err?.message || err, 'FlashPoolPage._Realtime_channel_error');
        }
        if (status === 'TIMED_OUT') {
          console.warn('[FlashPoolPage] Realtime channel timed out');
        }
      });

    return () => {
      masterBus.removeRegisteredChannel(channelKey);
    };
  }, []);

  /* Dan's ruling (2026-10-16/17): fast-fold play is Lightning only. This page
     is parked, and the join it used to call took the buy-in without ever
     seating the player (no engine seat, no refund path). The server no longer
     lets a client call it (20261024232449_flash_pool_join_never_takes_chips),
     and the page never asks: a Join here can never move a chip. */
  const handleJoinPool = useCallback(
    (_pool: PoolDisplay) => {
      toast.error('Flash Pools Are Not Open. Fast-Fold Play Is In Lightning Games.');
    },
    [toast]
  );

  if (loading) return <PageSkeleton />;

  /* #SmarterDesign batch D1 (2026-11-28): the arena workspace. Back is one
     chrome key above the mast (the gold title and tagline stay behind the
     chrome "?", Dan 2026-10-17); every pool is a chrome case with its stakes
     as the title, players and tables on readout tiles, the buy-in in a dark
     well and Play its one lit key. Play still never joins (see above). */
  return (
    <div className="arena-workspace flash-pool-page">
      <div className="arena-switch flash-pool-page__back">
        <button type="button" onClick={() => navigate(-1)}>
          ← Back
        </button>
      </div>
      <ArenaWorkspaceHeader
        area="dashboard"
        title="Flash Pool"
        summary="Fast-Fold Poker. Fold Instantly, Get New Cards."
        steps={[
          {
            title: 'How It Works',
            body: 'Fold Instantly, Move To A New Table And Get New Cards. No Waiting For The Hand To Finish.',
          },
          {
            title: 'Pick A Pool',
            body: 'Each Pool Shows Its Stakes, Buy-In Range, Players And Tables. Enter A Buy-In And Tap Play.',
            target: '[data-flash-pools]',
          },
        ]}
      />

      <div data-flash-pools className="flash-pool-page__pools">
        {pools.map((pool) => (
          <section key={pool.poolId} className="arena-case arena-ops-case flash-pool-case">
            <h2 className="arena-section-title">{pool.stakes}</h2>
            <div className="flash-pool-case__body">
              <div className="flash-pool-case__terms">
                <p className="flash-pool-case__line">
                  Buy-In: {pool.buyInMin.toLocaleString()} - {pool.buyInMax.toLocaleString()}
                </p>
                {userBalance !== null && (
                  <p className="flash-pool-case__line flash-pool-case__balance">
                    Your Balance: {formatWalletChips(userBalance)} Chips
                  </p>
                )}
              </div>
              <dl className="flash-pool-case__meters">
                <div
                  className="arena-meter"
                  data-tone={pool.activePlayers > 0 ? 'live' : undefined}
                >
                  <dt>Players</dt>
                  <dd>{pool.activePlayers}</dd>
                </div>
                <div className="arena-meter">
                  <dt>Tables</dt>
                  <dd>{pool.tablesRunning}</dd>
                </div>
              </dl>
            </div>
            <div className="flash-pool-case__join">
              <input
                className="arena-ops-well"
                type="number"
                placeholder={`Buy-In (${pool.buyInMin})`}
                min={pool.buyInMin}
                max={pool.buyInMax}
                value={buyInAmounts[pool.poolId] || ''}
                onChange={(e) =>
                  setBuyInAmounts((prev) => ({
                    ...prev,
                    [pool.poolId]: e.target.value === '' ? 0 : Number(e.target.value),
                  }))
                }
              />
              <div className="arena-switch arena-ops-primary">
                <button
                  type="button"
                  onClick={() => handleJoinPool(pool)}
                  disabled={joiningPool === pool.poolId || pool.status === 'closed'}
                >
                  {joiningPool === pool.poolId ? '◷' : pool.status === 'closed' ? 'Closed' : 'Play'}
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>

      {pools.length === 0 && (
        <section className="arena-case arena-ops-case flash-pool-empty">
          <p className="flash-pool-empty__title">No Flash Pools Available Yet.</p>
          <p className="arena-ops-copy">Check Back Soon!</p>
        </section>
      )}
    </div>
  );
}
