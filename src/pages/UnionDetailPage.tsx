import { KINGS_CLUB_UUID } from '../lib/constants';
import { useKingsClubDisplayTotals } from '../hooks/useKingsClubDisplayTotals';
import { unionEcoSettingsPatch } from '../utils/unionEco';
import { isRetiredTournament, isRetiredTournamentTable } from '../lib/retiredTournamentVisibility';
import { getTournamentEntryCapacity } from '../utils/tournamentPresentation';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLUB ENGINE — Union Detail Page
 * Complete union management with financials and settlements
 *
 * #SmarterDesign (batch U1, 2026-11-28): the arena workspace. The chrome mast
 * heads the page with the live figures under it; the union, its readouts, the
 * tab keys and every tab's sections are chrome cases, chrome readout tiles,
 * chrome keys (the open tab lit) and chrome ledger rows. Every printed
 * figure, word and control is pinned by
 * tests/components/unionDetailPageIsPinned.test.tsx.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUnionRouteId } from '../hooks/useUnionRouteId';
import { getLocalStorage, setLocalStorage } from '../lib/storage';
import { unionService, type Union, type UnionClub } from '../services/UnionService';
import { unionApi } from '../services/UnionApiService';
import { tableService } from '../services/TableService';
import { getUserMemberships } from '../services/ClubsService';
import { confirmDialog } from '../components/common/confirmDialog';
import { useAuthUser } from '../hooks/useAuthUser';
import { supabase } from '../lib/supabase';
import { COUNT_UNKNOWN, countText, type CountFigure } from '../lib/countFigure';
import { PRESENCE_RECHECK_MS } from '../lib/profilePresence';
import { masterBus } from '../core/MasterBus';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';
import type { PokerTable, Tournament } from '../types/database.types';
import type { Club } from '../types/club.types';
import { useUnionStore } from '../stores/useUnionStore';
import {
  ArenaEmptyState,
  ArenaErrorState,
  ArenaLoadingState,
} from '../components/common/EmptyStateArena';
import styles from './UnionDetailPage.module.css';
import { useToast } from '../components/common/Toast';
import ConfirmModal from '../components/common/ConfirmModal';
import CreateTournamentModal from '../components/club/CreateTournamentModal';
import GameCreationActions from '../components/club/GameCreationActions';
import { getUnionLevel, getClubLevel } from '../utils/clubLevels';
import { reportError } from '../utils/errorReporter';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import { formatPopupText } from '../utils/popupStyle';
import './UnionDetailArena.css';
// Whole-number tournament money (Dan 2026-08-20).
import { formatBuyInShort } from '../utils/buyIn';
import UnionClubGovernance from '../components/union/UnionClubGovernance';
import {
  isFixedBoardSchedule,
  tournamentScheduleService,
  type TournamentScheduleRow,
} from '../services/TournamentScheduleService';
import { useTournamentScheduleList } from '../hooks/useTournamentScheduleList';
import { describeSchedule } from '../components/tournament/WeeklyScheduleEditor';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface SettlementRecord {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  clubId: string;
  clubName: string;
  rakeGenerated: number | null;
  unionShare: number | null;
  status: 'missing' | 'cancelled' | 'pending' | 'paid' | 'overdue' | 'disputed' | 'unverified';
  paidAt?: string;
}

