/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLUB STATS CARDS - Quick Overview Stats
 * Shows key metrics for club performance.
 * Data source: ca_club_dashboard_stats RPC (single round-trip), either
 * preloaded by the parent (stats prop) or self-loaded.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect } from 'react';
import { useIsMounted } from '../../hooks/useIsMounted';
import { supabase } from '../../lib/supabase';
import { isUUID, resolveClubUUID } from '../../utils/clubIdResolver';
import { isAuthzError } from '../../utils/clubDashboard';
import { masterBus } from '../../core/MasterBus';
import { ArenaReadings, ArenaState, type ArenaReading } from '../ops/ArenaOps';
import styles from './ClubStatsCards.module.css';
import { reportError } from '../../utils/errorReporter';
import { compactChips } from '../../utils/format';
import { titleCase } from '../../utils/titleCase';

export interface DailyPoint {
  d: string;
  hands: number;
  rake: number;
}

export interface DashboardStats {
  totalMembers: number;
  onlineNow: number;
  activeTables: number;
  totalTables: number;
  handsToday: number;
  rakeToday: number;
  weeklyGrowth: number;
  handsWeek: number;
  rakeWeek: number;
  seatedNow: number;
  dailySeries: DailyPoint[];
}

interface ClubStatsCardsProps {
  clubId: string;
  /**
   * Preloaded stats from the parent. Three states, not two:
   *   undefined  - no parent is loading these; the cards fetch for themselves;
   *   null       - the parent owns the read and it has not answered yet;
   *   object     - the parent's answer.
   * Until 2026-09-04 `null` was treated as `undefined`, so ClubDashboard,
   * which passes its own not-yet-loaded state, triggered a second
   * ca_club_dashboard_stats call on every mount (~910 ms and 132,855 buffers
   * each at the time) that the parent's answer then overwrote.
   */
  stats?: DashboardStats | null;
  /** The parent's read failed: say so instead of holding the skeleton. */
  failed?: boolean;
}

const EMPTY_STATS: DashboardStats = {
  totalMembers: 0,
  onlineNow: 0,
  activeTables: 0,
  totalTables: 0,
  handsToday: 0,
  rakeToday: 0,
  weeklyGrowth: 0,
  handsWeek: 0,
  rakeWeek: 0,
  seatedNow: 0,
  dailySeries: [],
};

