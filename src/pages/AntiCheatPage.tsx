import { usePlayerPreference } from '../hooks/usePlayerPreference';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLUB ENGINE - Anti-Cheat Dashboard
 *  5 Tabs: Overview | Flags | Events | Collusion | Anomalies
 *  Ported from World Hub native page → Club Arena TSX
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthUser } from '../hooks/useAuthUser';
import { useToast } from '../components/common/Toast';
import { masterBus } from '../core/MasterBus';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import { ArenaReadings, ArenaRow, ArenaState, type ArenaTone } from '../components/ops/ArenaOps';
import '../components/lobby/ArenaWorkspace.css';
import '../components/ops/ArenaOps.css';
import { confirmDialog } from '../components/common/confirmDialog';
import styles from './AntiCheatPage.module.css';
import { useIsMounted } from '../hooks/useIsMounted';
import { retryFetch } from '../utils/retryFetch';
import { exportToCSV } from '../lib/export';
import { resolveClubUUID } from '../utils/clubIdResolver';
import { fmt, fmtChips, timeAgo } from '../utils/format';
import { isAuthzError } from '../utils/clubDashboard';
import { adminRemovePlayerFromClubTables } from '../services/IntegrityActionService';
import { reportError } from '../utils/errorReporter';
import { playerDisplayName, PLAYER_NAME_COLUMNS } from '../utils/playerDisplayName';
import { describeFlagReason } from '../utils/antiCheatFlagReason';

type Severity = 'critical' | 'high' | 'medium' | 'low';

/* Severity prints as a word in the smarter.poker inks (Dan 2026-11-27,
   #SmarterDesign): red for critical and high, gold for medium, blue for low.
   No tinted badge box. */
const SEVERITY_MAP: Record<Severity, { tone: ArenaTone; label: string }> = {
  critical: { tone: 'danger', label: 'Critical' },
  high: { tone: 'danger', label: 'High' },
  medium: { tone: 'attention', label: 'Medium' },
  low: { tone: 'live', label: 'Low' },
};

function SeverityBadge({ severity }: { severity: string }) {
  const sev = SEVERITY_MAP[severity as Severity] || SEVERITY_MAP.low;
  return (
    <span className={styles.severityBadge} data-tone={sev.tone}>
      {sev.label}
    </span>
  );
}

/** The club's name as the route spells it; a raw UUID names nothing. */
function clubContext(clubId?: string): string | undefined {
  if (!clubId || /^[0-9a-f]{8}-/i.test(clubId)) return undefined;
  return clubId.replace(/[-_]/g, ' ');
}

// ── Types ───────────────────────────────────────────────────
/**
 * The columns `anti_cheat_flags` actually has.
 *
 * This interface used to declare `details: Record<string, unknown> | null`,
 * and the review dialog rendered it as the evidence block. That column does
 * not exist on the table - the evidence a flag carries is `reason` - so the
 * block has been `undefined && ...` since it shipped, and no reviewer has ever
 * seen why a flag was raised while deciding what to do about it.
 */
interface AntiCheatFlag {
  id: string;
  player_id: string;
  club_id: string | null;
  table_id: string | null;
  flag_type: string;
  reason: string | null;
  severity: string;
  status: string;
  flagged_at: string;
  created_at?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  player?: { display_name?: string };
}

interface AntiCheatEvent {
  id: string;
  player_id: string | null;
  event_type: string;
  details: Record<string, unknown> | null;
  created_at: string;
  player?: { display_name?: string };
}

interface CollusionPair {
  dumper_id: string;
  receiver_id: string;
  pattern_type: string;
  hands_together: number;
  score: number;
  chip_flow_ratio: number;
  severity: string;
  /* Whatever the detector that raised this pair actually recorded. CHIP_DUMP
     writes hands / loser_loss_ratio / pot_volume; WIN_RATE_ANOMALY writes
     bb_per_100 / direction / hands_together. The old UI printed a
     `net_chips_transferred` column that no detector has ever written, so
     COALESCE made it a column of zeroes. */
  evidence: Record<string, unknown> | null;
}

interface CollusionGroup {
  total: number;
  pairs: CollusionPair[];
}

interface CollusionReading {
  analyzed_hands: number;
  club_players: number;
  window_days: number;
  threshold: number;
  cap: number;
  /** Pairs the detector already closed out in this window. Shown so an empty
   *  queue reads as "the screen ran and closed itself" rather than "nothing
   *  was screened". 169,519 of them were auto-cleared on 2026-08-18 when the
   *  detector was fixed at write time to stop raising horse-versus-horse. */
  closed_pairs: number;
  chip_dump: CollusionGroup;
  /** Every pattern that is not CHIP_DUMP. There are seven pattern types and
   *  each row carries its own, so this is not "win rate" - three of the seven
   *  rows currently open on the estate are TIMING_CORRELATION. */
  screening: CollusionGroup;
}

interface Anomaly {
  hand_id: string;
  player_id: string;
  hand_rank: string;
  pot_total: number;
  completed_at: string;
  severity: string;
}

interface Stats {
  open_flags: number;
  blocks_24h: number;
  active_sessions: number;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
}

/**
 * What the detector actually recorded, in words. CHIP_DUMP writes hands,
 * loser_loss_ratio and pot_volume; WIN_RATE_ANOMALY writes bb_per_100 and
 * direction. Nothing writes net chips transferred, which is why the column
 * that used to sit here always read zero.
 */
