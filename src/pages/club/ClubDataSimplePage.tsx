import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import { clubDataRequestedRangeError, clubDataOldestDay } from '../../lib/clubDataRange';
import ClubDataSourceDetails, {
  type ClubDataSourceRow,
} from '../../components/club/ClubDataSourceDetails';
import ClubDataReportGuide from '../../components/club/ClubDataReportGuide';
import { useClubDataFilters, clubDataContextQuery } from '../../hooks/useClubDataFilters';
/**
 * CLUB DATA (the owner's everyday screen)
 * ============================================================================
 * Dan 2026-10-14: "THE DATA PAGE IS NOT ACCURATE, AND THE UI NEEDS TO BE
 * IMPROVED TO BE MORE 'POKER BROS' STYLE AND SIMPLICITY. MAKE SURE THAT ALL
 * THE DATA IS REAL TIME ACCURATE DATA."
 *
 * One screen, one read: ca_club_data_screen. It answers what the club has
 * generated in the window - games, total winnings, MTT winnings, fee - and
 * one row per game, all under the same filters.
 *
 * Why the numbers are live (migration 20261015100638): cash rake and cash
 * buy-ins / cash-outs are now written to club_table_daily by the same insert
 * triggers that already fed tournaments, in the transaction that moves the
 * money. Nothing waits for an hourly rebuild. A seated player's stack counts
 * toward winnings, so chips on the felt no longer read as a loss.
 *
 * The page re-reads every 15 seconds on the 1 Day view (60 seconds on the
 * longer windows, which cost the database more), and immediately when the
 * tab comes back into view. A read that fails keeps the last good figures on
 * screen and says so; it never paints zeros.
 *
 * THE DAY (stage 2 reader contract, 2026-11-15). For a Midway Union member
 * club, or the union itself, a day is the union invoice's ACCOUNTING day,
 * midnight to midnight America/Los_Angeles, including daylight-saving
 * boundaries, and every figure comes from the invoice's own accounting
 * records: Fee is the rake credited to the club, Total Winnings the players'
 * accounting result. Standalone and pre-union net-flow reports also use Pacific
 * midnight. The reader
 * says which basis it answered on, and the page labels and counts by it.
 * The page and calendar carry the first and last day, inclusive, just as the
 * readers do. Nov 9 through Nov 15 is Monday through Sunday, seven days.
 * New URLs carry dataStart/dataEnd; older exclusive dataUntil links remain readable.
 * The calendar selects inclusive dates: the same date twice selects one day.
 * A fresh visit and every 1 Day preset start on today; explicit links retain their range.
 * Boundary timestamps on the page are Chicago time.
 * The full operator report (union statement, per-player breakdown, export)
 * opens inside this page.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthUser } from '../../hooks/useAuthUser';
import { resolveClubUUID, isUUID } from '../../utils/clubIdResolver';
import { isAuthzError } from '../../utils/clubDashboard';
import { reportError } from '../../utils/errorReporter';
import styles from './ClubDataSimplePage.module.css';
import {
  CLUB_DATA_PRESETS,
  type ClubDataPreset,
  clubDataRangeDays,
  clubDataRangeError,
  readClubDataPreset,
  readClubDataRange,
  writeClubDataRange,
} from '../../lib/clubDataRange';
import ClubDataTotalsBreakdown from './ClubDataTotalsBreakdown';
import DataHelpTip from '../../components/club/DataHelpTip';
import ClubDataRangeCalendar from '../../components/club/ClubDataRangeCalendar';
import ClubDataReconciliation from '../../components/club/ClubDataReconciliation';
import type { ClubDataReconciliation as Reconciliation } from '../../lib/clubDataReconciliation';
import { useClubDataDayRollover } from '../../hooks/useClubDataDayRollover';
import ClubDataByClub, { isClubRows, type ClubDataClubRow } from './ClubDataByClub';
import { useClubGameHost } from '../../hooks/useClubGameHost';
import { usePageTitle } from '../../hooks/usePageTitle';
import { ClubRosterService, type RosterMember } from '../../services/ClubRosterService';
import { titleCase } from '../../utils/titleCase';
import { playerDisplayName } from '../../utils/playerDisplayName';
import { useFitText } from '../../components/lobby/game-cards/useFitText';
import {
  ACCOUNTING_DAY_BASIS,
  CLUB_DATA_ZONE_LABEL,
  addCalendarDays,
  chicagoClock,
  chicagoStamp,
  clubDataBoundaryClock,
  clubDataDayBasis,
  clubDataDayOn,
  clubDataDayRule,
  clubDataWindowLabel,
  coverageNotices,
  coverageWindowLabel,
  isCalendarDate,
  isUnionClubAnswer,
  UNION_BASIS_DEFINITIONS,
  type ClubDataCoverage,
  type ClubDataDayBasis,
} from '../../lib/clubDataDay';
import {
  CLUB_DATA_PACIFIC_INCOMPLETE_COPY,
  isClubDataPacificIncomplete,
} from './clubDataReadOutcome';
import { figureDigits, formatWalletChips, type FigureInput } from '../../utils/format';

import { clubDataReportPath } from '../../utils/clubDataReportPath';
const ClubReport = lazy(() => import('./ClubDataPage'));

type GameFilter = 'ALL' | 'HOLDEM' | 'OMAHA' | 'MIXED' | 'MTT' | 'SNG';
type StakesFilter = 'ALL' | 'MICRO' | 'SMALL' | 'MID' | 'HIGH';

export interface ClubDataSummary {
  reconciliation?: Reconciliation | null;
  games: number;
  total_winnings: number;
  mtt_winnings: number;
  /** Entries and payouts so far of MTTs that have not finished (20261022120121). */
  running_mtt_entries?: number;
  running_mtt_fee?: number;
  tournament_winnings?: number;
  cash_winnings?: number;
  fee: number;
  cash_fee?: number;
  mtt_fee?: number;
  on_felt?: number;
  live_games?: number;
}