interface FinancialSummary {
  totalRakeThisPeriod: number | null;
  unionRevenue: number | null;
  periodLabel: string;
  coverageLabel: string;
  pendingSettlements: number | null;
  overdueAmount: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function statementMoney(value: number | null): string {
  return value === null
    ? 'Unavailable'
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function UnionDetailPage() {
  /* /unions/<slug> in the URL, a UUID in every query (useUnionRouteId). */
  const { unionId, unionRef, resolutionStatus, retryResolution } = useUnionRouteId();
  const { user } = useAuthUser();
  const toast = useToast();
  useVisibilityRefresh(async () => {
    if (!unionId) return;
    try {
      const [unionData, tablesData] = await Promise.all([
        unionService.getUnion(unionId),
        tableService.getUnionTables(unionId),
      ]);
      if (unionData) setUnion(unionData);
      if (tablesData) setTables(tablesData);
    } catch (error) {
      reportError(error, 'UnionDetailPage.Visibility_refresh_failed');
    }
  });

  const navigate = useNavigate();
  const [union, setUnion] = useState<Union | null>(null);
  const [clubs, setClubs] = useState<UnionClub[]>([]);
  const kingsTotals = useKingsClubDisplayTotals(
    clubs.some((club) => club.clubId === KINGS_CLUB_UUID)
  );
  const [tableRows, setTables] = useState<PokerTable[]>([]);
  const tables = useMemo(
    () => tableRows.filter((row) => !isRetiredTournamentTable(row)),
    [tableRows]
  );
  const [unionTournamentRows, setUnionTournaments] = useState<Tournament[]>([]);
  const unionTournaments = useMemo(
    () => unionTournamentRows.filter((row) => !isRetiredTournament(row.id)),
    [unionTournamentRows]
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [canManageUnion, setCanManageUnion] = useState<boolean | null>(null);

  // The union surface is an operations page. Its owner and appointed admins
  // use the same authoritative predicate as Table Management; everybody else
  // is returned to Clubs without briefly seeing the operator controls.
  useEffect(() => {
    let cancelled = false;
    if (!union || !user?.id) {
      setCanManageUnion(null);
      return () => {
        cancelled = true;
      };
    }
    setCanManageUnion(null);
    void unionService
      .isUnionAdmin(union.id, user.id)
      .then((allowed) => {
        if (cancelled) return;
        setCanManageUnion(allowed);
        if (!allowed) navigate('/clubs', { replace: true });
      })
      .catch((error) => {
        reportError(error, 'UnionDetailPage.management_authority');
        if (cancelled) return;
        setCanManageUnion(false);
        navigate('/clubs', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, union?.id, user?.id]);

  const [activeTab, setActiveTabRaw] = useState<
    'overview' | 'clubs' | 'tables' | 'tournaments' | 'financials' | 'settings'
  >(() => getLocalStorage('ca_union_detail_tab', 'overview'));
  const setActiveTab = (t: typeof activeTab) => {
    setActiveTabRaw(t);
    setLocalStorage('ca_union_detail_tab', t);
  };

  // Financial state - starts empty, no demo data
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);

  const [financialError, setFinancialError] = useState<string | null>(null);

  const [ownedClubs, setOwnedClubs] = useState<Club[]>([]);
  const [showClubSelector, setShowClubSelector] = useState(false);
  const [applying, setApplying] = useState(false);
  const [visibleClubs, setVisibleClubs] = useState<Set<string>>(new Set());
  const [confirmJoin, setConfirmJoin] = useState<{ show: boolean; club: Club | null }>({
    show: false,
    club: null,
  });
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [ecoSettingsDirty, setEcoSettingsDirty] = useState(false);
  const [showXmttModal, setShowXmttModal] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    eco_cash_enabled: undefined as boolean | undefined,
    eco_cash_rate: undefined as number | undefined,
    eco_tournament_enabled: undefined as boolean | undefined,
    eco_tournament_rate: undefined as number | undefined,
    revenueSharePercent: 10,
    sharedPlayerPool: true,
    crossClubTournaments: false,
  });

  // ── Recurring tournament schedules (2026-08-22): the union owner's compact
  // manager over tournament_schedules. Loaded when the Tournaments tab opens. ──
  const {
    schedules,
    loading: schedulesLoading,
    error: schedulesError,
    updateActive,
  } = useTournamentScheduleList(unionId, activeTab === 'tournaments');
  const [scheduleBusyId, setScheduleBusyId] = useState<string | null>(null);

  const handleScheduleActiveToggle = async (row: TournamentScheduleRow, nextActive: boolean) => {
    if (scheduleBusyId) return;
    setScheduleBusyId(row.id);
    try {
      await tournamentScheduleService.setActive(row.id, nextActive);
      updateActive(row.id, nextActive);
      toast.success(nextActive ? 'Schedule activated.' : 'Schedule deactivated.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the schedule.');
    } finally {
      setScheduleBusyId(null);
    }
  };

  // Level-change detection — toast when union level goes up or down
  const prevLevelRef = useRef<number | null>(null);
  useEffect(() => {
    if (!union) return;
    const currentLevel = union.level || 1;
    if (prevLevelRef.current !== null && prevLevelRef.current !== currentLevel) {
      const uLevel = getUnionLevel({
        level: currentLevel,
        totalPlayers: union.totalPlayers || union.memberCount,
      });
      if (currentLevel > prevLevelRef.current) {
        toast.success(`Union leveled up to Lv.${currentLevel} - ${uLevel.tierLabel}!`);
      } else {
        toast.info(`Union level changed to Lv.${currentLevel} - ${uLevel.tierLabel}`);
      }
    }
    prevLevelRef.current = currentLevel;
  }, [union?.level]);

  /* ONLINE NOW IS THE DATABASE'S ANSWER (2026-10-05). This counted the people
     holding this page open on a Realtime presence channel - only people can
     join one, never a house player - and the header read unions.online_count,
     a column that does not exist, so it was always 0. Both figures now come
     from fn_union_online_count (seated, or a heartbeat under five minutes old:
     the one definition), re-asked on the presence cadence so the figure
     follows heartbeats going stale. A failed read says Unavailable. */
  const [onlineNow, setOnlineNow] = useState<CountFigure>(null);
  useEffect(() => {
    if (!unionId) return;
    let alive = true;
    /* Only the latest ask may answer: a slow read must not overwrite the
       newer figure that overtook it. */
    let latest = 0;
    setOnlineNow(null);
    const ask = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const seq = ++latest;
      unionService.getOnlineCount(unionId).then(
        (n) => {
          if (alive && seq === latest) setOnlineNow(n);
        },
        (e) => {
          reportError(e, 'UnionDetailPage.onlineCount');
          if (alive && seq === latest) setOnlineNow(COUNT_UNKNOWN);
        }
      );
    };
    /* A hidden tab is not re-asked; it is re-asked the moment it returns,
       rather than showing a figure up to a minute old. */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') ask();
    };
    ask();
    const timer = setInterval(ask, PRESENCE_RECHECK_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [unionId]);

  const loadingRef = useRef(false);

  // ── CRITICAL: Reset per-union state when navigating between unions ──
  useEffect(() => {
    setShowClubSelector(false);
    setApplying(false);
    setVisibleClubs(new Set());
    setConfirmJoin({ show: false, club: null });
    setIsUpdatingSettings(false);
    setShowXmttModal(false);
    setLoadError(null);
    loadingRef.current = false;
  }, [unionId]);

  useEffect(() => {
    if (!unionId) return;
    let isMounted = true;

    const loadData = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (isMounted) {
        setLoading(true);
        setFinancialSummary(null);
        setFinancialError(null);
        setSettlements([]);
        setLoadError(null);
      }
      try {
        /* No browser "self-heal" of the Midway Union (2026-10-05). It went
           through HorseOrchestrator, which inserted unions / union_clubs rows
           from whoever opened this page; the union exists, and a missing union
           is a data fault to fix where the data lives, not on page load. */
        const unionData = await unionService.getUnion(unionId);

        const clubsData = await unionService.getUnionClubs(unionId);
        const tablesData = await tableService.getUnionTables(unionId);

        if (!isMounted) return;

        // Prefer authoritative total_players from the unions table; fall back to client-side sum
        if (unionData) {
          if (!unionData.totalPlayers && !unionData.memberCount) {
            const computedMemberCount = (clubsData || []).reduce(
              (sum, c) => sum + (c.memberCount || 0),
              0
            );
            unionData.memberCount = computedMemberCount;
          } else if (unionData.totalPlayers > unionData.memberCount) {
            unionData.memberCount = unionData.totalPlayers;
          }
        }
        setUnion(unionData);
        setClubs(clubsData || []);
        const sortedTables = (tablesData || []).sort((a: PokerTable, b: PokerTable) => {
          const aPlayers = a.current_players || 0;
          const bPlayers = b.current_players || 0;
          if (aPlayers > 0 && bPlayers === 0) return -1;
          if (aPlayers === 0 && bPlayers > 0) return 1;
          return bPlayers - aPlayers;
        });
        setTables(sortedTables);

        if (unionData?.settings?.crossClubTournaments && clubsData && clubsData.length > 0) {
          const clubIds = clubsData.map((c) => c.clubId);
          const [{ data: clubTournaments }, { data: xmttTournaments }] = await Promise.all([
            // PRIVACY + COMPLETENESS FIX 2026-08-19: the first query listed by
            // member club id, exposing every club's PRIVATE tournaments
            // union-wide; the second required is_xmtt, hiding union-owned
            // non-XMTT games. Both are replaced by one union-scoped query:
            // union-OWNED tournaments only (private games carry union_id NULL).
            supabase
              .from('tournaments')
              .select('*, clubs(name)')
              .eq('union_id', unionId)
              .order('start_time', { ascending: true }),
            supabase
              .from('tournaments')
              .select('*, clubs(name)')
              .eq('union_id', unionId)
              .eq('is_xmtt', true)
              .limit(0),
          ]);
          if (!isMounted) return;
          const allTournaments = [...(clubTournaments || []), ...(xmttTournaments || [])];
          const seen = new Set<string>();
          const tournaments = allTournaments.filter((t) => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          });
          const statusOrder: Record<string, number> = {
            REGISTERING: 0,
            ANNOUNCED: 1,
            RUNNING: 2,
            COMPLETED: 3,
            CANCELLED: 4,
          };
          const sorted = (tournaments || []).sort((a: Tournament, b: Tournament) => {
            const aOrder = statusOrder[a.status] ?? 5;
            const bOrder = statusOrder[b.status] ?? 5;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
          });
          setUnionTournaments(sorted);
        }

        if (!isMounted) return;
        try {
          const settlementReport = await unionService.getSettlementReport(unionId);

          if (!isMounted) return;
          setFinancialError(null);
          setFinancialSummary({
            totalRakeThisPeriod: settlementReport.totalRakeCollected,
            unionRevenue: settlementReport.netUnionRevenue,
            pendingSettlements: settlementReport.pendingSettlements,
            overdueAmount: settlementReport.overdueAmount,
            periodLabel:
              settlementReport.periodStart && settlementReport.periodEnd
                ? `${settlementReport.periodStart} To ${settlementReport.periodEnd}`
                : 'No Issued Statement Period',
            coverageLabel: `${settlementReport.issuedClubs} Of ${settlementReport.totalClubs} Clubs Have Active Statements. Totals Cover Issued Statements Only.`,
          });
          setSettlements(
            settlementReport.clubBreakdowns.map((cb) => ({
              id: cb.invoiceId ?? `missing-${cb.clubId}`,
              periodStart: settlementReport.periodStart,
              periodEnd: settlementReport.periodEnd,
              clubId: cb.clubId,
              clubName: cb.clubName,
              rakeGenerated: cb.rakeCollected,
              unionShare: cb.unionShare,
              status: cb.status,
            }))
          );
        } catch (e) {
          reportError(e, 'UnionDetailPage.map');
          if (isMounted) {
            setFinancialSummary(null);
            setSettlements([]);
            setFinancialError(
              'Statement Data Is Unavailable. Open Weekly Statements To Check Access Or Try Again.'
            );
          }
        }
      } catch (err) {
        reportError(err, 'UnionDetailPage.Error_loading_data');
        toast.error('Failed to load union data');
        if (isMounted) setLoadError('Club Arena Could Not Load This Union Workspace.');
      } finally {
        loadingRef.current = false;
        if (isMounted) setLoading(false);
      }
    };

    loadData();
    return () => {
      isMounted = false;
    };
  }, [unionId, loadRevision]);

  // Sync settings form when union data loads or tab switches to settings
  useEffect(() => {
    if (activeTab === 'settings' && union?.settings) {
      setEcoSettingsDirty(false);
      setSettingsForm({
        eco_cash_enabled: union.settings.eco_cash_enabled,
        eco_cash_rate: union.settings.eco_cash_rate,
        eco_tournament_enabled: union.settings.eco_tournament_enabled,
        eco_tournament_rate: union.settings.eco_tournament_rate,
        revenueSharePercent: union.settings.revenueSharePercent,
        sharedPlayerPool: union.settings.sharedPlayerPool,
        crossClubTournaments: union.settings.crossClubTournaments,
      });
    }
  }, [activeTab, union]);

  // Stagger animation for clubs
  useEffect(() => {
    if (clubs.length === 0) return;
    setVisibleClubs(new Set());
    const timers = clubs.map((club, index) =>
      setTimeout(() => {
        setVisibleClubs((prev) => new Set(prev).add(club.clubId));
      }, index * 60)
    );
    return () => timers.forEach(clearTimeout);
  }, [clubs]);

  // ── Realtime: live union data updates ──
  useEffect(() => {
    if (!unionId) return;

    // Helper functions to reload data
    const reloadUnionClubs = async () => {
      try {
        const clubsData = await unionService.getUnionClubs(unionId);
        setClubs(clubsData || []);
      } catch (err) {
        // Non-critical: clubs reload failed
      }
    };

    const reloadUnionTournaments = async () => {
      try {
        if (union?.settings?.crossClubTournaments) {
          const clubIds = clubs.map((c) => c.clubId);
          if (clubIds.length === 0) {
            setUnionTournaments([]);
            return;
          }
          // Fetch both club-hosted and XMTT tournaments (same as initial load)
          const [{ data: clubTournaments }, { data: xmttTournaments }] = await Promise.all([
            // PRIVACY + COMPLETENESS FIX 2026-08-19: the first query listed by
            // member club id, exposing every club's PRIVATE tournaments
            // union-wide; the second required is_xmtt, hiding union-owned
            // non-XMTT games. Both are replaced by one union-scoped query:
            // union-OWNED tournaments only (private games carry union_id NULL).
            supabase
              .from('tournaments')
              .select('*, clubs(name)')
              .eq('union_id', unionId)
              .order('start_time', { ascending: true }),
            supabase
              .from('tournaments')
              .select('*, clubs(name)')
              .eq('union_id', unionId)
              .eq('is_xmtt', true)
              .limit(0),
          ]);
          const allT = [...(clubTournaments || []), ...(xmttTournaments || [])];
          const seen = new Set<string>();
          const tournaments = allT.filter((t) => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
          });

          // Sort: REGISTERING/ANNOUNCED first, then RUNNING, then by start_time desc
          const statusOrder: Record<string, number> = {
            REGISTERING: 0,
            ANNOUNCED: 1,
            RUNNING: 2,
            COMPLETED: 3,
            CANCELLED: 4,
          };
          const sorted = (tournaments || []).sort((a: Tournament, b: Tournament) => {
            const aOrder = statusOrder[a.status] ?? 5;
            const bOrder = statusOrder[b.status] ?? 5;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
          });
          setUnionTournaments(sorted);
        }
      } catch (err) {
        // Non-critical: tournaments reload failed
      }
    };

    const reloadUnion = async () => {
      try {
        const unionData = await unionService.getUnion(unionId);
        // Apply same totalPlayers→memberCount sync as initial load
        if (unionData) {
          if (!unionData.totalPlayers && !unionData.memberCount) {
            const computedMemberCount = (clubs || []).reduce(
              (sum, c) => sum + (c.memberCount || 0),
              0
            );
            unionData.memberCount = computedMemberCount;
          } else if (unionData.totalPlayers > unionData.memberCount) {
            unionData.memberCount = unionData.totalPlayers;
          }
        }
        setUnion(unionData);
      } catch (err) {
        // Non-critical: union reload failed
      }
    };

    const channelKey = `union-detail-${unionId}`;

    const channel = masterBus.getOrCreateChannel(channelKey);
    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'union_clubs',
          filter: `union_id=eq.${unionId}`,
        },
        (payload) => {
          // Reload clubs on INSERT/UPDATE/DELETE
          void reloadUnionClubs();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'unions',
          filter: `id=eq.${unionId}`,
        },
        (payload) => {
          // Reload union data on UPDATE
          void reloadUnion();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tournaments',
          /* DB LOAD PASS 2026-08-24: unfiltered, every tournament write on the
             platform woke this page, which then threw almost all of them away
             with the clubIds check below. `tournaments.union_id` is the exact
             scope this page cares about and it is evaluated server-side. The
             clubIds check stays as a second, narrower gate. */
          filter: `union_id=eq.${unionId}`,
        },
        (payload) => {
          // Reload tournaments on INSERT/UPDATE events
          const newRecord = payload.new as { club_id?: string; [key: string]: unknown } | null;
          const oldRecord = payload.old as { club_id?: string; [key: string]: unknown } | null;

          // Check if this tournament belongs to any of our union clubs
          const clubIds = clubs.map((c) => c.clubId);
          const relevantRecord = newRecord || oldRecord;

          if (
            relevantRecord &&
            relevantRecord.club_id &&
            clubIds.includes(relevantRecord.club_id)
          ) {
            void reloadUnionTournaments();
          }
        }
      )
      .subscribe((status: string, err?: Error) => {
        if (status === 'CHANNEL_ERROR') {
          if (err) reportError(err?.message || err, 'UnionDetailPage._Realtime_channel_error');
        }
        if (status === 'TIMED_OUT') {
          console.warn('[UnionDetailPage] Realtime channel timed out');
        }
      });