export function evidenceSummary(pair: { evidence?: Record<string, unknown> | null }): string {
  const e = pair.evidence || {};
  const num = (key: string): number | null => {
    const raw = e[key];
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const parts: string[] = [];
  const loss = num('loser_loss_ratio');
  if (loss !== null) parts.push(`Loss Ratio ${(loss * 100).toFixed(0)}%`);
  const pot = num('pot_volume');
  if (pot !== null) parts.push(`Pot Volume ${fmt(pot)}`);
  const bb = num('bb_per_100');
  if (bb !== null) parts.push(`${bb.toFixed(1)} BB Per 100`);
  const close = num('close_ratio');
  if (close !== null) parts.push(`Close Actions ${(close * 100).toFixed(0)}%`);
  if (typeof e.direction === 'string' && e.direction) parts.push(`Direction ${e.direction}`);
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'No Evidence Recorded';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function AntiCheatPage() {
  const { user } = useAuthUser();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  /**
   * THE ROUTE PARAM WINS.
   *
   * This page resolved its club from ?club= or, failing that, whichever
   * club_members row came back first - which is right for the legacy global
   * URL and wrong the moment it is opened from a club's own operations rail.
   * Phase 7 gives it clubs/:clubId/anti-cheat, so the club being looked at is
   * now stated in the URL and must take precedence over a guess.
   */
  const { clubId: routeClubId } = useParams<{ clubId?: string }>();

  // ── State ─────────────────────────────────────────────
  const [tab, setTab] = useState<'overview' | 'flags' | 'events' | 'collusion' | 'anomalies'>(
    'overview'
  );
  const [loading, setLoading] = useState(true);
  const [clubId, setClubId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  /* An integrity page that cannot read must say so. "Nothing found" and "the
     read failed" used to render identically here, and the second one printed
     the words "Club Is Clean". */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Overview
  const [stats, setStats] = useState<Stats | null>(null);

  // Flags
  const [flags, setFlags] = useState<AntiCheatFlag[]>([]);
  /** Names of every account a flag mentions, the flagged player and the others. */
  const [flagNames, setFlagNames] = useState<Record<string, string>>({});
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  const [flagFilter, setFlagFilter] = usePlayerPreference('AntiCheatPage:flagFilter', 'open');

  // Events
  const [events, setEvents] = useState<AntiCheatEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);

  // Collusion
  const [collusion, setCollusion] = useState<CollusionReading | null>(null);
  const [collusionLoaded, setCollusionLoaded] = useState(false);

  // Anomalies
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [anomaliesLoaded, setAnomaliesLoaded] = useState(false);

  // Review Modal
  const [reviewTarget, setReviewTarget] = useState<AntiCheatFlag | null>(null);
  const [reviewStatus, setReviewStatus] = useState('reviewed');
  const [reviewNotes, setReviewNotes] = useState('');

  const mountedRef = useIsMounted();

  const loadingRef = useRef(false);

  // ── Load Stats ──────────────────────────────────────────
  const loadStats = useCallback(
    async (cId?: string) => {
      const targetClub = cId || clubId;
      if (!targetClub) return;
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        setLoading(true);
        const { data, error } = await retryFetch(
          () =>
            supabase
              .rpc('get_anti_cheat_stats', {
                p_club_id: targetClub,
              })
              .then((r) => r),
          { maxRetries: 2, isMountedRef: mountedRef }
        );
        if (error) throw error;
        if (mountedRef.current) setStats(data || null);
      } catch (err: unknown) {
        /* A read that failed and a club with nothing to report used to look
           identical: this fallback painted six zeros, and the panel below
           renders "Club Is Clean" whenever open_flags is 0. An operator cannot
           tell a quiet club from a broken page, so now it says which it is. */
        reportError(err, 'AntiCheatPage.Stats_load_failed');
        if (mountedRef.current) {
          setStats(null);
          setLoadError(
            isAuthzError(err)
              ? 'Integrity Review Is Restricted To Club Owners And Administrators'
              : 'The Integrity Readings Could Not Be Loaded'
          );
        }
      } finally {
        loadingRef.current = false;
        if (mountedRef.current) setLoading(false);
      }
    },
    [clubId]
  );

  // ── Load Flags ──────────────────────────────────────────
  const loadFlags = useCallback(
    async (status?: string) => {
      if (!clubId) return;
      try {
        /* anti_cheat_flags grants `authenticated` one policy - read the flags
           raised against YOURSELF - so a direct club read returned nothing to
           the operator no matter what club_id was passed. All fourteen rows on
           the estate also carry club_id NULL and table_id NULL: they are
           multi_account flags about a person, with nothing to derive a club
           from. fn_club_anti_cheat_flags scopes them the way phase 1 scoped a
           player report - your flag when the flagged player is your member -
           inside a definer function, so the table itself stays closed. */
        const filterStatus = status || flagFilter;
        const { data, error } = await supabase.rpc('fn_club_anti_cheat_flags', {
          p_club_id: clubId,
          p_status: filterStatus,
          p_limit: 50,
        });
        if (error) throw error;

        // Batch-fetch player profiles (no FK hint needed)
        if (data && data.length > 0) {
          const playerIds = [
            ...new Set(
              (data as AntiCheatFlag[])
                .flatMap((f) => [f.player_id, ...describeFlagReason(f.reason).otherIds])
                .filter(Boolean)
            ),
          ];
          const playerNames: Record<string, string> = {};
          if (playerIds.length > 0) {
            try {
              const { data: profiles } = await supabase
                .from('profiles')
                .select(`id, ${PLAYER_NAME_COLUMNS}`)
                .in('id', playerIds);
              if (profiles) {
                for (const p of profiles) playerNames[p.id] = playerDisplayName(p);
              }
            } catch (e) {
              reportError(e, 'AntiCheatPage.Set');
              /* non-critical */
            }
          }
          if (mountedRef.current) {
            setFlagNames(playerNames);
            setFlags(
              data.map((f: AntiCheatFlag) => ({
                ...f,
                player: { display_name: playerNames[f.player_id] },
              }))
            );
            setFlagsLoaded(true);
          }
        } else if (mountedRef.current) {
          setFlags([]);
          setFlagsLoaded(true);
        }
      } catch (err: unknown) {
        console.warn(
          '[AntiCheat] Flags load failed:',
          err instanceof Error ? err.message : String(err)
        );
        if (mountedRef.current) {
          /* A FAILED READ IS NOT AN EMPTY QUEUE. This page already carries
             `loadError` for exactly this reason - the comment on its
             declaration says "'Nothing found' and 'the read failed' used to
             render identically here, and the second one printed the words
             'Club Is Clean'" - but only `init` ever set it, so a failed FLAGS
             read went on painting a clean screen. It sets it now. */
          setLoadError(
            err instanceof Error
              ? err.message
              : 'The integrity flags could not be read. This is not the same as a clean club.'
          );
          setFlags([]);
          setFlagsLoaded(true);
        }
      }
    },
    [clubId, flagFilter]
  );

  // ── Load Events ──────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    if (!clubId) return;
    try {
      const { data, error } = await supabase
        .from('anti_cheat_events')
        .select('*, player_id')
        .eq('club_id', clubId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      // Batch-fetch player profiles (no FK hint needed)
      if (data && data.length > 0) {
        const playerIds = [
          ...new Set(data.map((e: AntiCheatEvent) => e.player_id).filter(Boolean)),
        ];
        const playerNames: Record<string, string> = {};
        if (playerIds.length > 0) {
          try {
            const { data: profiles } = await supabase
              .from('profiles')
              .select(`id, ${PLAYER_NAME_COLUMNS}`)
              .in('id', playerIds);
            if (profiles) {
              for (const p of profiles) playerNames[p.id] = playerDisplayName(p);
            }
          } catch (e) {
            reportError(e, 'AntiCheatPage.Set');
            /* non-critical */
          }
        }
        if (mountedRef.current) {
          setEvents(
            data.map((e: AntiCheatEvent) => ({
              ...e,
              player: { display_name: e.player_id ? playerNames[e.player_id] : undefined },
            }))
          );
          setEventsLoaded(true);
        }
      } else if (mountedRef.current) {
        setEvents([]);
        setEventsLoaded(true);
      }
    } catch (err: unknown) {
      console.warn(
        '[AntiCheat] Events load failed:',
        err instanceof Error ? err.message : String(err)
      );
      if (mountedRef.current) {
        // Same reason as the flags read above: silence is not a clean result.
        setLoadError(
          err instanceof Error
            ? err.message
            : 'The integrity events could not be read. This is not the same as a clean club.'
        );
        setEvents([]);
        setEventsLoaded(true);
      }
    }
  }, [clubId]);

  // ── Load Collusion ──────────────────────────────────────
  const loadCollusion = useCallback(async () => {
    if (!clubId) return;
    try {
      const { data, error } = await retryFetch(
        () =>
          supabase
            .rpc('detect_collusion_pairs', {
              p_club_id: clubId,
              p_threshold: 0.75,
              p_min_hands: 5,
            })
            .then((r) => r),
        { maxRetries: 2, isMountedRef: mountedRef }
      );
      if (error) throw error;
      if (mountedRef.current) {
        setCollusion((data || null) as CollusionReading | null);
        setCollusionLoaded(true);
      }
    } catch (err: unknown) {
      reportError(err, 'AntiCheatPage.Collusion_load_failed');
      if (mountedRef.current) {
        setCollusion(null);
        setCollusionLoaded(true);
        setLoadError(
          isAuthzError(err)
            ? 'Integrity Review Is Restricted To Club Owners And Administrators'
            : 'The Collusion Screen Could Not Be Loaded'
        );
      }
    }
  }, [clubId]);

  /* A pair the operator has looked at and cleared. collusion_tracking carries
     status / reviewed_by / notes and nothing in this app has ever written them,
     so a screened pair came back every single load with no way to work the
     queue down. */
  const dismissPair = useCallback(
    async (pair: CollusionPair) => {
      if (!clubId) return;
      if (
        !(await confirmDialog({
          title: 'Clear This Pair',
          message:
            'Mark this pair as reviewed and clear it from the screen? It will return if the detector raises it again in a later scan.',
          confirmText: 'Clear Pair',
        }))
      )
        return;
      setProcessing(true);
      try {
        const { data, error } = await supabase.rpc('fn_ca_dismiss_collusion_pair', {
          p_club_id: clubId,
          p_player_a: pair.dumper_id,
          p_player_b: pair.receiver_id,
          p_note: null,
        });
        if (error) throw error;
        const outcome = (data || {}) as { ok?: boolean; updated?: number };
        if (!outcome.ok) throw new Error('That pair could not be cleared.');
        toast.success(`Cleared ${fmt(outcome.updated || 0)} Screening Rows.`);
        setCollusionLoaded(false);
        void loadCollusion();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setProcessing(false);
      }
    },
    [clubId, loadCollusion, toast]
  );

  // ── Load Anomalies ──────────────────────────────────────
  const loadAnomalies = useCallback(async () => {
    if (!clubId) return;
    try {
      const { data, error } = await retryFetch(
        () =>
          supabase
            .rpc('detect_suspicious_plays', {
              p_club_id: clubId,
              p_limit: 500,
            })
            .then((r) => r),
        { maxRetries: 2, isMountedRef: mountedRef }
      );
      if (error) throw error;
      if (mountedRef.current) {
        setAnomalies(data || []);
        setAnomaliesLoaded(true);
      }
    } catch (err: unknown) {
      console.warn(
        '[AntiCheat] Anomalies load failed:',
        err instanceof Error ? err.message : String(err)
      );
      if (mountedRef.current) {
        setAnomalies([]);
        setAnomaliesLoaded(true);
      }
    }
  }, [clubId]);

  // ── Initial Load ──────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    const init = async () => {
      const qClub = routeClubId || searchParams.get('club') || searchParams.get('clubId');
      let targetClub = qClub;

      if (!targetClub) {
        const { data: mem } = await supabase
          .from('club_members')
          .select('club_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
        targetClub = mem?.club_id || null;
      }

      /* THE PAGE USED TO SET THE ROUTE PARAM STRAIGHT INTO clubId.
         Club routes are addressed by slug (deep-stack-society-11192), and every
         read on this page passes clubId into a uuid argument or an .eq on a
         uuid column, so Postgres answered 22P02 invalid input syntax for type
         uuid and every catch block below turned that into an empty state. The
         page has shown six zeros and "Club Is Clean" on every slug URL since it
         shipped. The realtime filter twenty lines down already resolved it. */
      let resolvedClub: string | null = null;
      if (targetClub) {
        try {
          resolvedClub = await resolveClubUUID(targetClub);
        } catch (resolveError) {
          reportError(resolveError, 'AntiCheatPage.Club_resolve_failed');
          resolvedClub = null;
        }
      }

      if (resolvedClub && isMounted) {
        setClubId(resolvedClub);
        loadStats(resolvedClub);
      } else if (isMounted) {
        toast.error('No club found.');
        setLoadError('This Club Could Not Be Identified');
        setLoading(false);
      }
    };

    init();
    return () => {
      isMounted = false;
    };
  }, [user, searchParams, routeClubId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lazy Tab Loading ──────────────────────────────────────
  useEffect(() => {
    if (!clubId) return;
    if (tab === 'flags' && !flagsLoaded) loadFlags();
    if (tab === 'events' && !eventsLoaded) loadEvents();
    if (tab === 'collusion' && !collusionLoaded) loadCollusion();
    if (tab === 'anomalies' && !anomaliesLoaded) loadAnomalies();
  }, [
    tab,
    clubId,
    flagsLoaded,
    eventsLoaded,
    collusionLoaded,
    anomaliesLoaded,
    loadFlags,
    loadEvents,
    loadCollusion,
    loadAnomalies,
  ]);

  // ── Reload flags when filter changes ──────────────────────
  useEffect(() => {
    if (flagsLoaded && clubId) loadFlags(flagFilter);
  }, [flagFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Visibility Refresh ────────────────────────────────────
  useVisibilityRefresh(async () => {
    if (!clubId) return;
    loadStats(clubId);
  });

  // ── Realtime Listeners (debounced) ─────────────────────────
  useEffect(() => {
    if (!clubId) return;

    const unsubs = [
      // ANTI_CHEAT_FLAG_CREATED listener removed 2026-08-28: nothing emits it
      // on the client bus (flags are created server-side), so it never fired.
      masterBus.subscribeDebounced(
        'PLAYER_KICKED',
        () => {
          loadStats(clubId);
        },
        500
      ),
      // Phase 4: Cross-page sync (ported from World Hub anti-cheat.js)
      masterBus.subscribeDebounced('TABLE_CREATED', () => loadStats(clubId), 500),
      masterBus.subscribeDebounced('CHIPS_DISTRIBUTED', () => loadStats(clubId), 500),
    ];

    return () => unsubs.forEach((u) => u());
  }, [clubId, loadStats]);

  // ── Supabase Realtime - cross-user WebSocket updates ──
  const loadStatsRef = useRef(loadStats);
  loadStatsRef.current = loadStats;

  useEffect(() => {
    if (!clubId) return;
    let isMounted = true;
    let acquiredChannel: ReturnType<typeof masterBus.getOrCreateChannel> | null = null;
    const channelKey = `anti-cheat-${clubId}`;

    const setupRealtime = async () => {
      const resolvedId = await resolveClubUUID(clubId);
      if (!isMounted) return;

      const channel = masterBus.getOrCreateChannel(channelKey);
      acquiredChannel = channel;
      channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'anti_cheat_flags',
            filter: `club_id=eq.${resolvedId}`,
          },
          () => {
            loadStatsRef.current(clubId);
            setFlagsLoaded(false);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'anti_cheat_events',
            filter: `club_id=eq.${resolvedId}`,
          },
          () => setEventsLoaded(false)
        )
        .subscribe((status: string, err?: Error) => {
          if (status === 'CHANNEL_ERROR') {
            if (err) reportError(err?.message || err, 'AntiCheatPage._Realtime_channel_error');
          }
          if (status === 'TIMED_OUT') {
            console.warn('[AntiCheatPage] Realtime channel timed out');
          }
        });
    };

    masterBus.registerChannelFactory?.(channelKey, () => {
      if (isMounted) void setupRealtime();
    });
    setupRealtime().catch((e) => console.warn('[AntiCheatPage] Realtime setup failed:', e));

    return () => {
      isMounted = false;
      masterBus.removeChannelFactory?.(channelKey);
      if (acquiredChannel) {
        masterBus.removeRegisteredChannel(channelKey, acquiredChannel);
      }
    };
  }, [clubId]);

  // ── Actions ────────────────────────────────────────────────
  const reviewFlag = async () => {
    if (!reviewTarget || !clubId) return;
    setProcessing(true);
    try {
      /* This used to be a client UPDATE against a table with no UPDATE policy
         for `authenticated`: PostgREST answered 204, zero rows, no error, and
         the toast below claimed the decision had been recorded. It never had
         been. The RPC returns { ok } and a zero-row write is a failure. */
      const { data, error } = await supabase.rpc('fn_review_anti_cheat_flag', {
        p_club_id: clubId,
        p_flag_id: reviewTarget.id,
        p_status: reviewStatus,
        p_notes: reviewNotes || null,
      });
      if (error) throw error;
      const outcome = (data || {}) as { ok?: boolean; reason?: string };
      if (!outcome.ok) {
        throw new Error(
          outcome.reason === 'flag_not_in_this_club'
            ? 'That flag does not belong to this club.'
            : 'The review could not be recorded.'
        );
      }

      toast.success(`Flag ${reviewStatus} successfully.`);
      setReviewTarget(null);
      setReviewNotes('');
      setFlagsLoaded(false);
      loadFlags();
      loadStats(clubId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  };

  /**
   * REMOVING A PLAYER IS THE ENGINE'S JOB, AND IT ALREADY HAD ONE.
   *
   * This used to stamp `left_at` and status 'kicked' straight onto table_seats.
   * That is the exact write CLAUDE.md 11.5 exists to forbid: closing a seat
   * without going through a cash-out destroys the stack sitting in it, and the
   * `ca_seat_stack_exits` trigger files every such exit as a critical
   * reconciliation failure. It also never had a tableId - every call site
   * passed only a player - so the seat branch was skipped entirely and the
   * compensating anti_cheat_events insert was refused by RLS (service-role
   * only). Nothing was removed, nothing was logged, and the operator was told
   * "Player removed."
   *
   * POST /admin/kick on the engine has done this correctly since Round 68: it
   * verifies club-admin from the caller's own token, auto-folds a player who is
   * mid-hand, cashes the stack out between hands, and writes the
   * anti_cheat_events audit row itself. This finds the tables the player is
   * actually sitting at in THIS club and asks the engine to remove them.
   */
  const kickPlayer = async (playerId: string) => {
    if (!clubId) return;
    setProcessing(true);
    try {
      const { data: seats, error: seatError } = await supabase
        .from('table_seats')
        .select('table_id, tables!table_seats_table_id_fkey!inner(club_id, status)')
        .eq('user_id', playerId)
        .is('left_at', null)
        .eq('tables.club_id', clubId);
      if (seatError) throw seatError;

      const tableIds = [
        ...new Set(((seats || []) as Array<{ table_id: string }>).map((row) => row.table_id)),
      ];
      if (tableIds.length === 0) {
        toast.info('This Player Is Not Seated At Any Table In This Club.');
        return;
      }

      if (
        !(await confirmDialog({
          title: 'Remove Player From Play',
          message: `Remove this player from ${tableIds.length} live table${
            tableIds.length === 1 ? '' : 's'
          }? Their stack is cashed out to their club wallet and the removal is recorded against your account.`,
          confirmText: 'Remove Player',
          variant: 'danger',
        }))
      )
        return;

      const outcome = await adminRemovePlayerFromClubTables(
        tableIds,
        playerId,
        'Anti-cheat review - removed by club admin'
      );
      if (outcome.removed === 0 && !outcome.pending) {
        throw new Error(outcome.firstError || 'The engine did not remove this player.');
      }
      if (outcome.failed > 0) {
        toast.warning(
          `Removed From ${fmt(outcome.removed)} Of ${fmt(tableIds.length)} Tables; ${fmt(outcome.pending || 0)} Pending. ${
            outcome.firstError || ''
          }`.trim()
        );
      } else if (outcome.pending > 0) {
        toast.info(
          `Removed From ${fmt(outcome.removed)} Tables. ${fmt(outcome.pending)} Removals Pending Until Their Hands Finish.`
        );
      } else {
        toast.success(`Player Removed From ${fmt(outcome.removed)} Table(s).`);
      }
      if (outcome.removed > 0)
        masterBus.emit('PLAYER_KICKED', { clubId: clubId ?? '', userId: playerId });
      setEventsLoaded(false);
      loadStats(clubId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  };

  // ── Refresh All ────────────────────────────────────────────
  const handleRefresh = () => {
    if (!clubId) return;
    loadStats(clubId);
    setFlagsLoaded(false);
    setEventsLoaded(false);
    setCollusionLoaded(false);
    setAnomaliesLoaded(false);
  };

  // ── Loading ────────────────────────────────────────────────
  const mast = (
    <ArenaWorkspaceHeader
      area="integrity"
      title="Anti-Cheat Dashboard"
      context={clubContext(routeClubId)}
      summary="Review Integrity Flags, Collusion Screening And Outsized Pots For This Club, And Act On What Needs A Decision."
    />
  );
  if (loading && !stats) {
    return (
      <div className={`${styles.page} arena-workspace`}>
        {mast}
        <ArenaState tone="loading" title="Loading Integrity Readings" />
      </div>
    );
  }

  const exportTab = () => {
    try {
      if (tab === 'flags' && flags.length > 0) {
        exportToCSV(flags, 'anti_cheat_flags.csv', [
          { key: 'severity', label: 'Severity' },
          { key: 'flag_type', label: 'Type' },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status' },
          { key: 'player_id', label: 'Player ID' },
          { key: 'flagged_at', label: 'Flagged At' },
          { key: 'review_notes', label: 'Review Notes' },
        ]);
      } else if (tab === 'events' && events.length > 0) {
        exportToCSV(events, 'anti_cheat_events.csv', [
          { key: 'event_type', label: 'Type' },
          { key: 'player_id', label: 'Player ID' },
          { key: 'created_at', label: 'Time' },
        ]);
      } else if (
        tab === 'collusion' &&
        collusion &&
        collusion.chip_dump.pairs.length + collusion.screening.pairs.length > 0
      ) {
        /* The old export carried a Net Chips column that no detector
           has ever written, so every row said 0.00. */
        exportToCSV(
          [...collusion.chip_dump.pairs, ...collusion.screening.pairs].map((pair) => ({
            ...pair,
            evidence_summary: evidenceSummary(pair),
          })),
          'collusion_pairs.csv',
          [
            { key: 'pattern_type', label: 'Pattern' },
            { key: 'dumper_id', label: 'Player A' },
            { key: 'receiver_id', label: 'Player B' },
            { key: 'hands_together', label: 'Hands Together' },
            { key: 'score', label: 'Score' },
            { key: 'severity', label: 'Severity' },
            { key: 'evidence_summary', label: 'Evidence' },
          ]
        );
      } else if (tab === 'anomalies' && anomalies.length > 0) {
        exportToCSV(anomalies, 'anomalies.csv', [
          { key: 'player_id', label: 'Player ID' },
          { key: 'hand_rank', label: 'Hand Rank' },
          { key: 'pot_total', label: 'Pot' },
          { key: 'severity', label: 'Severity' },
          { key: 'completed_at', label: 'Time' },
        ]);
      } else {
        toast.info?.('No data to export from this tab');
      }
    } catch (e) {
      reportError(e, 'AntiCheatPage');
      /* silent */
    }
  };

  return (
    <div className={`${styles.page} arena-workspace`}>
      {/* ── Page Header ──────────────────────────────── */}
      {mast}
      <PageBar
        title="Anti-Cheat Dashboard"
        titleAs={false}
        showHelp={false}
        status={stats && stats.open_flags > 0 ? `${fmt(stats.open_flags)} Open` : undefined}
        statusTone="attention"
      >
        <div className="arena-switch arena-ops-keys">
          <Link to="/">Lobby</Link>
          <Link to="/admin">Admin</Link>
          <button type="button" onClick={handleRefresh}>
            Refresh
          </button>
          <button type="button" onClick={exportTab}>
            Export
          </button>
        </div>
      </PageBar>

      {/* ── Review Flag Modal ────────────────────────── */}
      {reviewTarget && (
        <div className={styles.modalOverlay} onClick={() => !processing && setReviewTarget(null)}>
          <div
            className={`arena-case arena-ops-case ${styles.modal}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="arena-section-title">Review Flag</h2>
            <div className={styles.reviewHeader}>
              <SeverityBadge severity={reviewTarget.severity} />
              <span className={styles.flagType}>{reviewTarget.flag_type}</span>
            </div>
            <p className="arena-ops-copy">
              Player:{' '}
              {reviewTarget.player?.display_name || reviewTarget.player_id?.substring(0, 8) || '-'}
            </p>
            <pre className={`arena-ops-well ${styles.detailsBlock}`}>
              {reviewTarget.reason
                ? (() => {
                    const view = describeFlagReason(reviewTarget.reason);
                    const others = view.otherIds
                      .map((id) => flagNames[id] || id.substring(0, 8))
                      .join(', ');
                    return others ? `${view.summary} With ${others}` : view.summary;
                  })()
                : 'This Flag Was Raised Without A Stated Reason'}
            </pre>
            <div className={styles.formGroup}>
              <label className="arena-ops-eyebrow">Action</label>
              <select
                className="arena-ops-well"
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value)}
              >
                <option value="reviewed">Mark Reviewed</option>
                <option value="dismissed">Dismiss</option>
                <option value="actioned">Actioned</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className="arena-ops-eyebrow">Notes (Optional)</label>
              <input
                className="arena-ops-well"
                placeholder="Add Review Notes..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
              />
            </div>
            <div className="arena-switch arena-ops-keys">
              <button type="button" onClick={() => setReviewTarget(null)} disabled={processing}>
                Cancel
              </button>
              <button type="button" className="active" onClick={reviewFlag} disabled={processing}>
                {processing ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────── */}
      <nav className="arena-switch arena-ops-keys" aria-label="Anti-Cheat Sections">
        {[
          { id: 'overview' as const, label: 'Overview' },
          { id: 'flags' as const, label: 'Flags', badge: stats?.open_flags || 0 },
          { id: 'events' as const, label: 'Events' },
          { id: 'collusion' as const, label: 'Collusion' },
          { id: 'anomalies' as const, label: 'Anomalies' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            className={tab === t.id ? 'active' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className={styles.tabBadge}>{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      {/* ═══════════════ TAB: OVERVIEW ════════════════ */}
      {tab === 'overview' && (
        <section className="arena-case arena-ops-case" aria-label="Overview">
          <h2 className="arena-section-title">Integrity Readings</h2>
          {!stats && loading ? (
            <ArenaState tone="loading" title="Loading Integrity Readings" />
          ) : !stats ? (
            <ArenaState
              tone="error"
              title={loadError || 'The Integrity Readings Could Not Be Loaded'}
            />
          ) : (
            <>
              <ArenaReadings
                label="Integrity Readings"
                readings={[
                  {
                    id: 'open',
                    label: 'Open Flags',
                    value: fmt(stats.open_flags),
                    tone: 'danger',
                  },
                  {
                    id: 'blocks',
                    label: 'Enforcement (24H)',
                    value: fmt(stats.blocks_24h),
                    tone: 'attention',
                  },
                  {
                    id: 'seated',
                    label: 'Players Seated Now',
                    value: fmt(stats.active_sessions),
                    tone: 'live',
                  },
                ]}
              />

              {/* Severity Breakdown */}
              {Object.keys(stats.by_severity || {}).length > 0 && (
                <>
                  <h3 className="arena-ops-eyebrow">Flags By Severity</h3>
                  <ArenaReadings
                    label="Flags By Severity"
                    readings={Object.entries(stats.by_severity).map(([sev, count]) => {
                      const st = SEVERITY_MAP[sev as Severity];
                      return {
                        id: sev,
                        label: st?.label || sev,
                        value: fmt(count),
                        tone: st?.tone,
                      };
                    })}
                  />
                </>
              )}

              {/* Flags by Type */}
              {Object.keys(stats.by_type || {}).length > 0 && (
                <>
                  <h3 className="arena-ops-eyebrow">Flags By Type</h3>
                  <ul className="arena-ops-rows">
                    {Object.entries(stats.by_type)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <li key={type}>
                          <ArenaRow title={type} signal={fmt(count)} signalTone="attention" />
                        </li>
                      ))}
                  </ul>
                </>
              )}

              {stats.open_flags === 0 && (
                <ArenaState
                  tone="empty"
                  title="No Open Integrity Flags Against Members Of This Club"
                />
              )}
            </>
          )}
        </section>
      )}

      {/* ═══════════════ TAB: FLAGS ═══════════════════ */}
      {tab === 'flags' && (
        <section className="arena-case arena-ops-case" aria-label="Flags">
          <h2 className="arena-section-title">Integrity Flags</h2>
          <div className="arena-switch arena-ops-keys">
            {['open', 'reviewed', 'dismissed', 'actioned', 'all'].map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={flagFilter === f}
                className={flagFilter === f ? 'active' : undefined}
                onClick={() => setFlagFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {!flagsLoaded ? (
            <ArenaState tone="loading" title="Loading Flags" />
          ) : flags.length === 0 ? (
            <ArenaState tone="empty" title={`No Flags Match The Filter "${flagFilter}"`} />
          ) : (
            <ul className="arena-ops-rows arena-ops-rows--single">
              {flags.map((f) => (
                <li key={f.id}>
                  <div className={`arena-ledger-row ${styles.caseRow}`}>
                    <div className={styles.caseHead}>
                      <SeverityBadge severity={f.severity} />
                      <strong className={styles.flagType}>{f.flag_type}</strong>
                      <span
                        className={styles.caseStatus}
                        data-open={f.status === 'open' || undefined}
                      >
                        {f.status}
                      </span>
                    </div>
                    <p className={styles.caseLine}>
                      {f.player?.display_name || f.player_id?.substring(0, 8) || '-'} ·{' '}
                      {timeAgo(f.flagged_at)}
                    </p>
                    <p className={styles.caseDetail} title={f.reason || undefined}>
                      {(() => {
                        const view = describeFlagReason(f.reason);
                        return (
                          <>
                            <span>{view.summary}</span>
                            {view.otherIds.length > 0 && (
                              <span className={styles.reasonAccounts}>
                                {' With '}
                                {view.otherIds.map((id, i) => (
                                  <span key={id}>
                                    {i > 0 ? ', ' : ''}
                                    <Link to={`/profile/${id}`} className={styles.reasonLink}>
                                      {flagNames[id] || id.substring(0, 8)}
                                    </Link>
                                  </span>
                                ))}
                              </span>
                            )}
                            {view.handNumbers.length > 0 && (
                              <span className={styles.reasonHands}>
                                {' Hands #'}
                                {view.handNumbers.slice(0, 5).join(', #')}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </p>
                    <div className={`arena-switch ${styles.caseKeys}`}>
                      {f.status === 'open' && (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewTarget(f);
                            setReviewStatus('reviewed');
                            setReviewNotes('');
                          }}
                        >
                          Review
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.dangerKey}
                        onClick={() => kickPlayer(f.player_id)}
                        disabled={processing}
                      >
                        Kick
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ═══════════════ TAB: EVENTS ══════════════════ */}
      {tab === 'events' && (
        <section className="arena-case arena-ops-case" aria-label="Events">
          {!eventsLoaded ? (
            <ArenaState tone="loading" title="Loading Events" />
          ) : events.length === 0 ? (
            <ArenaState tone="empty" title="No Anti-Cheat Events Recorded Yet" />
          ) : (
            <>
              <h2 className="arena-section-title">Recent Events ({events.length})</h2>
              <ul className="arena-ops-rows arena-ops-rows--single">
                {events.map((ev, i) => (
                  <li key={ev.id || i}>
                    <ArenaRow
                      title={ev.player?.display_name || ev.player_id?.substring(0, 8) || 'System'}
                      line={
                        <>
                          {ev.details ? JSON.stringify(ev.details).substring(0, 80) : '-'} ·{' '}
                          {timeAgo(ev.created_at)}
                        </>
                      }
                      signal={ev.event_type}
                      signalTone={
                        ev.event_type.includes('kicked')
                          ? 'danger'
                          : ev.event_type.includes('blocked')
                            ? 'attention'
                            : 'live'
                      }
                      className={styles.eventRow}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ═══════════════ TAB: COLLUSION ═══════════════ */}
      {tab === 'collusion' && (
        <section className="arena-case arena-ops-case" aria-label="Collusion">
          <h2 className="arena-section-title">Collusion Screen</h2>
          {!collusionLoaded ? (
            <ArenaState tone="loading" title="Loading Collusion Screen" />
          ) : !collusion ? (
            <ArenaState
              tone="error"
              title={loadError || 'The Collusion Screen Could Not Be Loaded'}
            />
          ) : (
            <>
              <ArenaReadings
                label="Collusion Readings"
                readings={[
                  {
                    id: 'hands',
                    label: 'Hands Analyzed',
                    value: fmt(collusion.analyzed_hands),
                    tone: 'live',
                  },
                  {
                    id: 'dump',
                    label: 'Chip Dump Pairs',
                    value: fmt(collusion.chip_dump.total),
                    tone: 'danger',
                  },
                  {
                    id: 'signals',
                    label: 'Other Signals Open',
                    value: fmt(collusion.screening.total),
                    tone: 'attention',
                  },
                  { id: 'players', label: 'Players Screened', value: fmt(collusion.club_players) },
                  { id: 'closed', label: 'Already Closed', value: fmt(collusion.closed_pairs) },
                ]}
              />

              {/*
                TWO DETECTORS WRITE INTO ONE TABLE AND THEY DO NOT MEAN THE SAME
                THING. CHIP_DUMP is one-directional chip flow - what this tab's
                copy has always claimed to show, and what an operator can act
                on. WIN_RATE_ANOMALY is a win-rate outlier: on the largest club
                on the estate it accounts for 5,588 of the 5,591 pairs in the
                window, so presenting the two as one list turned an actionable
                queue of three into a wall nobody could work.
              */}
              <h3 className="arena-ops-eyebrow">Suspected Chip Dumping</h3>
              <p className="arena-ops-copy">
                One-Directional Chip Flow Between Two Players Who Sat At This Club, Scored At Or
                Above {Math.round(collusion.threshold * 100)} Over The Last {collusion.window_days}{' '}
                Days.
              </p>
              {collusion.chip_dump.pairs.length === 0 ? (
                <ArenaState
                  tone="empty"
                  title={`No Chip Dumping Is Awaiting Review Across ${fmt(collusion.analyzed_hands)} Hands`}
                />
              ) : (
                <ul className="arena-ops-rows arena-ops-rows--single">
                  {collusion.chip_dump.pairs.map((pair) => (
                    <li key={`${pair.dumper_id}-${pair.receiver_id}`}>
                      <div className={`arena-ledger-row ${styles.caseRow}`}>
                        <div className={styles.caseHead}>
                          <SeverityBadge severity={pair.severity} />
                          <span className={styles.collusionFlow}>
                            <span className={styles.dumper}>{pair.dumper_id.substring(0, 8)}</span>
                            <span className={styles.arrow}>&rarr;</span>
                            <span className={styles.receiver}>
                              {pair.receiver_id.substring(0, 8)}
                            </span>
                          </span>
                          <span className={styles.caseFigure}>{fmt(pair.score)}</span>
                        </div>
                        <p className={styles.caseLine}>
                          {fmt(pair.hands_together)} Hands · {evidenceSummary(pair)}
                        </p>
                        <div className={`arena-switch arena-ops-keys ${styles.caseKeys}`}>
                          <button
                            type="button"
                            className={styles.dangerKey}
                            onClick={() => kickPlayer(pair.dumper_id)}
                            disabled={processing}
                          >
                            Remove Loser
                          </button>
                          <button
                            type="button"
                            className={styles.dangerKey}
                            onClick={() => kickPlayer(pair.receiver_id)}
                            disabled={processing}
                          >
                            Remove Winner
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissPair(pair)}
                            disabled={processing}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="arena-ops-eyebrow">Other Screening Signals</h3>
              <p className="arena-ops-copy">
                Screening Signals, Not Findings: Win Rate Outliers, Timing Correlation, Soft Play
                And The Rest, Each Row Naming Its Own Pattern. {fmt(collusion.screening.total)}{' '}
                Awaiting Review
                {collusion.screening.total > collusion.screening.pairs.length
                  ? `, Showing The Top ${fmt(collusion.screening.pairs.length)}`
                  : ''}
                .
              </p>
              {collusion.screening.pairs.length === 0 ? (
                <ArenaState
                  tone="empty"
                  title="No Screening Signal Is Awaiting Review In This Window"
                />
              ) : (
                <ul className="arena-ops-rows arena-ops-rows--single">
                  {collusion.screening.pairs.map((pair) => (
                    <li key={`${pair.dumper_id}-${pair.receiver_id}-${pair.pattern_type}`}>
                      <div className={`arena-ledger-row ${styles.caseRow}`}>
                        <div className={styles.caseHead}>
                          <SeverityBadge severity={pair.severity} />
                          <strong className={styles.flagType}>
                            {String(pair.pattern_type).replace(/_/g, ' ')}
                          </strong>
                          <span className={styles.caseFigure}>{fmt(pair.score)}</span>
                        </div>
                        <p className={styles.caseLine}>
                          <span className={styles.collusionFlow}>
                            <span className={styles.dumper}>{pair.dumper_id.substring(0, 8)}</span>
                            <span className={styles.arrow}>&rarr;</span>
                            <span className={styles.receiver}>
                              {pair.receiver_id.substring(0, 8)}
                            </span>
                          </span>{' '}
                          · {fmt(pair.hands_together)} Hands Together · {evidenceSummary(pair)}
                        </p>
                        <div className={`arena-switch ${styles.caseKeys}`}>
                          <button
                            type="button"
                            onClick={() => dismissPair(pair)}
                            disabled={processing}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {/* ═══════════════ TAB: ANOMALIES ═══════════════ */}
      {tab === 'anomalies' && (
        <section className="arena-case arena-ops-case" aria-label="Anomalies">
          <h2 className="arena-section-title">Outsized Pots</h2>
          {!anomaliesLoaded ? (
            <ArenaState tone="loading" title="Loading Outsized Pots" />
          ) : (
            <>
              {/*
                THIS TAB SAID SOMETHING THE QUERY BEHIND IT NEVER MEASURED.
                detect_suspicious_plays returns the WINNERS of pots at or
                above forty big blinds, ranked by pot size over blind level.
                The page called them "Players Who Folded Strong Hands On The
                River" and stamped every row with a Folded Strong Hand badge.
                Its severity buckets are high at 100 big blinds and medium at
                60, so the Critical tile could never be anything but zero.
              */}
              <ArenaReadings
                label="Outsized Pot Readings"
                readings={[
                  {
                    id: 'pots',
                    label: 'Outsized Pots',
                    value: fmt(anomalies.length),
                    tone: 'danger',
                  },
                  {
                    id: 'hundred',
                    label: '100 Big Blinds Or More',
                    value: fmt(anomalies.filter((a) => a.severity === 'high').length),
                    tone: 'danger',
                  },
                  {
                    id: 'sixty',
                    label: '60 Big Blinds Or More',
                    value: fmt(anomalies.filter((a) => a.severity === 'medium').length),
                    tone: 'attention',
                  },
                ]}
              />

              {anomalies.length === 0 ? (
                <ArenaState
                  tone="empty"
                  title="No Pot Reached Forty Big Blinds In The Last Thirty Days"
                />
              ) : (
                <>
                  <h3 className="arena-ops-eyebrow">Outsized Pots And Who Won Them</h3>
                  <p className="arena-ops-copy">
                    Every Pot At Or Above Forty Big Blinds In The Last Thirty Days, Largest Relative
                    To The Blind Level First. A Big Pot Is Not A Finding On Its Own.
                  </p>
                  <ul className="arena-ops-rows arena-ops-rows--single">
                    {anomalies.map((a, i) => (
                      <li key={`${a.hand_id}-${a.player_id}-${i}`}>
                        <div className={`arena-ledger-row ${styles.caseRow}`}>
                          <div className={styles.caseHead}>
                            <SeverityBadge severity={a.severity} />
                            <strong className={styles.flagType}>
                              {a.player_id.substring(0, 8)}
                            </strong>
                            <span className={styles.caseFigure}>{fmtChips(a.pot_total)}</span>
                          </div>
                          <p className={styles.caseLine}>
                            <span className={styles.foldedBadge}>Won The Pot</span> ·{' '}
                            <span className={styles.handRank}>
                              {String(a.hand_rank).replace(/_/g, ' ')}
                            </span>{' '}
                            · {timeAgo(a.completed_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