export interface ClubDataRow {
  kind: 'CASH' | 'MTT' | 'SNG' | 'SPIN' | string;
  id: string;
  name: string;
  variant?: string | null;
  game_class?: string | null;
  blinds?: string | null;
  started_at?: string | null;
  /** Last money movement inside the window (ca_club_data_screen). */
  activity_at?: string | null;
  status?: string | null;
  creator_name?: string | null;
  fee?: number | null;
  winnings?: number | null;
  players?: number | null;
  live?: boolean;
  seated?: number | null;
  on_felt?: number | null;
}

interface Snapshot {
  range: { start: string; end: string; days: number };
  summary: ClubDataSummary;
  member_fees?: {
    cash_fees: number;
    tournament_fees: number;
    total_fees: number;
    /** 'UTC' (the viewer's own earned fees) or 'America/Chicago 02:00'. */
    day_basis: string;
    /** 'downline_accounting_fees' on the union basis (stage 2). */
    definition?: string;
    source?: string;
  } | null;
  rows: ClubDataRow[];
  generated_at?: string;
  /** 'club' for the owner, co-owner and admins; 'downline' for an agent. */
  scope: 'club' | 'downline';
  club_name?: string | null;
  reporting_scope?: 'club' | 'union';
  /** The club's union, when it is in one (or is one). Decides "today". */
  union_id?: string | null;
  accounting_basis?:
    | 'utc_net_money_flow'
    | 'chicago_net_money_flow'
    | 'pacific_net_money_flow'
    | 'union_invoice_accounting';
  day_basis?: string;
  /** fn_ca_club_acct_coverage (union basis only). */
  accounting_coverage?: ClubDataCoverage | null;
  /** First day the per-club facts cover. */
  facts_from?: string | null;
  /** The union's own answer only (20261115205153): each club's and the union account's figures. */
  clubs?: ClubDataClubRow[];
}

const GAME_FILTERS: Array<{ id: GameFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'HOLDEM', label: "Hold'em" },
  { id: 'OMAHA', label: 'Omaha' },
  { id: 'MIXED', label: 'Mixed' },
  { id: 'MTT', label: 'MTT' },
  { id: 'SNG', label: 'SNG' },
];
const STAKES_FILTERS: Array<{ id: Exclude<StakesFilter, 'ALL'>; label: string }> = [
  { id: 'MICRO', label: 'Micro' },
  { id: 'SMALL', label: 'Small' },
  { id: 'MID', label: 'Mid' },
  { id: 'HIGH', label: 'High' },
];
const ROW_LIMIT = 200;
const REQUEST_TIMEOUT_MS = 20_000;

export function refreshIntervalMs(preset: ClubDataPreset): number {
  return preset === 1 ? 15_000 : 60_000;
}

/**
 * Today on the Pacific Club Data clock. Explicit older responses can still
 * state a Chicago calendar basis during a compatible rollout.
 */
export function clubDataToday(now: Date = new Date(), basis: ClubDataDayBasis = 'pacific'): string {
  return clubDataDayOn(basis, now);
}

export function addDays(iso: string, days: number): string {
  return addCalendarDays(iso, days);
}

/**
 * Legacy exclusive-boundary links stop at the start of `until`, so their
 * last day is `until - 1`. The visible calendar uses inclusive dates instead.
 */
export function clubDataWindowError(start: string, until: string, today: string): string | null {
  if (!isCalendarDate(until)) return 'Choose A Start And End Date.';
  if (start && until <= start) return 'The End Must Be After The Start.';
  if (addDays(until, -1) > today) return 'The Window Can End No Later Than When Today Closes.';
  return clubDataRangeError(start, addDays(until, -1), today);
}

/**
 * Money exactly as the reader sent it, digit for digit with separators and at
 * least two decimals (decimal text prints with no float in between); a dash
 * when there is no figure. Never K/M (Dan 2026-11-13).
 */
export function formatMoney(n: FigureInput): string {
  return formatWalletChips(n);
}

/** A tile total: the same exact figure as everywhere else on the page. */
export function formatTotal(n: FigureInput): string {
  return formatMoney(n);
}

function inkFor(n: FigureInput): string {
  const d = figureDigits(n);
  if (!d || !/[1-9]/.test(d.whole + d.fraction)) return styles.inkNeutral;
  return d.negative ? styles.inkLoss : styles.inkWin;
}

function kindLabel(row: ClubDataRow): string {
  if (row.kind === 'CASH') {
    const v = String(row.variant || 'NLH').toUpperCase();
    const name = v.includes('PLO') ? v : v === 'NLH' || v === 'HOLDEM' ? 'NLH' : v;
    return row.blinds ? `${name} ${row.blinds}` : name;
  }
  if (row.kind === 'SPIN') return 'Spin';
  return row.kind;
}

function startedLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  return chicagoStamp(iso);
}

export function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const s = v.summary as Record<string, unknown> | undefined;
  return (
    (v.scope === 'club' || v.scope === 'downline') &&
    !!v.range &&
    !!s &&
    typeof s === 'object' &&
    ['games', 'total_winnings', 'mtt_winnings', 'fee'].every((k) =>
      Number.isFinite(Number(s[k]))
    ) &&
    Array.isArray(v.rows) &&
    (v.clubs === undefined || isClubRows(v.clubs))
  );
}

export default function ClubDataSimplePage({
  authorizedScope,
}: { authorizedScope?: 'club' | 'downline' } = {}) {
  usePageTitle('Club Data');
  const navigate = useNavigate();
  const params = useParams<{ clubId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isHydrating } = useAuthUser();
  const userId = user?.id ?? null;
  const clubParam = params.clubId || searchParams.get('club') || '';

  const [clubUuid, setClubUuid] = useState<string | null>(isUUID(clubParam) ? clubParam : null);
  // A fresh visit starts today, regardless of a previously saved preset.
  const preset = readClubDataPreset(searchParams);
  // Current reports share Pacific midnight; financial definitions remain distinct.
  const [dayBasis, setDayBasis] = useState<ClubDataDayBasis>('pacific');
  const dayBasisRef = useRef<ClubDataDayBasis>('pacific');
  dayBasisRef.current = dayBasis;
  const [currentDay, setCurrentDay] = useState(() => clubDataToday());
  const today = clubDataToday(new Date(), dayBasis);
  // Access hydration can unmount this page. Public date filters belong to the
  // route so refreshes and browser history retain the requested reporting window.
  // Inclusive dataEnd is the last selected day. Older dataUntil links remain exclusive.
  const requestedRange = readClubDataRange(searchParams, today);
  const endDate = requestedRange?.end ?? currentDay;
  const customStart = requestedRange?.start ?? null;
  const selectDates = (start: string | null, end: string, days = preset) => {
    const reportingToday = clubDataToday(new Date(), dayBasisRef.current);
    if (end === reportingToday) setCurrentDay(end);
    setSearchParams(writeClubDataRange(searchParams, start, end, reportingToday, days));
  };
  const reportRangeError = clubDataRequestedRangeError(searchParams, clubDataDayOn('pacific'));
  const [editingDates, setEditingDates] = useState(false);
  const [breakdown, setBreakdown] = useState<'total_winnings' | 'mtt_winnings' | 'fee' | null>(
    null
  );
  const { game, setGame, stakes, setStakes, searchInput, setSearchInput } =
    useClubDataFilters('club/ClubDataSimplePage');
  const [search, setSearch] = useState(() => searchInput.trim());
  const [playerResults, setPlayerResults] = useState<{
    key: string;
    items: RosterMember[];
    failed: boolean;
  } | null>(null);
  const [access, setAccess] = useState<{
    identity: string;
    scope: Snapshot['scope'] | 'denied';
  } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sourceRow, setSourceRow] = useState<{ key: string; row: ClubDataSourceRow } | null>(null);
  const [snapshotScope, setSnapshotScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const requestRef = useRef(0);
  // "CLUB JAQK - CLUB DATA": the name stays in the header while a window loads.
  const [clubName, setClubName] = useState<string | null>(null);

  const gameHost = useClubGameHost(clubUuid, !!userId && !isHydrating);
  const isToday = endDate >= today;
  const startDate = customStart ?? addDays(endDate, -(preset - 1));
  const rangeDays = clubDataRangeDays(startDate, endDate);
  const stakesApply = game === 'ALL' || game === 'HOLDEM' || game === 'OMAHA' || game === 'MIXED';
  const scopeKey = JSON.stringify([
    userId,
    clubParam,
    clubUuid,
    startDate,
    endDate,
    game,
    stakes,
    search,
    reportRangeError,
  ]);
  const identityKey = JSON.stringify([userId, clubParam, clubUuid]);
  // A new filter retires the figures, but the last server authorization still
  // applies to this viewer and club until a later response supersedes it.
  const currentScope = access?.identity === identityKey ? access.scope : undefined;
  const denied = currentScope === 'denied';
  const playerSearchReady = !isHydrating && !!userId && !!currentScope && !denied;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const visibleSnapshot =
    !isHydrating && userId && !reportRangeError && snapshotScope === scopeKey ? snapshot : null;

  // Retire private figures and pending completions before another account or
  // club can paint. A request number alone does not cover an account switch
  // while the new session is still hydrating, or a response after unmount.
  useLayoutEffect(() => {
    ++requestRef.current;
    setBreakdown(null);
    setSnapshot(null);
    setSnapshotScope(null);
    setError(null);
    setUpdatedAt(null);
    setLoading(true);
    return () => {
      ++requestRef.current;
    };
  }, [scopeKey]);

  useEffect(() => {
    if (isUUID(clubParam)) {
      setClubUuid(clubParam);
      return;
    }
    if (!clubParam) return;
    let dead = false;
    // A resolver is not a guard: an unknown slug comes back as itself.
    void resolveClubUUID(clubParam)
      .then((id) => {
        if (dead) return;
        if (id && isUUID(id)) {
          setClubUuid(id);
        } else {
          setLoading(false);
          setError('This Club Could Not Be Found.');
        }
      })
      .catch((err) => {
        if (dead) return;
        reportError(err, 'ClubDataSimplePage.resolve_club');
        setLoading(false);
        setError('This Club Could Not Be Found.');
      });
    return () => {
      dead = true;
    };
  }, [clubParam]);

  // The header names the club before the figures arrive, and on the refusal too.
  useEffect(() => {
    if (!clubUuid) return;
    let dead = false;
    let read: PromiseLike<{ data: unknown }>;
    try {
      read = supabase.from('clubs').select('name').eq('id', clubUuid).maybeSingle();
    } catch {
      return undefined; // the screen read carries the name too
    }
    void Promise.resolve(read)
      .then(({ data }) => {
        const name = (data as { name?: string | null } | null)?.name;
        if (!dead && name) setClubName((prev) => prev ?? name);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [clubUuid]);

  // A new filter or window starts a fresh picture: the old one described
  // something else and must not sit under the new heading.
  useEffect(() => {
    setSnapshot(null);
    setLoading(true);
  }, [clubUuid, preset, endDate, game, stakes, search]);

  const load = useCallback(async () => {
    if (reportRangeError) {
      setLoading(false);
      return;
    }
    if (!clubUuid || isHydrating || !userId || reportRangeError) return;
    const mine = ++requestRef.current;
    const requestScope = scopeKey;
    const isCurrent = () => mine === requestRef.current && activeScopeRef.current === requestScope;
    let timer = 0;
    try {
      const read = supabase.rpc('ca_club_data_screen', {
        p_club_id: clubUuid,
        p_start: startDate,
        p_end: endDate,
        p_game: game,
        p_stakes: stakesApply ? stakes : 'ALL',
        p_search: search || null,
        p_limit: ROW_LIMIT,
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('club_data_timeout')), REQUEST_TIMEOUT_MS);
      });
      const { data, error: rpcError } = await Promise.race([Promise.resolve(read), timeout]);
      if (!isCurrent()) return;
      if (rpcError) {
        if (isClubDataPacificIncomplete(rpcError)) {
          reportError(rpcError, 'ClubDataSimplePage.pacific_coverage');
          setSnapshot(null);
          setSnapshotScope(null);
          setError(CLUB_DATA_PACIFIC_INCOMPLETE_COPY);
        } else if (isAuthzError(rpcError)) {
          setSnapshot(null);
          setSnapshotScope(null);
          setAccess({ identity: identityKey, scope: 'denied' });
          setError(null);
        } else {
          reportError(rpcError, 'ClubDataSimplePage.snapshot');
          setError('Club Data Could Not Be Read.');
        }
        return;
      }
      if (!isSnapshot(data)) {
        setError('Club Data Came Back Incomplete.');
        return;
      }
      setSnapshot(data);
      // Both verified Data bases use the same Pacific calendar day.
      if (isUnionClubAnswer(data)) setDayBasis('accounting');
      else if (clubDataDayBasis(data) === 'pacific') setDayBasis('pacific');
      setAccess({ identity: identityKey, scope: data.scope });
      setSnapshotScope(requestScope);
      if (data.club_name) setClubName(data.club_name);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      if (!isCurrent()) return;
      reportError(err, 'ClubDataSimplePage.snapshot');
      setError('Club Data Could Not Be Read.');
    } finally {
      window.clearTimeout(timer);
      if (isCurrent()) setLoading(false);
    }
  }, [
    clubUuid,
    isHydrating,
    userId,
    startDate,
    endDate,
    game,
    stakes,
    stakesApply,
    search,
    scopeKey,
    identityKey,
    reportRangeError,
  ]);

  // Server roster permissions remain authoritative. Bind results to the exact
  // viewer, club and query, and retire them before a changed identity paints.
  useEffect(() => {
    if (!clubUuid || !playerSearchReady || !search) return;
    const controller = new AbortController();
    let dead = false;
    const key = scopeKey;
    void ClubRosterService.getDataPlayerMatches(clubUuid, {
      search,
      signal: controller.signal,
    })
      .then((page) => {
        if (!dead && activeScopeRef.current === key) {
          setPlayerResults({
            key,
            items: page.items.filter((p) => p.can_view_financials),
            failed: false,
          });
        }
      })
      .catch((err) => {
        if (!dead && activeScopeRef.current === key) {
          reportError(err, 'ClubDataSimplePage.player_search');
          setPlayerResults({ key, items: [], failed: true });
        }
      });
    return () => {
      dead = true;
      controller.abort();
    };
  }, [clubUuid, playerSearchReady, search, scopeKey]);

  // Read now, then keep reading while the screen is in view.
  useEffect(() => {
    void load();
    const every = refreshIntervalMs(isToday ? preset : 14);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, every);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, preset, isToday]);

  // Every new club or account begins on the current Pacific day.
  useEffect(() => {
    setDayBasis('pacific');
  }, [identityKey]);

  // A club whose answer says it counts the 02:00 accounting day moves "today"
  // to that day at once (they differ between midnight and 02:00 Chicago).
  useEffect(() => {
    setCurrentDay(clubDataToday(new Date(), dayBasis));
  }, [dayBasis]);

  // Explicit URL dates stay fixed; only an unpinned today view follows midnight.
  useClubDataDayRollover(dayBasis, setCurrentDay);

  // Search waits for the typing to stop.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const shift = (dir: -1 | 1) => {
    const next = addDays(endDate, dir * rangeDays);
    const end = next > today ? today : next;
    selectDates(customStart !== null ? addDays(end, -(rangeDays - 1)) : null, end);
  };

  const summary = visibleSnapshot?.summary ?? null;
  const isDownline = visibleSnapshot?.scope === 'downline';
  // Every label states the basis the visible answer was given on.
  const answerBasis: ClubDataDayBasis = visibleSnapshot
    ? clubDataDayBasis(visibleSnapshot)
    : dayBasis;
  const unionBasis = answerBasis === 'accounting';
  // Stage 2: on the union basis member_fees is the downline's fees from the
  // accounting records on the same 02:00 days (equal to the screen's fee),
  // not the viewer's own earned share on UTC days.
  const downlineAccountingFees =
    unionBasis &&
    (visibleSnapshot?.member_fees?.definition === 'downline_accounting_fees' ||
      visibleSnapshot?.member_fees?.day_basis === ACCOUNTING_DAY_BASIS ||
      visibleSnapshot?.member_fees?.day_basis === 'America/Chicago 02:00');
  const notices = coverageNotices(visibleSnapshot?.accounting_coverage);
  const completeWindowLabel =
    (visibleSnapshot && coverageWindowLabel(visibleSnapshot.accounting_coverage)) ||
    clubDataWindowLabel(startDate, endDate, answerBasis);
  const windowLabel = isToday
    ? completeWindowLabel.replace(/ To .*$/, ' To Now')
    : completeWindowLabel;
  const startClock = clubDataBoundaryClock(answerBasis, startDate);
  const boundaryClock = clubDataBoundaryClock(answerBasis, addDays(endDate, 1));
  const feeText = isDownline
    ? formatMoney(visibleSnapshot?.member_fees?.total_fees)
    : summary
      ? formatMoney(summary.fee)
      : '-';
  const feeRef = useFitText<HTMLElement>(feeText, 1, 0.3);
  const factsFrom = visibleSnapshot?.facts_from ?? null;
  const rows = useMemo(() => visibleSnapshot?.rows ?? [], [visibleSnapshot]);
  const liveCount = summary?.live_games ?? rows.filter((r) => r.live).length;
  // A route segment, never a `??` inside the template: the reachability law
  // reads everything after a `?` as a query string.
  const clubKey = clubUuid || clubParam;
  const canOpenReport =
    authorizedScope !== 'downline' &&
    !isHydrating &&
    !!userId &&
    (currentScope ?? authorizedScope) === 'club';
  const reportOpen = canOpenReport && searchParams.get('report') === 'open';
  const openReport = (games = false) => {
    const query = clubDataContextQuery(searchParams, {
      start: startDate,
      end: endDate,
      game,
      stakes,
      search: searchInput,
    });
    if (customStart === null) {
      if (preset !== 1) query.set('dataDays', String(preset));
      query.delete('dataStart');
      if (!requestedRange) query.delete('dataEnd');
    }
    if (games) query.set('dataTab', 'games');
    navigate(
      clubDataReportPath(clubParam || clubKey, query, games ? '#club-data-panel-games' : '')
    );
  };
  const closeReport = () => {
    const query = new URLSearchParams(searchParams);
    query.delete('report');
    query.delete('view');
    query.delete('dataTab');
    setSearchParams(query);
  };

  const readMessage =
    reportRangeError ??
    (error && visibleSnapshot ? `${error} Showing The Last Good Figures.` : error);
  const updatedLabel = updatedAt ? chicagoClock(updatedAt) : null;

  if (denied) {
    return (
      <div className={`${styles.page} arena-workspace`}>
        <Header clubName={clubName} />
        <div className={styles.empty}>
          <SpadeMark />
          <p className={styles.emptyText}>
            Club Data Is Open To The Club Owner, Admins And Agents.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.page} arena-workspace`}>
      {sourceRow?.key === scopeKey && clubUuid && (
        <ClubDataSourceDetails
          row={sourceRow.row}
          clubId={clubUuid}
          start={startDate}
          end={endDate}
          onClose={() => setSourceRow(null)}
        />
      )}
      <Header
        clubName={clubName}
        /* The full report is the whole club's; an agent's view is his own. */
        onReport={canOpenReport ? () => (reportOpen ? closeReport() : openReport()) : undefined}
        reportOpen={reportOpen}
      />

      {reportOpen && (
        <section aria-label="Club Report" id="club-data-report">
          <Suspense fallback={<p role="status">Loading Club Report</p>}>
            <ClubReport inline />
          </Suspense>
        </section>
      )}
      {visibleSnapshot?.reporting_scope === 'union' && (
        <div className={styles.agentScopeBanner}>All Member Clubs And Union Account</div>
      )}
      {isDownline && <div className={styles.agentScopeBanner}>You And Your Downline</div>}

      <section className="arena-case">
        <h2 className="arena-section-title">
          Reporting Window <small>{CLUB_DATA_ZONE_LABEL}</small>
        </h2>
        <div className={styles.rangeBar}>
          <button
            type="button"
            className={styles.arrow}
            onClick={() => shift(-1)}
            aria-label="Previous Period"
            disabled={addDays(startDate, -rangeDays) < clubDataOldestDay(today)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 3 L5 12 L16 21 Z" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.rangeChip}
            aria-label="Select Date Range"
            aria-expanded={editingDates}
            aria-controls="club-data-date-range"
            onClick={() => {
              setEditingDates((open) => !open);
            }}
          >
            <span>{windowLabel}</span>
            <span className={styles.rangeTz}>{CLUB_DATA_ZONE_LABEL}</span>
          </button>
          <button
            type="button"
            className={styles.arrow}
            onClick={() => shift(1)}
            disabled={isToday}
            aria-label="Next Period"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 3 L19 12 L8 21 Z" />
            </svg>
          </button>
        </div>

        {reportRangeError && (
          <p role="alert" className={styles.liveLine}>
            {reportRangeError}
          </p>
        )}
        <ClubDataReportGuide
          start={startDate}
          end={endDate}
          basis={answerBasis}
          union={unionBasis}
        />

        {editingDates && (
          <ClubDataRangeCalendar
            start={startDate}
            end={endDate}
            today={today}
            zoneLabel={
              answerBasis === 'accounting'
                ? 'Pacific Accounting Dates'
                : answerBasis === 'pacific'
                  ? 'Pacific Calendar Dates'
                  : 'Chicago Calendar Dates'
            }
            onClose={() => setEditingDates(false)}
            onApply={(first, last) => {
              selectDates(first, last);
              setEditingDates(false);
            }}
          />
        )}
        <div className={`${styles.segment} arena-switch`} role="group" aria-label="Date Range">
          {CLUB_DATA_PRESETS.filter((days) => days <= 14 || days === preset).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={customStart === null && preset === p}
              className={`${styles.segmentButton} ${customStart === null && preset === p ? styles.segmentActive : ''}`}
              onClick={() => {
                selectDates(null, clubDataToday(new Date(), dayBasisRef.current), p);
                setEditingDates(false);
              }}
            >
              {p === 1 ? '1 Day' : `${p} Days`}
            </button>
          ))}
        </div>
      </section>
      <section className="arena-case">
        <h2 className="arena-section-title">Club Totals</h2>
        <dl className={styles.stats} aria-busy={loading} aria-label="Club Totals">
          <div className={`${styles.stat} arena-meter`}>
            <dt className={styles.statLabel}>Games</dt>
            <dd className={styles.statValue}>
              {summary ? Number(summary.games).toLocaleString('en-US') : '-'}
            </dd>
          </div>
          <div className={`${styles.stat} arena-meter`}>
            <dt className={styles.statLabel}>
              <button
                type="button"
                className={styles.statAction}
                disabled={!summary}
                onClick={() => setBreakdown('total_winnings')}
                aria-label="View Total Winnings By Player"
              >
                Total Winnings
              </button>
            </dt>
            <dd
              className={`${styles.statValue} ${summary ? inkFor(summary.total_winnings) : ''}`}
              title={summary ? formatMoney(summary.total_winnings) : undefined}
              aria-label={summary ? formatMoney(summary.total_winnings) : undefined}
            >
              {summary ? formatTotal(summary.total_winnings) : '-'}
            </dd>
          </div>
          <div className={`${styles.stat} arena-meter`}>
            <dt className={styles.statLabel}>
              <button
                type="button"
                className={styles.statAction}
                disabled={!summary}
                onClick={() => setBreakdown('mtt_winnings')}
                aria-label="View MTT Winnings By Player"
              >
                MTT Winnings
              </button>
            </dt>
            <dd
              className={`${styles.statValue} ${summary ? inkFor(summary.mtt_winnings) : ''}`}
              title={summary ? formatMoney(summary.mtt_winnings) : undefined}
              aria-label={summary ? formatMoney(summary.mtt_winnings) : undefined}
            >
              {summary ? formatTotal(summary.mtt_winnings) : '-'}
            </dd>
          </div>
          <div className={`${styles.stat} arena-meter`}>
            <dt className={styles.statLabel}>
              {isDownline ? (
                downlineAccountingFees ? (
                  'Downline Fees'
                ) : (
                  'My Fees Earned'
                )
              ) : (
                <button
                  type="button"
                  className={styles.statAction}
                  disabled={!summary}
                  onClick={() => setBreakdown('fee')}
                  aria-label="View Fees By Player"
                >
                  Fee
                </button>
              )}
            </dt>
            <dd
              className={styles.statValue}
              ref={feeRef}
              title={isDownline || summary ? feeText : undefined}
              aria-label={isDownline || summary ? feeText : undefined}
            >
              {feeText}
            </dd>
          </div>
        </dl>
        {visibleSnapshot && !isDownline && (
          <ClubDataReconciliation
            basis={visibleSnapshot.accounting_basis}
            coverage={visibleSnapshot.accounting_coverage}
            range={visibleSnapshot.range}
            reconciliation={summary?.reconciliation}
            generatedAt={visibleSnapshot?.generated_at}
            onPlayers={() => setBreakdown('total_winnings')}
            onGames={() => openReport(true)}
          />
        )}
        {visibleSnapshot?.reporting_scope === 'union' && visibleSnapshot.clubs && (
          <ClubDataByClub
            clubs={visibleSnapshot.clubs}
            end={endDate}
            start={startDate}
            filters={{ game, stakes, search: searchInput }}
          />
        )}
        {breakdown && visibleSnapshot && clubUuid && userId && (
          <ClubDataTotalsBreakdown
            key={scopeKey}
            clubId={clubUuid}
            start={startDate}
            end={endDate}
            basis={answerBasis}
            game={game}
            stakes={stakesApply ? stakes : 'ALL'}
            search={search || null}
            metric={breakdown}
            onClose={() => setBreakdown(null)}
          />
        )}
        {summary &&
          summary.running_mtt_entries !== undefined &&
          summary.running_mtt_entries !== null && (
            <dl className={styles.runningLine} aria-label="Unfinished MTT Entries">
              <dt>Unfinished MTT Entries</dt>
              <dd
                className={inkFor(summary.running_mtt_entries)}
                title={formatMoney(summary.running_mtt_entries)}
              >
                {formatMoney(summary.running_mtt_entries)}
              </dd>
            </dl>
          )}
        {unionBasis && summary && typeof summary.on_felt === 'number' && (
          <dl className={styles.runningLine} aria-label="Chips On The Felt">
            <dt>On The Felt Now</dt>
            <dd title={formatMoney(summary.on_felt)}>{formatMoney(summary.on_felt)}</dd>
          </dl>
        )}
      </section>
      <div className={styles.liveRow}>
        <div className={styles.liveLine} role="status">
          {readMessage ? (
            <span className={styles.inkLoss}>{readMessage}</span>
          ) : loading && !snapshot ? (
            <span>Reading Live Data</span>
          ) : (
            <>
              <span className={styles.liveDot} aria-hidden="true" />
              <span>
                Live{updatedLabel ? ` - Updated ${updatedLabel} ${CLUB_DATA_ZONE_LABEL}` : ''}
                {liveCount > 0 ? ` - ${liveCount} Game${liveCount === 1 ? '' : 's'} In Play` : ''}
              </span>
            </>
          )}
        </div>
        <DataHelpTip alert={Boolean(notices.incomplete)}>
          <p>
            {clubDataDayRule(answerBasis)}. The Window Starts At {startClock} On The Start Date And
            Stops At {boundaryClock} After The Last Selected Day. Both Selected Dates Are Included.
            Within The Past 90 Days.
          </p>
          {visibleSnapshot && unionBasis && <p>{UNION_BASIS_DEFINITIONS}</p>}
          {unionBasis && (
            <p>
              Unfinished MTT Entries Are Buy-Ins For MTTs Not Yet Finished, Included In Total
              Winnings. On The Felt Now Is Not In Total Winnings.
            </p>
          )}
          {visibleSnapshot?.scope === 'downline' &&
            (downlineAccountingFees ? (
              <p>
                Downline Fees Are The Rake Credited For You And Your Downline On The Union Invoice
                Basis, Before Agent Shares, Across All Games For This Window.
              </p>
            ) : visibleSnapshot?.member_fees?.definition === 'pacific_earned_fees' ? (
              <p>
                Your Fees After Shares And Adjustments, Across All Games In This Pacific Window.
                Game Rows Show Downline Fees Generated.
              </p>
            ) : (
              <p>
                Your Fees After Shares And Adjustments, Across All Games For These UTC Dates. Game
                Rows Show Downline Fees Generated.
              </p>
            ))}
          {notices.provisional && <p role="status">{notices.provisional}</p>}
          {notices.incomplete && (
            <p className={styles.inkLoss} role="alert">
              {notices.incomplete}
            </p>
          )}
          {visibleSnapshot?.accounting_basis === 'pacific_net_money_flow' && (
            <p>
              Net Entries And Payouts In Pacific Time. MTT Winnings Count Finished MTTs Only.
              Unfinished MTT Entries Are Buy-Ins For MTTs Still Running Or Not Yet Started.
            </p>
          )}
          {visibleSnapshot?.accounting_basis === 'chicago_net_money_flow' && (
            <p>
              Net Entries And Payouts In Chicago Time. MTT Winnings Count Finished MTTs Only.
              Unfinished MTT Entries Are Buy-Ins For MTTs Still Running Or Not Yet Started.
            </p>
          )}
          {visibleSnapshot?.accounting_basis === 'utc_net_money_flow' && (
            <p>Net Entries And Payouts In UTC. Unfinished Event Entries Included.</p>
          )}
          {factsFrom && startDate < factsFrom && <p>Figures Begin {factsFrom}</p>}
        </DataHelpTip>
      </div>

      <section className="arena-case">
        <h2 className="arena-section-title">Game Reports</h2>
        <label className={styles.search}>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search Player, Game, Creator Or ID"
            aria-label="Search Players And Games"
          />
          <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.searchIcon}>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5 L21 21" />
          </svg>
        </label>

        {playerSearchReady &&
          search &&
          searchInput.trim() === search &&
          playerResults?.key === scopeKey && (
            <section aria-label="Matching Players">
              {playerResults.failed ? (
                <p role="status" className={styles.liveLine}>
                  Player Search Could Not Be Read.
                </p>
              ) : (
                <ul className={styles.list}>
                  {playerResults.items.map((player) => (
                    <li key={player.user_id}>
                      <button
                        type="button"
                        className={`${styles.row} ${styles.playerResult}`}
                        onClick={() =>
                          navigate(
                            `/clubs/${player.management_club_id || clubUuid}/members/${player.user_id}?${clubDataContextQuery(new URLSearchParams({ ...Object.fromEntries(searchParams), dataClub: clubKey }), { start: startDate, end: endDate, game, stakes, search: searchInput })}`
                          )
                        }
                      >
                        <span className={styles.rowName}>
                          {titleCase(playerDisplayName(player))}
                        </span>
                        <span className={styles.rowFee}>View Player Data</span>
                      </button>
                    </li>
                  ))}
                  {playerResults.items.length === 0 && (
                    <li className={styles.more}>No Matching Players In Your Data Scope.</li>
                  )}
                </ul>
              )}
            </section>
          )}

        <div className={styles.tabs} role="group" aria-label="Game Type">
          {GAME_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={game === f.id}
              className={`${styles.tab} ${game === f.id ? styles.tabActive : ''}`}
              onClick={() => setGame(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {stakesApply && (
          <div className={styles.stakes} role="group" aria-label="Stakes">
            {STAKES_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={stakes === f.id}
                className={`${styles.stake} ${stakes === f.id ? styles.stakeActive : ''}`}
                onClick={() => setStakes((prev) => (prev === f.id ? 'ALL' : f.id))}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {snapshot && rows.length === 0 ? (
          <div className={styles.empty}>
            <SpadeMark />
            <p className={styles.emptyText}>No Data In This Period.</p>
          </div>
        ) : !snapshot && !loading ? (
          <div className={styles.empty}>
            <SpadeMark />
            <p className={styles.emptyText}>{readMessage ?? 'Club Data Is Unavailable.'}</p>
            {!reportRangeError && (
              <button type="button" className={styles.retry} onClick={() => void load()}>
                Try Again
              </button>
            )}
          </div>
        ) : (
          <ul className={styles.list} aria-label="Games">
            {rows.map((row) => (
              <li key={`${row.kind}-${row.id}`} className={`${styles.row} arena-ledger-row`}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>
                    <button
                      type="button"
                      className={styles.sourceName}
                      onClick={() => setSourceRow({ key: scopeKey, row })}
                    >
                      {row.name}
                    </button>
                    {row.live && <span className={styles.badgeLive}>Live</span>}
                  </div>
                  <div className={styles.rowMeta}>
                    <span className={styles.kind}>{kindLabel(row)}</span>
                    {(row.kind === 'CASH' ? row.activity_at : row.started_at) && (
                      <span>
                        {startedLabel(row.kind === 'CASH' ? row.activity_at : row.started_at)}
                      </span>
                    )}
                    {Number(row.players) > 0 && (
                      <span>
                        {Number(row.players).toLocaleString('en-US')} Player
                        {Number(row.players) === 1 ? '' : 's'}
                      </span>
                    )}
                    {(gameHost || clubName) && <span>By {gameHost || clubName}</span>}
                  </div>
                </div>
                <div className={styles.rowFigures}>
                  <span className={`${styles.rowWin} ${inkFor(row.winnings)}`}>
                    {formatMoney(row.winnings)}
                  </span>
                  <span className={styles.rowFee}>Fee {formatMoney(row.fee)}</span>
                </div>
              </li>
            ))}
            {rows.length >= ROW_LIMIT && summary && Number(summary.games) > rows.length && (
              <li className={styles.more}>
                Showing The {rows.length.toLocaleString('en-US')} Most Recent Of{' '}
                {Number(summary.games).toLocaleString('en-US')} Games. Totals Above Cover Them All.
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

/** "CLUB JAQK - CLUB DATA" (Dan 2026-10-17); the club's name is the part that gives way on a narrow phone. */
export function headerTitle(clubName: string | null | undefined): string {
  const name = (clubName || '').trim();
  return name ? `${name.toUpperCase()} - CLUB DATA` : 'Club Data';
}

function Header({
  onReport,
  clubName,
  reportOpen = false,
}: {
  onReport?: () => void;
  clubName?: string | null;
  reportOpen?: boolean;
}) {
  return (
    <>
      <ArenaWorkspaceHeader
        area="data"
        title="Club Data"
        context={clubName}
        subtitle="Club Reporting"
      />
      {onReport && (
        <nav className="arena-switch" aria-label="Club Reports">
          <button
            type="button"
            aria-expanded={reportOpen}
            aria-controls="club-data-report"
            onClick={onReport}
          >
            {reportOpen ? 'Close Club Report' : 'Open Club Report'}
          </button>
        </nav>
      )}
    </>
  );
}

function SpadeMark() {
  return (
    <svg viewBox="0 0 64 64" className={styles.spade} aria-hidden="true">
      <path d="M32 6 C24 18 10 26 10 38 C10 46 16 51 23 51 C27 51 30 49 31 47 C30 52 28 55 24 58 L40 58 C36 55 34 52 33 47 C34 49 37 51 41 51 C48 51 54 46 54 38 C54 26 40 18 32 6 Z" />
    </svg>
  );
}