    // Subscribe to bus-level UNION_UPDATED events from service layer
    const unsubUnion = masterBus.subscribeDebounced(
      'UNION_UPDATED',
      (event) => {
        if (event.payload?.unionId === unionId) {
          void reloadUnion();
          void reloadUnionClubs();
        }
      },
      500
    );

    // Refresh online count + tables when a table changes across union clubs
    const unsubTable = masterBus.subscribeDebounced(
      'TABLE_UPDATED',
      () => {
        void reloadUnionClubs();
      },
      1000
    );

    return () => {
      masterBus.removeRegisteredChannel(channelKey);
      unsubUnion();
      unsubTable();
    };
  }, [unionId, union?.settings?.crossClubTournaments, clubs]);

  const handleApplyClick = async () => {
    if (!user) return;

    try {
      const memberships = await getUserMemberships();
      const myClubs = memberships
        .map((m: { club?: Club; clubs?: Club }) => m.club || m.clubs)
        .filter(Boolean) as Club[];
      const owned = myClubs.filter((c) => c?.owner_id === user.id);

      if (owned.length === 0) {
        toast.error('You must own a club to join a union.');
        return;
      }

      // IMPROVE 2026-07-21: if one of the caller's clubs is ALREADY in this
      // union, the action is a LEAVE REQUEST, not an application.
      const memberClub = owned.find((c: any) => c.union_id === unionId);
      if (memberClub) {
        if (
          !(await confirmDialog({
            message: `Request to remove ${memberClub.name} from this union? The union lead must approve.`,
            variant: 'danger',
          }))
        ) {
          return;
        }
        setApplying(true);
        try {
          await unionApi.requestLeave(unionId!, memberClub.id);
          toast.success('Leave request submitted - the union lead will review it.');
        } catch (leaveErr: any) {
          toast.error(leaveErr.message || 'Failed to submit leave request.');
        } finally {
          setApplying(false);
        }
        return;
      }

      if (owned.length === 1) {
        // Show confirmation modal instead of window.confirm
        setConfirmJoin({ show: true, club: owned[0] });
      } else {
        setOwnedClubs(owned);
        setShowClubSelector(true);
      }
    } catch (error) {
      reportError(error, 'UnionDetailPage.error');
      toast.error('Failed to load your clubs.');
    }
  };

  const applyWithClub = async (clubId: string) => {
    if (!unionId) return;
    setApplying(true);
    try {
      const success = await unionService.addClub(unionId, clubId);
      if (success) {
        toast.success('Application sent successfully!');
        setShowClubSelector(false);
      }
    } catch (error) {
      reportError(error, 'UnionDetailPage.error');
      toast.error('Failed to send application.');
    } finally {
      setApplying(false);
    }
  };

  // Memoize filtered table arrays BEFORE early returns (React hooks rule)
  const activeTables = useMemo(() => tables.filter((t) => (t.current_players || 0) > 0), [tables]);
  const emptyTables = useMemo(() => tables.filter((t) => (t.current_players || 0) === 0), [tables]);

  if (resolutionStatus === 'loading' || (resolutionStatus === 'ready' && loading)) {
    return (
      <div className="union-detail arena-workspace">
        <ArenaWorkspaceHeader area="operations" title="Union Command" context="Union Network" />
        <div className="arena-case arena-ops-case">
          <ArenaLoadingState message="Opening Union Command" />
        </div>
      </div>
    );
  }

  if (resolutionStatus === 'error' || loadError) {
    return (
      <div className="union-detail arena-workspace">
        <ArenaWorkspaceHeader area="operations" title="Union Command" context="Union Network" />
        <div className="arena-case arena-ops-case">
          <ArenaErrorState
            message={
              resolutionStatus === 'error'
                ? 'Could Not Load This Union. Please Try Again.'
                : loadError!
            }
            onRetry={
              resolutionStatus === 'error'
                ? retryResolution
                : () => setLoadRevision((value) => value + 1)
            }
          />
        </div>
      </div>
    );
  }

  if (resolutionStatus === 'not_found' || !union) {
    return (
      <div className="union-detail arena-workspace">
        <ArenaWorkspaceHeader area="operations" title="Union Command" context="Union Network" />
        <div className="arena-case arena-ops-case">
          <ArenaEmptyState
            icon="UNION"
            eyebrow="Network Unavailable"
            title="Union Not Found"
            description="This Union May Have Been Removed, Or The Link May Use An Outdated Identifier."
            /* Not /unions - see UnionDashboardPage: a person refused here would
             be refused there too since the directory became allowlisted. */
            action={{
              label: 'Back To Community',
              onClick: () => navigate('/community', { replace: true }),
            }}
            secondaryAction={{ label: 'Return To Arena', onClick: () => navigate('/') }}
          />
        </div>
      </div>
    );
  }

  if (user?.id && canManageUnion === null) {
    return (
      <div className="union-detail arena-workspace">
        <ArenaWorkspaceHeader area="operations" title="Union Command" context="Union Network" />
        <div className="arena-case arena-ops-case">
          <ArenaLoadingState message="Checking Union Management Access" />
        </div>
      </div>
    );
  }

  if (user?.id && canManageUnion === false) {
    return (
      <div className="union-detail arena-workspace">
        <ArenaWorkspaceHeader area="operations" title="Union Command" context="Union Network" />
        <div className="arena-case arena-ops-case">
          <ArenaLoadingState message="Returning To Your Clubs" />
        </div>
      </div>
    );
  }

  return (
    <div className="union-detail arena-workspace">
      <ArenaWorkspaceHeader
        area="operations"
        title={formatPopupText(union.name)}
        context="Union Network"
        summary={formatPopupText(
          union.description ||
            'Inspect This Connected Club Network, Its Live Games, Player Scale, And Governed Operations.'
        )}
      />
      <PageBar
        titleAs={false}
        showHelp={false}
        title={formatPopupText(union.name)}
        metrics={[
          { label: 'Clubs', value: union.clubCount },
          { label: 'Players', value: union.memberCount.toLocaleString(), tone: 'live' },
          { label: 'Online', value: countText(onlineNow), tone: 'attention' },
        ]}
      />
      <section className="arena-case arena-ops-case union-detail-identity">
        <div className="union-detail-identity__head">
          <div className="union-detail-avatar">
            {union.avatarUrl ? <img src={union.avatarUrl} alt="" /> : union.name.charAt(0)}
          </div>
          <div className="union-detail-identity__copy">
            <h2 className="arena-section-title">{union.name}</h2>
            <p className="arena-ops-copy">{union.description}</p>
          </div>
        </div>
        {canManageUnion ? (
          <>
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <Link to={`/unions/${unionRef}/table-management`}>Table Management</Link>
            </div>
            <GameCreationActions managementPath={`/unions/${unionRef}/table-management`} arena />
          </>
        ) : (
          <div className="arena-switch arena-ops-keys arena-ops-primary">
            <button onClick={handleApplyClick} disabled={applying}>
              {applying ? 'Applying...' : 'Apply To Join'}
            </button>
          </div>
        )}
      </section>

      {/* Club Selector Modal */}
      {showClubSelector && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => e.target === e.currentTarget && setShowClubSelector(false)}
        >
          <div className={styles.modal}>
            <h2>Select Club</h2>
            <p>Which Club Would You Like To Apply With?</p>
            <div className={styles.clubList}>
              {ownedClubs.map((c) => (
                <button
                  key={c.id}
                  className={styles.clubOption}
                  onClick={() => applyWithClub(c.id)}
                >
                  <strong>{c.name}</strong>
                  <span>ID: {c.club_id}</span>
                </button>
              ))}
            </div>
            <button className={styles.cancelButton} onClick={() => setShowClubSelector(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stats Row */}
      {(() => {
        const uLevel = getUnionLevel({
          level: union.level,
          playerLevel: union.playerLevel,
          hierarchyLevel: union.hierarchyLevel,
          totalPlayers: union.totalPlayers || union.memberCount,
          hierarchyUnitsRoundedUp: union.hierarchyUnitsRoundedUp,
          playerThresholdCurrent: union.playerThresholdCurrent,
          playerThresholdNext: union.playerThresholdNext,
          hierarchyThresholdCurrent: union.hierarchyThresholdCurrent,
          hierarchyThresholdNext: union.hierarchyThresholdNext,
        });
        return (
          <>
            <section className="arena-case arena-ops-case union-detail-readings">
              <div className="union-detail-stats">
                <div className="union-detail-stat arena-meter">
                  <span className="union-detail-stat__value">{union.clubCount}</span>
                  <span className="union-detail-stat__label">Member Clubs</span>
                </div>
                <div className="union-detail-stat arena-meter">
                  <span className="union-detail-stat__value" style={{ color: uLevel.color }}>
                    Lv.{uLevel.level}
                  </span>
                  <span className="union-detail-stat__label" style={{ color: uLevel.color }}>
                    {uLevel.tierLabel}
                  </span>
                </div>
                <div className="union-detail-stat arena-meter">
                  <span className="union-detail-stat__value">
                    {union.memberCount.toLocaleString()}
                  </span>
                  <span className="union-detail-stat__label">Total Players</span>
                </div>
                <div className="union-detail-stat arena-meter">
                  <span className="union-detail-stat__value union-detail-stat__value--live">
                    {countText(onlineNow)}
                  </span>
                  <span className="union-detail-stat__label">Online Now</span>
                </div>
                {financialSummary && (
                  <div className="union-detail-stat arena-meter">
                    <span className="union-detail-stat__value">
                      {statementMoney(financialSummary.unionRevenue)}
                    </span>
                    <span className="union-detail-stat__label">Latest Statement Share</span>
                  </div>
                )}
              </div>
              {/* Level Progress Bar */}
              <div className="union-detail-progress">
                <div
                  className="union-detail-progress__fill"
                  style={{ width: `${uLevel.progressPercent}%`, background: uLevel.gradient }}
                />
              </div>
              <div className="union-detail-progress__copy">
                {uLevel.progressPercent}% To Lv.{Math.min(uLevel.level + 1, 50)}
              </div>
            </section>
          </>
        );
      })()}

      {/* Tab Navigation */}
      <nav className="arena-switch arena-ops-keys union-detail-tabs">
        <button
          className={activeTab === 'overview' ? 'active' : undefined}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={activeTab === 'clubs' ? 'active' : undefined}
          onClick={() => setActiveTab('clubs')}
        >
          Clubs
        </button>
        <button
          className={activeTab === 'tables' ? 'active' : undefined}
          onClick={() => setActiveTab('tables')}
        >
          Tables
        </button>
        <button
          className={activeTab === 'financials' ? 'active' : undefined}
          onClick={() => setActiveTab('financials')}
        >
          Financials
        </button>
        {union?.settings?.crossClubTournaments && (
          <button
            className={activeTab === 'tournaments' ? 'active' : undefined}
            onClick={() => setActiveTab('tournaments')}
          >
            Tournaments
          </button>
        )}
        {union?.ownerId === user?.id && (
          <button
            className={activeTab === 'settings' ? 'active' : undefined}
            onClick={() => {
              setActiveTab('settings');
              // Load current settings
              if (union?.settings) {
                setSettingsForm({
                  eco_cash_enabled: union.settings.eco_cash_enabled,
                  eco_cash_rate: union.settings.eco_cash_rate,
                  eco_tournament_enabled: union.settings.eco_tournament_enabled,
                  eco_tournament_rate: union.settings.eco_tournament_rate,
                  revenueSharePercent: union.settings.revenueSharePercent,
                  sharedPlayerPool: union.settings.sharedPlayerPool,
                  crossClubTournaments: union.settings.crossClubTournaments,
                });
              }
            }}
          >
            Settings
          </button>
        )}
      </nav>

      {/* Tab Content */}
      <section className="union-detail-tab">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="union-detail-grid">
            {/* Union Activity Summary */}
            <div className="arena-case arena-ops-case">
              <h3 className="arena-section-title">Union Activity</h3>
              <div className="union-detail-stats union-detail-stats--three">
                <div className="union-detail-stat arena-meter">
                  <div className="union-detail-stat__value union-detail-stat__value--live">
                    {tables.filter((t) => (t.current_players || 0) > 0).length}
                  </div>
                  <div className="union-detail-stat__label">Active Tables</div>
                </div>
                <div className="union-detail-stat arena-meter">
                  <div className="union-detail-stat__value union-detail-stat__value--live">
                    {tables.reduce((sum, t) => sum + (t.current_players || 0), 0)}
                  </div>
                  <div className="union-detail-stat__label">Seated Players</div>
                </div>
                <div className="union-detail-stat arena-meter">
                  <div className="union-detail-stat__value union-detail-stat__value--live">
                    {
                      unionTournaments.filter(
                        (t: any) => t.status === 'RUNNING' || t.status === 'REGISTERING'
                      ).length
                    }
                  </div>
                  <div className="union-detail-stat__label">Tournaments</div>
                </div>
              </div>
            </div>

            <div className="arena-case arena-ops-case">
              <h3 className="arena-section-title">
                {' '}
                Live Tables ({tables.filter((t) => (t.current_players || 0) > 0).length} Active)
              </h3>
              {tables.filter((t) => (t.current_players || 0) > 0).length === 0 ? (
                <div className="union-detail-empty">
                  <div className="union-detail-empty__mark">◆</div>
                  <p>No Active Tables - Games Will Appear Here When Clubs Start Playing</p>
                </div>
              ) : (
                <div className="union-detail-rows">
                  {tables
                    .filter((t) => (t.current_players || 0) > 0)
                    .slice(0, 8)
                    .map((table) => (
                      <Link
                        key={table.id}
                        to={`/table/${table.id}`}
                        className="arena-ledger-row union-detail-row"
                      >
                        <span className="union-detail-row__name">{table.name}</span>
                        <span className="union-detail-row__live">
                          {table.small_blind}/{table.big_blind}
                        </span>
                        <span>
                          {table.current_players}/{table.max_players}
                        </span>
                      </Link>
                    ))}
                  {tables.filter((t) => (t.current_players || 0) > 0).length > 8 && (
                    <div className="arena-switch arena-ops-keys">
                      <button onClick={() => setActiveTab('tables')}>
                        View All {tables.length} Tables →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="arena-case arena-ops-case">
              <h3 className="arena-section-title"> Top Clubs</h3>
              <div className="union-detail-rows">
                {clubs.slice(0, 5).map((club) => {
                  const cLevel = getClubLevel({ playerCount: club.memberCount });
                  return (
                    <Link
                      key={club.clubId}
                      to={`/clubs/${club.clubId}`}
                      className="arena-ledger-row union-detail-row"
                    >
                      <div className="union-detail-avatar union-detail-avatar--small">
                        {club.clubName?.charAt(0) || '?'}
                      </div>
                      <div className="union-detail-row__copy">
                        <strong>{club.clubName}</strong>
                        <span className="union-detail-row__meta">
                          <span className="union-detail-level" style={{ color: cLevel.color }}>
                            Lv.{cLevel.level}
                          </span>
                          {club.clubId === KINGS_CLUB_UUID
                            ? `${kingsTotals?.member_total?.toLocaleString() ?? '…'} Members`
                            : `${club.memberCount} ${club.memberCount === 1 ? 'Member' : 'Members'}`}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {financialSummary && (
              <div className="arena-case arena-ops-case">
                <h3 className="arena-section-title"> Latest Issued Statements</h3>
                <p className="arena-ops-copy">{financialSummary.periodLabel}</p>
                <p className="arena-ops-copy">{financialSummary.coverageLabel}</p>
                <div className="union-detail-quick">
                  <div>
                    <span>Recorded Rake</span>
                    <strong>{statementMoney(financialSummary.totalRakeThisPeriod)}</strong>
                  </div>
                  <div>
                    <span>Recorded Union Share</span>
                    <strong className="union-detail-positive">
                      {statementMoney(financialSummary.unionRevenue)}
                    </strong>
                  </div>
                  <div>
                    <span>Pending</span>
                    <strong>
                      {financialSummary.pendingSettlements === null
                        ? 'Unavailable'
                        : financialSummary.pendingSettlements}{' '}
                      Settlement
                      {financialSummary.pendingSettlements !== 1 ? 's' : ''}
                    </strong>
                  </div>
                  {financialSummary.overdueAmount !== null &&
                    financialSummary.overdueAmount > 0 && (
                      <div>
                        <span>Overdue</span>
                        <strong className="union-detail-negative">
                          {financialSummary.overdueAmount.toLocaleString()}
                        </strong>
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Clubs Tab */}
        {activeTab === 'clubs' && (
          <div className="arena-case arena-ops-case union-detail-rows">
            {clubs.length === 0 ? (
              <div className="union-detail-empty">
                <div className="union-detail-empty__mark">⌂</div>
                <p className="union-detail-empty__title">No Clubs Yet</p>
                <p>Invite Clubs To Join Your Union To Get Started</p>
              </div>
            ) : (
              clubs.map((club) => {
                const cLevel = getClubLevel({ playerCount: club.memberCount });
                const clubTables = tables.filter((t: any) => t.club_id === club.clubId);
                const activeTableCount = clubTables.filter(
                  (t) => (t.current_players || 0) > 0
                ).length;
                return (
                  <Link
                    key={club.clubId}
                    to={`/clubs/${club.clubId}`}
                    className={`arena-ledger-row union-detail-row union-detail-club${
                      visibleClubs.has(club.clubId) ? ' union-detail-club--shown' : ''
                    }`}
                  >
                    <div className="union-detail-avatar">{club.clubName?.charAt(0) || '?'}</div>
                    <div className="union-detail-row__copy">
                      <h4>
                        {club.clubName}
                        <span className="union-detail-level" style={{ color: cLevel.color }}>
                          Lv.{cLevel.level}
                        </span>
                      </h4>
                      <p>Owner: {club.ownerName || 'Unknown'}</p>
                      <span className="union-detail-row__meta">
                        {club.clubId === KINGS_CLUB_UUID
                          ? `${kingsTotals?.member_total?.toLocaleString() ?? '…'} Members`
                          : `${club.memberCount} ${club.memberCount === 1 ? 'Member' : 'Members'}`}
                        {activeTableCount > 0 && (
                          <span className="union-detail-row__live">
                            {activeTableCount} {activeTableCount === 1 ? 'Table' : 'Tables'}
                          </span>
                        )}
                      </span>
                    </div>
                    {union?.ownerId === user?.id && unionId && (
                      // Governance, not a delete: exit blockers are read first so the
                      // owner sees live seats, open entries, unsettled rake and agent
                      // credit before anything is unwound.
                      <span
                        className="union-detail-row__governance"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <UnionClubGovernance
                          unionId={unionId}
                          clubId={club.clubId}
                          clubName={club.clubName}
                          onExpelled={(id) =>
                            setClubs((prev) => prev.filter((c) => c.clubId !== id))
                          }
                        />
                      </span>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        )}

        {/* Tables Tab */}
        {activeTab === 'tables' && (
          <div className="arena-case arena-ops-case">
            {tables.length === 0 ? (
              <div className="union-detail-empty">
                <div className="union-detail-empty__mark">▦</div>
                <p className="union-detail-empty__title">No Tables Active</p>
                <p>Your Clubs&apos; Tables Will Appear Here When Games Start</p>
              </div>
            ) : (
              <>
                {activeTables.length > 0 && (
                  <>
                    <h3 className="arena-section-title">Active Tables ({activeTables.length})</h3>
                    <div className="union-detail-cards">
                      {activeTables.map((table) => (
                        <div key={table.id} className="arena-ledger-row union-detail-card">
                          <div className="union-detail-card__head">
                            <h4>{table.name}</h4>
                            <span className="union-detail-dot" />
                          </div>
                          <div className="union-detail-card__details">
                            <span>
                              {table.small_blind}/{table.big_blind}
                            </span>
                            <span className="union-detail-card__variant">
                              {(table as any).game_variant || 'NLH'}
                            </span>
                            <span>
                              {table.current_players}/{table.max_players}
                            </span>
                          </div>
                          <div className="arena-switch arena-ops-keys">
                            <Link to={`/table/${table.id}`}>View Table</Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {emptyTables.length > 0 && (
                  <>
                    <h3 className="arena-section-title">Empty Tables ({emptyTables.length})</h3>
                    <div className="union-detail-cards">
                      {emptyTables.map((table) => (
                        <div
                          key={table.id}
                          className="arena-ledger-row union-detail-card union-detail-card--idle"
                        >
                          <div className="union-detail-card__head">
                            <h4>{table.name}</h4>
                          </div>
                          <div className="union-detail-card__details">
                            <span>
                              {table.small_blind}/{table.big_blind}
                            </span>
                            <span className="union-detail-card__variant">
                              {(table as any).game_variant || 'NLH'}
                            </span>
                            <span>0/{table.max_players}</span>
                          </div>
                          <div className="arena-switch arena-ops-keys">
                            <Link to={`/table/${table.id}`}>View Table</Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Tournaments Tab */}
        {activeTab === 'tournaments' && union?.settings?.crossClubTournaments && (
          <div className="arena-case arena-ops-case">
            <div className="union-detail-section-head">
              <div>
                <h3 className="arena-section-title">Union Tournaments (XMTT)</h3>
                <p className="arena-ops-copy">Tournaments Open To All Member Clubs</p>
              </div>
              {union?.ownerId === user?.id && clubs.length > 0 && (
                <div className="arena-switch arena-ops-keys arena-ops-primary">
                  <button onClick={() => setShowXmttModal(true)}>+ Create XMTT</button>
                </div>
              )}
            </div>
            {unionTournaments.length === 0 ? (
              <div className="union-detail-empty">
                <p>No Union Wide Tournaments Scheduled</p>
                {union?.ownerId === user?.id && (
                  <div className="arena-switch arena-ops-keys arena-ops-primary">
                    <button onClick={() => setShowXmttModal(true)}>+ Create First XMTT</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="union-detail-cards">
                {unionTournaments.map((t) => (
                  <div key={t.id} className="arena-ledger-row union-detail-card">
                    <div className="union-detail-card__head">
                      <h4>{t.name}</h4>
                      <span className="union-detail-badge">{t.status}</span>
                    </div>
                    <div className="union-detail-card__details">
                      {/* hide_club_name (2026-08-22): never leak the hosting
                          club's name when the owner chose to hide it. */}
                      <span>
                        {' '}
                        {union?.name || (t.hide_club_name ? 'Union' : t.clubs?.name) || 'Union'}
                      </span>
                      {/* The advertised buy-in is the TOTAL (prize + fee), in
                          whole chips - never the prize half on its own. */}
                      <span> {formatBuyInShort(t.buy_in_amount || 0, t.buy_in_fee, t)}</span>
                      <span>
                        {' '}
                        {t.current_players || 0}
                        {getTournamentEntryCapacity(t) !== null ? `/${t.max_players}` : ''}
                      </span>
                      <span> {new Date(t.start_time).toLocaleDateString()}</span>
                    </div>
                    <div className="arena-switch arena-ops-keys">
                      <Link to={`/tournaments/${t.id}`}>View Details</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Recurring Schedules (2026-08-22, owner only): the union's
                tournament_schedules rows. Active toggle goes through
                fn_upsert_tournament_schedule; Remove is the soft delete
                (fn_delete_tournament_schedule, active=false). ── */}
            {union?.ownerId === user?.id && schedulesLoading && (
              <p role="status">Loading Recurring Schedules...</p>
            )}
            {union?.ownerId === user?.id && schedulesError && <p role="alert">{schedulesError}</p>}
            {union?.ownerId === user?.id && schedules.length > 0 && (
              <>
                <h3 className="arena-section-title">Recurring Schedules</h3>
                <div className="union-detail-cards">
                  {schedules.map((s) => (
                    <div
                      key={s.id}
                      className={`arena-ledger-row union-detail-card${
                        s.active ? '' : ' union-detail-card--idle'
                      }`}
                    >
                      <div className="union-detail-card__head">
                        <h4>{s.name}</h4>
                        <span
                          className={`union-detail-badge ${
                            s.active ? 'union-detail-badge--good' : 'union-detail-badge--bad'
                          }`}
                        >
                          {s.active ? 'ACTIVE' : 'OFF'}
                        </span>
                      </div>
                      <div className="union-detail-card__details">
                        <span>
                          {describeSchedule(
                            s.days_of_week,
                            s.start_times_utc,
                            s.interval_minutes,
                            s.time_zone
                          )}
                        </span>
                      </div>
                      {/* The hard-coded daily board (2026-10-16) is written by
                          the engine every ten minutes and the database refuses
                          an owner edit of it, so it offers no button that would
                          only appear to work. */}
                      {isFixedBoardSchedule(s) ? (
                        <div className="union-detail-card__details">
                          <span>Fixed Daily Board</span>
                        </div>
                      ) : (
                        <div className="arena-switch arena-ops-keys">
                          <button
                            disabled={scheduleBusyId === s.id}
                            onClick={() => handleScheduleActiveToggle(s, !s.active)}
                          >
                            {scheduleBusyId === s.id
                              ? 'Working...'
                              : s.active
                                ? 'Deactivate'
                                : 'Reactivate'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Financials Tab */}
        {activeTab === 'financials' && (
          <div className="union-detail-finance">
            {/*
              The weekly square-up board. It lives on its own page because it
              is per-period and per-club, and because the one thing it has to
              show - a club that was never billed - needs the whole club list
              beside the invoice list to be visible at all.
            */}
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <button type="button" onClick={() => navigate(`/unions/${unionRef}/statements`)}>
                Weekly Statements And Square-Up
              </button>

              {/*
              What the union PRODUCED, as against what it billed. Until this
              existed the rake snapshot could only be reached from inside a
              member club, so a union lead who owns no club had no door to
              their own union's figures. A route with nothing linking to it is
              a route nobody finds - /union-dashboard sat unlinked for months,
              two comments below this one.
            */}
              <button type="button" onClick={() => navigate(`/unions/${unionRef}/data`)}>
                Union Rake And Production Data
              </button>
            </div>

            {financialError && (
              <p role="alert" className="union-detail-alert">
                {financialError}
              </p>
            )}
            {financialSummary && (
              <>
                <p className="arena-ops-copy">{financialSummary.periodLabel}</p>
                <p className="arena-ops-copy">{financialSummary.coverageLabel}</p>
                {/* Summary Cards */}
                <div className="union-detail-stats">
                  <div className="union-detail-stat arena-meter union-detail-money">
                    <span className="union-detail-money__icon">%</span>
                    <div>
                      <span className="union-detail-stat__value">
                        {statementMoney(financialSummary.totalRakeThisPeriod)}
                      </span>
                      <span className="union-detail-stat__label">Recorded Statement Rake</span>
                    </div>
                  </div>
                  <div className="union-detail-stat arena-meter union-detail-money">
                    <span className="union-detail-money__icon">◉</span>
                    <div>
                      <span className="union-detail-stat__value union-detail-positive">
                        {statementMoney(financialSummary.unionRevenue)}
                      </span>
                      <span className="union-detail-stat__label">Recorded Union Share</span>
                    </div>
                  </div>
                  <div className="union-detail-stat arena-meter union-detail-money">
                    <span className="union-detail-money__icon">◷</span>
                    <div>
                      <span className="union-detail-stat__value">
                        {financialSummary.pendingSettlements === null
                          ? 'Unavailable'
                          : financialSummary.pendingSettlements}
                      </span>
                      <span className="union-detail-stat__label">Pending Settlements</span>
                    </div>
                  </div>
                  {financialSummary.overdueAmount !== null &&
                    financialSummary.overdueAmount > 0 && (
                      <div className="union-detail-stat arena-meter union-detail-money union-detail-money--overdue">
                        <span className="union-detail-money__icon">!</span>
                        <div>
                          <span className="union-detail-stat__value union-detail-negative">
                            {financialSummary.overdueAmount.toLocaleString()}
                          </span>
                          <span className="union-detail-stat__label">Overdue</span>
                        </div>
                      </div>
                    )}
                </div>

                {/* Settlement History */}
                <div className="arena-case arena-ops-case">
                  <h3 className="arena-section-title"> Statements For Selected Period</h3>
                  {/* 2026-08-19: /union-dashboard had NO link anywhere in the app —
                  it was reachable only by typing the URL. That is where the
                  union wallet, the treasury and the weekly player win/loss
                  settlement live, so in practice none of it was visible to the
                  people who own it. */}
                  <p className="arena-ops-copy">
                    Weekly Player Win/Loss Settlement, Wallet And Treasury Live On The{' '}
                    <Link to={`/unions/${unionRef}/operations`} className="union-detail-link">
                      Union Dashboard
                    </Link>
                    .
                  </p>
                  <div className="union-detail-table-well">
                    <table className="union-detail-table">
                      <thead>
                        <tr>
                          <th>Period</th>
                          <th>Club</th>
                          <th>Rake</th>
                          <th>Union Share</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {settlements.map((s) => (
                          <tr key={s.id}>
                            <td>
                              {s.periodStart && s.periodEnd
                                ? `${s.periodStart} To ${s.periodEnd}`
                                : 'No Issued Period'}
                            </td>
                            <td>{s.clubName}</td>
                            <td>{statementMoney(s.rakeGenerated)}</td>
                            <td className="union-detail-positive">
                              {statementMoney(s.unionShare)}
                            </td>
                            <td>
                              <span
                                className={`union-detail-badge union-detail-badge--${s.status}`}
                              >
                                {s.status === 'unverified'
                                  ? 'Payment Details Unavailable'
                                  : s.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Settings Tab - Owner Only */}
        {activeTab === 'settings' && union?.ownerId === user?.id && (
          <div className="union-detail-settings">
            <div className="arena-case arena-ops-case">
              <h3 className="arena-section-title"> Revenue Configuration</h3>
              <p className="arena-ops-copy">
                Configure How Revenue Is Split Between The Union And Clubs
              </p>

              <div className="union-detail-setting">
                <label>Revenue Share %</label>
                <div className="union-detail-slider">
                  <input
                    type="range"
                    min="0"
                    max="30"
                    value={settingsForm.revenueSharePercent}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        revenueSharePercent: Number(e.target.value),
                      }))
                    }
                    className="union-detail-slider__input"
                  />
                  <span className="union-detail-slider__value">
                    {settingsForm.revenueSharePercent}%
                  </span>
                </div>
                <p className="union-detail-hint">Percentage Of Club Rake That Goes To The Union</p>
              </div>

              <div className="union-detail-setting">
                <label className="union-detail-toggle">
                  <input
                    type="checkbox"
                    checked={settingsForm.sharedPlayerPool}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, sharedPlayerPool: e.target.checked }))
                    }
                  />
                  Shared Player Pool
                </label>
                <p className="union-detail-hint">Allow Players To Sit At Any Club’s Tables</p>
              </div>

              <div className="union-detail-setting">
                <label className="union-detail-toggle">
                  <input
                    type="checkbox"
                    checked={settingsForm.crossClubTournaments}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        crossClubTournaments: e.target.checked,
                      }))
                    }
                  />
                  Cross-Club Tournaments
                </label>
                <p className="union-detail-hint">Enable Union-Wide Tournament Scheduling</p>
              </div>

              {(['cash', 'tournament'] as const).map((activity) => {
                const enabledKey =
                  activity === 'cash' ? 'eco_cash_enabled' : 'eco_tournament_enabled';
                const rateKey = activity === 'cash' ? 'eco_cash_rate' : 'eco_tournament_rate';
                const label = activity === 'cash' ? 'Cash ECO' : 'Tournament ECO';
                return (
                  <div className="union-detail-setting" key={activity}>
                    <label className="union-detail-toggle">
                      <input
                        type="checkbox"
                        checked={settingsForm[enabledKey] === true}
                        onChange={(e) => {
                          setEcoSettingsDirty(true);
                          setSettingsForm((prev) => ({ ...prev, [enabledKey]: e.target.checked }));
                        }}
                      />
                      {label}
                    </label>
                    <label>
                      {label} Configured Rate %
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        className="arena-ops-well union-detail-rate"
                        aria-label={`${label} Rate`}
                        placeholder="Not Configured"
                        value={
                          settingsForm[rateKey] === undefined ? '' : settingsForm[rateKey]! * 100
                        }
                        onChange={(e) => {
                          setEcoSettingsDirty(true);
                          setSettingsForm((prev) => ({
                            ...prev,
                            [rateKey]:
                              e.target.value === '' ? undefined : Number(e.target.value) / 100,
                          }));
                        }}
                      />
                    </label>
                    <p className="union-detail-hint">
                      {settingsForm[enabledKey] === undefined ? 'Not Configured. ' : ''}Separate
                      Club Profit / Loss. Horses And All Players Included.
                    </p>
                  </div>
                );
              })}
              <p className="union-detail-hint">
                ECO Changes Apply At The Server-Confirmed Accounting Boundary.
              </p>
              {union.ecoTermsEffectiveFrom && (
                <p className="union-detail-hint">
                  ECO Terms Effective From {union.ecoTermsEffectiveFrom}
                </p>
              )}

              {!union.ecoTermsEffectiveFrom && (
                <p className="union-detail-hint">ECO Effective Accounting Boundary Unavailable.</p>
              )}

              <div className="arena-switch arena-ops-keys arena-ops-primary">
                <button
                  onClick={async () => {
                    if (!unionId || isUpdatingSettings) return;
                    let ecoPatch: Record<string, boolean | number>;
                    try {
                      ecoPatch = unionEcoSettingsPatch(settingsForm, ecoSettingsDirty);
                    } catch {
                      toast.error('Configure Both ECO Switches And Rates Before Saving');
                      return;
                    }
                    const generalSettings = {
                      revenueSharePercent: settingsForm.revenueSharePercent,
                      sharedPlayerPool: settingsForm.sharedPlayerPool,
                      crossClubTournaments: settingsForm.crossClubTournaments,
                    };
                    setIsUpdatingSettings(true);
                    try {
                      const updated = await unionService.updateUnion(unionId, {
                        settings: { ...generalSettings, ...ecoPatch },
                      });
                      if (updated) {
                        setUnion(updated);
                        toast.success('Settings saved successfully!');
                      }
                    } catch (error) {
                      reportError(error, 'Union Settings');
                      toast.error('Settings Could Not Be Saved');
                    } finally {
                      setIsUpdatingSettings(false);
                    }
                  }}
                  disabled={isUpdatingSettings}
                >
                  {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* XMTT Creation Modal */}
      {showXmttModal && clubs.length > 0 && unionId && (
        <CreateTournamentModal
          clubId={clubs[0].clubId}
          unionId={unionId}
          onClose={() => setShowXmttModal(false)}
          onSuccess={() => {
            setShowXmttModal(false);
            // Reload union tournaments (club-hosted + XMTT, same as initial load)
            if (union?.settings?.crossClubTournaments && clubs.length > 0) {
              const clubIds = clubs.map((c) => c.clubId);
              Promise.all([
                // PRIVACY + COMPLETENESS FIX 2026-08-19 — see note above.
                supabase
                  .from('tournaments')
                  .select('*, clubs(name)')
                  .eq('union_id', unionId)
                  .order('start_time', { ascending: true }),
                supabase
                  .from('tournaments')
                  .select('*, clubs(name)')
                  .eq('union_id', unionId)
                  .eq('is_xmtt', true)
                  .limit(0),
              ]).then(([{ data: clubT }, { data: xmttT }]) => {
                const allT = [...(clubT || []), ...(xmttT || [])];
                const seen = new Set<string>();
                const deduped = allT.filter((t) => {
                  if (seen.has(t.id)) return false;
                  seen.add(t.id);
                  return true;
                });
                const statusOrder: Record<string, number> = {
                  REGISTERING: 0,
                  ANNOUNCED: 1,
                  RUNNING: 2,
                  COMPLETED: 3,
                  CANCELLED: 4,
                };
                deduped.sort((a: any, b: any) => {
                  const aO = statusOrder[a.status] ?? 5;
                  const bO = statusOrder[b.status] ?? 5;
                  if (aO !== bO) return aO - bO;
                  return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
                });
                setUnionTournaments(deduped);
              });
            }
          }}
        />
      )}

      {/* Join Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmJoin.show}
        title="Join Union"
        message={`Apply to join ${union?.name} with your club "${confirmJoin.club?.name}"?`}
        confirmText="Apply"
        cancelText="Cancel"
        onConfirm={async () => {
          if (confirmJoin.club) {
            await applyWithClub(confirmJoin.club.id);
          }
          setConfirmJoin({ show: false, club: null });
        }}
        onCancel={() => setConfirmJoin({ show: false, club: null })}
        loading={applying}
      />
    </div>
  );
}