/**
 * Inline 14-day sparkline. Rendered as a plain SVG path so the metric cards
 * gain trend context without pulling a chart library into this chunk.
 */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (!points.length || points.every((p) => p === 0)) return null;
  const w = 100;
  const h = 22;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(h - ((p - min) / span) * h).toFixed(2)}`
    )
    .join(' ');
  return (
    <svg
      className={styles.spark}
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function ClubStatsCards({
  clubId,
  stats: statsProp,
  failed = false,
}: ClubStatsCardsProps) {
  const selfLoading = statsProp === undefined;
  const [stats, setStats] = useState<DashboardStats>(statsProp || EMPTY_STATS);
  const [loading, setLoading] = useState(!statsProp);
  const isMounted = useIsMounted();

  // Parent-driven mode: mirror the prop whenever it changes. A null prop
  // means the parent is still reading, so the skeleton stays up.
  useEffect(() => {
    if (statsProp) {
      setStats(statsProp);
      setLoading(false);
    } else if (statsProp === null) {
      setLoading(true);
    }
  }, [statsProp]);

  // Self-loading mode: only when no parent owns the read at all.
  useEffect(() => {
    if (!selfLoading) return;
    loadStats();

    const reload = () => {
      loadStats();
    };

    const unsubscribes = [
      masterBus.subscribeDebounced('CLUB_JOINED', reload, 1000),
      masterBus.subscribeDebounced('CLUB_LEFT', reload, 1000),
      masterBus.subscribeDebounced('TABLE_CREATED', reload, 1000),
      masterBus.subscribeDebounced('TABLE_LEFT', reload, 1000),
      masterBus.subscribeDebounced('TABLE_SEATED', reload, 1000),
      masterBus.subscribeDebounced('CLUB_UPDATED', reload, 1000),
      masterBus.subscribeDebounced('TABLE_UPDATED', reload, 1000),
      masterBus.subscribeDebounced('TABLE_CLOSED', reload, 1000),
    ];

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, selfLoading]);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Resolve integer clubId to UUID for the RPC. resolveClubUUID returns
      // its input unchanged when it cannot resolve; a non-uuid would throw
      // 22P02 against the uuid-typed parameter, so bail instead.
      const resolvedId = await resolveClubUUID(clubId);
      if (!isUUID(resolvedId)) {
        if (isMounted.current) setLoading(false);
        return;
      }

      const { data, error } = await supabase.rpc('ca_club_dashboard_stats', {
        p_club_id: resolvedId,
      });
      if (error) throw error;

      if (data && isMounted.current) {
        setStats({
          totalMembers: data.total_members || 0,
          onlineNow: data.online_now || 0,
          activeTables: data.active_tables || 0,
          totalTables: data.total_tables || 0,
          handsToday: data.hands_today || 0,
          rakeToday: Number(data.rake_today) || 0,
          weeklyGrowth: data.new_this_week || 0,
          handsWeek: Number(data.hands_week) || 0,
          rakeWeek: Number(data.rake_week) || 0,
          seatedNow: data.seated_now || 0,
          dailySeries: Array.isArray(data.daily_series)
            ? data.daily_series.map((p: any) => ({
                d: String(p.d),
                hands: Number(p.hands) || 0,
                rake: Number(p.rake) || 0,
              }))
            : [],
        });
      }
    } catch (error: any) {
      // The membership gate raising 42501 is an expected outcome for a
      // non-member, not a fault worth reporting - the parent shows its own
      // Members Only state.
      if (!isAuthzError(error)) {
        reportError(error, 'ClubStatsCards.Failed_to_load_club_stats');
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  const formatInt = (num: number): string => {
    return Math.trunc(num).toLocaleString('en-US');
  };

  const formatChips = (num: number): string => {
    return compactChips(num);
  };

  /* #SmarterDesign (Dan 2026-11-27): the six readings print into the arena
     chrome tiles. Each tile still rises in 60ms after the one before it
     (ClubStatsCards.module.css), so the stagger plays every time they load. */
  const statCards: ArenaReading[] = [
    {
      id: 'members',
      label: 'Total Members',
      value: formatInt(stats.totalMembers),
    },
    {
      id: 'online',
      label: 'Online Now',
      value: formatInt(stats.onlineNow),
      tone: 'live',
      sub:
        stats.seatedNow > 0
          ? titleCase(`${formatInt(stats.seatedNow)} seated at tables`)
          : undefined,
    },
    {
      id: 'tables',
      label: 'Active Tables',
      value: formatInt(stats.activeTables),
      sub:
        stats.totalTables > stats.activeTables
          ? titleCase(`${formatInt(stats.totalTables)} total`)
          : undefined,
    },
    {
      // Every hand the engine finished today, tournament hands included
      // (club_hand_daily). The rake beside it is the ledger's cash rake
      // (ca_club_rake_daily), which is why the two are labelled apart.
      id: 'hands',
      label: 'Hosted Hands Today',
      value: formatInt(stats.handsToday),
      tone: 'live',
      sub: withSpark(
        stats.handsWeek > 0 ? titleCase(`${formatInt(stats.handsWeek)} this week`) : undefined,
        stats.dailySeries.map((p) => p.hands),
        '#45adff'
      ),
    },
    {
      id: 'rake',
      label: 'Cash Rake Today',
      value: formatChips(stats.rakeToday),
      tone: 'attention',
      sub: withSpark(
        stats.rakeWeek > 0 ? titleCase(`${formatChips(stats.rakeWeek)} this week`) : undefined,
        stats.dailySeries.map((p) => p.rake),
        '#ffd700'
      ),
    },
    {
      id: 'new',
      label: 'New This Week',
      value: `+${stats.weeklyGrowth}`,
    },
  ];

  if (failed && !statsProp) {
    return <ArenaState tone="error" title="The Club Metrics Could Not Be Loaded" />;
  }

  if (loading) {
    return (
      <ArenaReadings
        busy
        label="Club Metrics"
        className={styles.loading}
        readings={statCards.map((r) => ({ id: r.id, label: r.label, value: '' }))}
      />
    );
  }

  return <ArenaReadings label="Club Metrics" className={styles.readings} readings={statCards} />;
}

/** The week line with the 14-day trend drawn under it, when there is a trend. */
function withSpark(text: string | undefined, points: number[], color: string) {
  const hasTrend = points.length > 0 && !points.every((p) => p === 0);
  if (!text && !hasTrend) return undefined;
  return (
    <>
      {text}
      <Sparkline points={points} color={color} />
    </>
  );
}
