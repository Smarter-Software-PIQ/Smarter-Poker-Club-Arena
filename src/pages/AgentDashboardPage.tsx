import { usePlayerPreference } from '../hooks/usePlayerPreference';
import { PROMO_PLAY_THROUGH_SENDER_TERMS } from '../components/legal/promoPlayThroughTerms';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AGENT DASHBOARD PAGE - Agent Operations Center
 * Ported from World Hub agent-dashboard.js → Club Arena TypeScript
 *
 * Tabs (8): Overview, Players, Cashouts, Commissions, Score, Analytics, Promo, Credit
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { isClubStaff } from '../types/clubRoles';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { readPresence } from '../lib/ownProfile';
import { masterBus } from '../core/MasterBus';
import { useAuthUser } from '../hooks/useAuthUser';
import { resolveClubUUID } from '../utils/clubIdResolver';
import { uuid } from '../utils/uuid';
import type { ChipTransaction } from '../types/database.types';
import {
  outcomeNeedsReceiptCheck,
  CashoutReceiptChecks,
  useCashoutReceiptChecks,
} from '../components/wallet/CashoutReceiptChecks';
import { useCashoutScope, useCashoutScopeKey } from '../hooks/useCashoutScope';
import {
  runCashoutOperation,
  recoverCashoutOperation,
  captureCashoutStart,
  assertCashoutStartCurrent,
  type CashoutStart,
} from '../services/CashoutOperation';
import {
  usePreparedCashoutOperations,
  isCashoutStartCurrent,
} from '../hooks/usePreparedCashoutOperations';
import { confirmDialog } from '../components/common/confirmDialog';
import { WalletService } from '../services/WalletService';
import { CreditService } from '../services/CreditService';
import {
  prepareCreditReduction,
  captureCreditReduction,
  assertCreditReductionCurrent,
  listPendingCreditReductions,
  capturePendingCreditReduction,
  recoverCreditReduction,
  retireCreditReduction,
  type PreparedCreditReduction,
  type PendingCreditReduction,
} from '../services/CreditReductionOperation';
import {
  creditReductionAmount,
  type CreditReductionEnvelope,
} from '../lib/CreditReductionContract';
import {
  assertChipAmount,
  runAgentWalletOperation,
  confirmedAgentWalletReceipt,
} from '../services/AgentWalletIntent';
import { exportToCSV } from '../lib/export';
import TransactionLedgerView from '../components/common/TransactionLedgerView';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import { ArenaReadings, ArenaRow, ArenaState } from '../components/ops/ArenaOps';
import './AgentDashboardPage.css';
import AgentScoreCard from '../components/agent/AgentScoreCard';

import { useIsMounted } from '../hooks/useIsMounted';
import { useToast } from '../components/common/Toast';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';
import { retryFetch } from '../utils/retryFetch';
import { fmt, fmtChips, formatWalletChips, timeAgo } from '../utils/format';
import { reportError } from '../utils/errorReporter';
import AgentBackOffice from '../components/agent/AgentBackOffice';

import { safeErrorMessage } from '../utils/safeErrorMessage';
import { playerDisplayName, PLAYER_NAME_COLUMNS } from '../utils/playerDisplayName';
import { resolvePageClubId, pickPreferredClubId } from '../utils/resolvePageClubId';
import { SEND_DESTINATION_LABELS } from '../utils/cashierSendWallets';
import type { ClubBankRecipientWallet } from '../components/wallet/cashierModes';
import { sumChips } from '../utils/cashierAmount';
type AgentTab =
  | 'overview'
  | 'players'
  | 'cashouts'
  | 'commissions'
  | 'score'
  | 'analytics'
  | 'promo'
  | 'credit'
  | 'statement';

// ── Agent Dashboard Types ──────────────────────────────────────
interface AgentProfile {
  id: string;
  display_name?: string;
  username?: string;
  avatar_url?: string;
  /** Online now, from the presence door - never the heartbeat (ruling 25). */
  online?: boolean;
  /** The last hand this player played in THIS club: player_stats.updated_at,
      the club's own public statistics. A player's platform-wide last-seen
      time is theirs and platform staff's alone (ruling 25,
      docs/DIAMOND-RULINGS.md), so the agent's activity panel reads play here. */
  last_played?: string;
}
interface DownlineMember {
  user_id: string;
  role: string;
  chip_balance: number;
  status: string;
  created_at: string;
  /** club_members.agent_id - the assignment every write path in this app uses. */
  agent_id?: string;
  /** club_members.invited_by - the older referral column, kept as a fallback. */
  referred_by?: string;
  profile?: AgentProfile;
}
interface CashoutRequest {
  id: string;
  player_id: string;
  club_id: string;
  amount: number;
  status: string;
  player_note?: string;
  created_at: string;
  updated_at?: string;
}
interface AgentCommission {
  id: string;
  user_id: string;
  club_id: string;
  amount: number;
  source_type: string;
  source_id?: string;
  notes?: string;
  created_at: string;
  // Whether this row has been claimed. Phase 6 made commission claimable and
  // phase 7 made every other surface say so; this list showed a claimed row and
  // an owed one identically, which is the same figure meaning two things.
  settled_at?: string | null;
  /** 'claim' | 'round2' | null - which mechanism paid it (v_agent_commissions). */
  settled_via?: string | null;
}
// ChipTransaction imported from types/database.types (canonical definition)

/** The club's name as the link spells it; a raw UUID names nothing. */
function clubContext(clubId?: string): string | undefined {
  if (!clubId || /^[0-9a-f]{8}-/i.test(clubId)) return undefined;
  return clubId.replace(/[-_]/g, ' ');
}

export default function AgentDashboardPage() {
  const { user } = useAuthUser();
  const [params] = useSearchParams();
  const key = useCashoutScopeKey(user?.id, params.toString());
  const [scopeGeneration, setScopeGeneration] = useState(0);
  useEffect(
    () =>
      masterBus.subscribe('GAME_MANAGEMENT_ACCESS_CHANGED', ({ payload }) => {
        if (!user?.id || (payload.userId && payload.userId !== user.id)) return;
        try {
          for (let index = sessionStorage.length - 1; index >= 0; index--) {
            const cacheKey = sessionStorage.key(index);
            if (cacheKey?.startsWith(`agent_dashboard_swr_${user.id}_`))
              sessionStorage.removeItem(cacheKey);
          }
        } catch {
          /* Optional read cache; the new generation still rechecks the server. */
        }
        setScopeGeneration((value) => value + 1);
      }),
    [user?.id]
  );
  return <AgentDashboardContent key={`${key}:${scopeGeneration}`} />;
}

function AgentDashboardContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthUser();
  const isCurrent = useCashoutScope(user?.id, searchParams.toString());
  const cashoutRowsCurrent = useRef<(() => boolean) | null>(null);
  const cashoutRowsScope = useRef<(() => boolean) | null>(null);
  const cashoutInFlight = useRef(false);
  const cashoutReadGeneration = useRef(0);

  const [tab, setTab] = useState<AgentTab>('overview');
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clubId, setClubId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [role, setRole] = useState('agent');

  // Overview data
  const [players, setPlayers] = useState<DownlineMember[]>([]);
  const [cashoutsLoaded, setCashoutsAvailable] = useState(false);
  const cashoutsAvailable = cashoutsLoaded && cashoutRowsScope.current?.() === true;
  const [pendingCashouts, setPendingCashouts] = useState<CashoutRequest[]>([]);
  const [commissions, setCommissions] = useState<AgentCommission[]>([]);
  const [recentTx, setRecentTx] = useState<ChipTransaction[]>([]);

  // Search / Filter
  const [playerSearch, setPlayerSearch] = usePlayerPreference(
    'AgentDashboardPage:playerSearch',
    ''
  );
  /* Both lists page from the SERVER. They used to fetch 100 transactions
     and 50 commissions once and page the 100 in the browser, so "Load More"
     could never reach row 101 and the commission list simply stopped at 50
     with no notice. */
  const TX_PAGE = 100;
  const COMMISSION_PAGE = 50;
  const [txHasMore, setTxHasMore] = useState(false);
  const [txLoadingMore, setTxLoadingMore] = useState(false);
  const [commissionsHasMore, setCommissionsHasMore] = useState(false);
  const [commissionsLoadingMore, setCommissionsLoadingMore] = useState(false);

  // Transfer modal
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const walletOperationInFlightRef = useRef(false);
  // THE SENDER CHOOSES THE RECIPIENT'S WALLET (Dan 2026-10-15: "SELECTABLE TO
  // SEND TO ANY WALLET I WANT THAT THE USER HAS (PLAYER WALLET, AGENT WALLET,
  // PROMO WALLET ETC)"). This form used to send every transfer into the Agent
  // Wallet with no choice. Agent Wallet stays the default; the server refuses a
  // wallet the recipient does not hold.
  const [transferDestination, setTransferDestination] =
    useState<ClubBankRecipientWallet>('agent_wallet');

  // Credit management (owner-only)
  const [creditTarget, setCreditTarget] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNotes, setCreditNotes] = useState('');
  const creditInputEpoch = useRef(0);
  const [creditInputRevision, setCreditInputRevision] = useState(0);
  const invalidateCreditInput = () => {
    creditInputEpoch.current += 1;
    setCreditInputRevision(creditInputEpoch.current);
  };

  // Agents list (for promo/credit selectors)
  const [agents, setAgents] = useState<DownlineMember[]>([]);

  const mountedRef = useIsMounted();
  const toast = useToast();
  const SWR_TTL_MS = 5 * 60 * 1000; // 5-minute cache TTL
  const resolvedClubIdRef = useRef<string | null>(null);
  // Promo grant payment identity (launch audit 2026-10-09, S-04): minted once
  // per attempt, retained across a failure so a retry replays the same
  // fn_promo_disburse operation, cleared after success and whenever the
  // amount or target changes (a different grant is a different payment).
  const promoOpIdRef = useRef<string | null>(null);

  // Auto-clear success
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // Auto-clear errors after 6s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  // Reset UUID cache when club changes
  useEffect(() => {
    resolvedClubIdRef.current = null;
  }, [clubId]);

  const dashLoadingRef = useRef(false);
  const dashReloadRef = useRef<string | null | undefined>(undefined);

  // ── Load Dashboard Data ───────────────────────────────────
  const loadDashboard = useCallback(
    async (cId: string | null) => {
      if (!isCurrent()) return;
      // Cashout events can arrive before the verified service receipt returns.
      // Keep that accepted row valid until acknowledgment, then refresh once.
      if (cashoutInFlight.current || dashLoadingRef.current) {
        dashReloadRef.current = cId;
        return;
      }
      dashLoadingRef.current = true;
      const cashoutGeneration = ++cashoutReadGeneration.current;
      const cashoutReadCurrent = () =>
        isCurrent() && cashoutReadGeneration.current === cashoutGeneration;
      cashoutRowsCurrent.current = null;
      setCashoutsAvailable(false);
      try {
        setLoading(true);
        setError(null);
        const targetClubId = cId || clubId;
        if (!targetClubId || !user?.id) {
          setError('No club selected.');
          setLoading(false);
          return;
        }

        // Use cached UUID when available to avoid redundant async lookups
        const uuid = resolvedClubIdRef.current || (await resolveClubUUID(targetClubId));
        if (!resolvedClubIdRef.current) resolvedClubIdRef.current = uuid;

        // Get current user's role
        const { data: membership } = await retryFetch(
          () =>
            supabase
              .from('club_members')
              .select('role')
              .eq('club_id', uuid)
              .eq('user_id', user.id)
              .maybeSingle()
              .then((r) => r),
          { maxRetries: 2, isMountedRef: mountedRef }
        );
        if (mountedRef.current) setRole(membership?.role || 'agent');

        /*
          AN AGENT'S DOWNLINE IS club_members.agent_id, NOT invited_by.

          This page read `invited_by` and called it referred_by, while
          AgentService.getAgentPlayers, assignPlayerToAgent and
          fn_agent_attach_player all use `agent_id`. They are not the same
          column and they do not hold the same people: estate-wide, 1,575
          memberships carry an agent_id and 417 carry an invited_by. So every
          count on this page - Total Players, Online Now, Player Chips, the
          Players tab, the churn buckets, the CSV export - was computed over a
          different set of players than the agent network screen shows for the
          same agent, and a player assigned through the proper attach path
          appeared in neither.

          Both columns are read now: agent_id is the assignment, invited_by is
          kept as a fallback for the memberships that predate it, and a player
          who satisfies either is this agent's.
        */
        const { data: downline } = await retryFetch(
          () =>
            supabase
              .from('club_members')
              .select(
                'user_id, role, chip_balance, status, created_at, agent_id, referred_by:invited_by'
              )
              .eq('club_id', uuid)
              .then((r) => r),
          { maxRetries: 2, isMountedRef: mountedRef }
        );

        // Filter to downline for non-owners
        const myDownline = (downline || []).filter(
          (m: DownlineMember) =>
            isClubStaff(membership?.role) || m.agent_id === user.id || m.referred_by === user.id
        );

        // Get profiles for all relevant users
        const allUserIds = (downline || []).map((m: DownlineMember) => m.user_id).filter(Boolean);
        const profileMap: Record<string, AgentProfile> = {};
        if (allUserIds.length > 0) {
          const { data: profiles } = await retryFetch(
            () =>
              supabase
                .from('profiles')
                .select(`id, ${PLAYER_NAME_COLUMNS}, avatar_url:arena_avatar_url`)
                .in('id', allUserIds)
                .then((r) => r),
            { maxRetries: 2, isMountedRef: mountedRef }
          );
          // Who is online now (the presence door) and when each played here
          // last (this club's player_stats). Either may fail on its own; the
          // panel then shows nobody online / no hand played, never an error.
          const presence = await readPresence(allUserIds).catch((e) => {
            reportError(e, 'AgentDashboardPage.presence');
            return new Map<string, boolean>();
          });
          const lastPlayed = new Map<string, string>();
          const { data: played, error: playedError } = await supabase
            .from('player_stats')
            .select('user_id, updated_at')
            .eq('club_id', uuid)
            .in('user_id', allUserIds);
          if (playedError) reportError(playedError, 'AgentDashboardPage.lastPlayed');
          for (const row of (played || []) as { user_id: string; updated_at: string | null }[]) {
            const prior = lastPlayed.get(row.user_id);
            if (row.updated_at && (!prior || row.updated_at > prior)) {
              lastPlayed.set(row.user_id, row.updated_at);
            }
          }
          if (profiles)
            profiles.forEach((p: AgentProfile) => {
              profileMap[p.id] = {
                ...p,
                online: presence.get(p.id) === true,
                last_played: lastPlayed.get(p.id),
              };
            });
        }

        // Enrich players with profiles
        const enrichedPlayers = myDownline.map((m: DownlineMember) => ({
          ...m,
          profile: profileMap[m.user_id] || {},
        }));

        // cashout_requests schema: player_id (not user_id), player_note (not notes), no payment_method
        const { data: cashouts, error: cashoutError } = await retryFetch(
          () =>
            supabase
              .from('cashout_requests')
              .select('id, player_id, club_id, amount, status, player_note, created_at, updated_at')
              .eq('club_id', uuid)
              .eq('status', 'pending')
              .order('created_at', { ascending: false })
              .then((r) => r),
          { maxRetries: 2, isMountedRef: mountedRef }
        );

        if (cashoutError) {
          cashoutRowsCurrent.current = null;
          throw cashoutError;
        }

        // Get commission history
        const { data: comms } = await retryFetch(
          () =>
            supabase
              // v_agent_commissions, not the table: since 20260908025653 round 2
              // pays a period without stamping each row, so the view's
              // settled_at (COALESCE(own stamp, settlement paid_at)) is the only
              // honest "has this been paid" on this screen.
              .from('v_agent_commissions')
              .select(
                'id, user_id, club_id, amount, source_type, source_id, notes, created_at, settled_at, settled_via'
              )
              .eq('club_id', uuid)
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(COMMISSION_PAGE)
              .then((r) => r),
          { maxRetries: 2, isMountedRef: mountedRef }
        );

        // Get recent transactions
        const { data: txns } = await retryFetch(
          () =>
            supabase
              .from('chip_transactions')
              .select(
                'id, from_user_id, to_user_id, club_id, amount, type:transaction_type, transaction_type, notes, created_at'
              )
              .eq('club_id', uuid)
              .order('created_at', { ascending: false })
              .limit(TX_PAGE)
              .then((r) => r),
          { maxRetries: 2, isMountedRef: mountedRef }
        );

        // Get agents list
        const agentList = (downline || [])
          .filter((m: DownlineMember) => ['agent', 'sub_agent', 'super_agent'].includes(m.role))
          .map((m: DownlineMember) => ({
            ...m,
            profile: profileMap[m.user_id] || {},
          }));

        if (!isCurrent()) return;
        cashoutRowsCurrent.current = cashoutReadCurrent;
        cashoutRowsScope.current = isCurrent;
        setCashoutsAvailable(true);
        setPlayers(enrichedPlayers);
        setPendingCashouts(cashouts || []);
        setCommissions(comms || []);
        setCommissionsHasMore((comms || []).length >= COMMISSION_PAGE);
        setRecentTx((txns || []) as ChipTransaction[]);
        setTxHasMore((txns || []).length >= TX_PAGE);
        setAgents(agentList);

        // SWR: cache successful load for instant display on revisit
        try {
          const cacheKey = `agent_dashboard_swr_${user?.id}_${targetClubId}`;
          sessionStorage.setItem(
            cacheKey,
            // The stat cards sum these arrays. A cache that truncated them
            // to 30 / 20 / 30 / 20 rows painted "Total Players 30" and a
            // 30-player chip total on every revisit until the live read
            // landed. Whole arrays, so a cache hit and a fresh load agree.
            JSON.stringify({
              players: enrichedPlayers,
              pendingCashouts: cashouts || [],
              commissions: comms || [],
              recentTx: txns || [],
              agents: agentList,
              role: membership?.role || 'agent',
              cachedAt: Date.now(),
            })
          );
        } catch (e) {
          reportError(e, 'AgentDashboardPage.map');
          /* storage full */
        }
      } catch (err: unknown) {
        if (mountedRef.current) setError(safeErrorMessage(err));
      } finally {
        dashLoadingRef.current = false;
        const trailing = dashReloadRef.current;
        dashReloadRef.current = undefined;
        if (isCurrent()) {
          setLoading(false);
          if (trailing !== undefined) void loadDashboard(trailing);
        }
      }
    },
    [clubId, user?.id, isCurrent]
  );

  // ── Initial Load ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!user?.id) return;
      /* The hamburger now stamps `?club=` on this link (it sits in the
         club-scoped Club Operations group), so an agent opening the dashboard
         from inside a club lands on THAT club's book. The param is resolved,
         so a slug works as well as a UUID.

         The fallback keeps its role filter - an agent's book only exists in
         clubs where they hold an agent-ish role - but no longer takes
         `mems[0]` from an unordered query. An agent working two clubs was
         shown whichever row came back first, which is a commission book
         chosen by the query planner. */
      const qClub = searchParams.get('club') || searchParams.get('clubId');
      let targetClub = qClub
        ? await resolvePageClubId({ routeClubId: qClub, allowFallback: false })
        : null;

      /* Named and unresolvable is a bad link. Do not answer it with a
         different club's commission book; say so. */
      if (qClub && !targetClub) {
        if (!cancelled) {
          setError('That Club Could Not Be Found.');
          setLoading(false);
        }
        return;
      }

      if (!targetClub) {
        const { data: mems } = await retryFetch(
          () =>
            supabase
              .from('club_members')
              .select('club_id')
              .eq('user_id', user.id)
              // co_owner was missing, so a co-owner with no other membership
              // was told they belong to no club at all.
              .in('role', ['agent', 'sub_agent', 'super_agent', 'owner', 'co_owner', 'admin'])
              .order('joined_at', { ascending: true })
              .then((r) => r),
          { maxRetries: 2, isMountedRef: mountedRef }
        );
        targetClub = pickPreferredClubId((mems || []).map((m: { club_id: string }) => m.club_id));
      }

      if (targetClub && !cancelled) {
        setClubId(targetClub);
        loadDashboard(targetClub);
      } else if (!cancelled) {
        setError('No club found or selected.');
        setLoading(false);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [user?.id, searchParams, loadDashboard]);

  // SWR: try to display cached data instantly on mount
  useEffect(() => {
    if (!user?.id || !clubId) return;
    try {
      const cacheKey = `agent_dashboard_swr_${user.id}_${clubId}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const age = parsed.cachedAt ? Date.now() - parsed.cachedAt : Infinity;
        if (age < SWR_TTL_MS && parsed.players) {
          setPlayers(parsed.players);
          // Cashout decisions require the fresh scoped request read, never cached rows.
          if (parsed.commissions) {
            setCommissions(parsed.commissions);
            setCommissionsHasMore(parsed.commissions.length >= COMMISSION_PAGE);
          }
          if (parsed.recentTx) {
            setRecentTx(parsed.recentTx);
            setTxHasMore(parsed.recentTx.length >= TX_PAGE);
          }
          if (parsed.agents) setAgents(parsed.agents);
          if (parsed.role) setRole(parsed.role);
          setLoading(false);
        }
      }
    } catch (e) {
      reportError(e, 'AgentDashboardPage.useEffect');
      /* corrupt cache */
    }
  }, [user?.id, clubId]);

  // ── Bus Listeners (debounced + clubId-filtered) ──────────
  // Use non-blocking refresh for bus events (doesn't show full loading skeleton)
  const refreshDashboard = useCallback(
    async (cId: string | null) => {
      setIsRefreshing(true);
      try {
        await loadDashboard(cId);
      } finally {
        if (mountedRef.current) setIsRefreshing(false);
      }
    },
    [loadDashboard]
  );

  const loadMoreTransactions = useCallback(async () => {
    if (txLoadingMore || !txHasMore || !clubId) return;
    setTxLoadingMore(true);
    try {
      const uuid = resolvedClubIdRef.current || (await resolveClubUUID(clubId));
      const { data, error } = await supabase
        .from('chip_transactions')
        .select(
          'id, from_user_id, to_user_id, club_id, amount, type:transaction_type, transaction_type, notes, created_at'
        )
        .eq('club_id', uuid)
        .order('created_at', { ascending: false })
        .range(recentTx.length, recentTx.length + TX_PAGE - 1);
      if (error) throw error;
      const more = (data || []) as ChipTransaction[];
      if (!mountedRef.current) return;
      setRecentTx((prev) => [...prev, ...more]);
      setTxHasMore(more.length >= TX_PAGE);
    } catch (e) {
      reportError(e, 'AgentDashboardPage.loadMoreTransactions');
      toast.error('Could Not Load More Transactions');
    } finally {
      if (mountedRef.current) setTxLoadingMore(false);
    }
  }, [clubId, recentTx.length, txHasMore, txLoadingMore, toast]);

  const loadMoreCommissions = useCallback(async () => {
    if (commissionsLoadingMore || !commissionsHasMore || !clubId || !user?.id) return;
    setCommissionsLoadingMore(true);
    try {
      const uuid = resolvedClubIdRef.current || (await resolveClubUUID(clubId));
      const { data, error } = await supabase
        .from('v_agent_commissions')
        .select(
          'id, user_id, club_id, amount, source_type, source_id, notes, created_at, settled_at, settled_via'
        )
        .eq('club_id', uuid)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(commissions.length, commissions.length + COMMISSION_PAGE - 1);
      if (error) throw error;
      const more = (data || []) as AgentCommission[];
      if (!mountedRef.current) return;
      setCommissions((prev) => [...prev, ...more]);
      setCommissionsHasMore(more.length >= COMMISSION_PAGE);
    } catch (e) {
      reportError(e, 'AgentDashboardPage.loadMoreCommissions');
      toast.error('Could Not Load More Commissions');
    } finally {
      if (mountedRef.current) setCommissionsLoadingMore(false);
    }
  }, [clubId, user?.id, commissions.length, commissionsHasMore, commissionsLoadingMore, toast]);

  useEffect(() => {
    if (!clubId) return;
    const refresh = () => refreshDashboard(clubId);
    // Filtered refresh: only reload if the event is for this club (or has no clubId)
    const filteredRefresh = (event?: { payload?: { clubId?: string } }) => {
      if (!event?.payload?.clubId || event.payload.clubId === clubId) {
        refresh();
      }
    };
    const unsubs = [
      masterBus.subscribeDebounced('CASHOUT_APPROVED', filteredRefresh, 300),
      masterBus.subscribeDebounced('CASHOUT_CANCELLED', filteredRefresh, 300),
      masterBus.subscribeDebounced('CASHOUT_REQUESTED', filteredRefresh, 300),
      masterBus.subscribeDebounced('CHIPS_DISTRIBUTED', filteredRefresh, 300),
      masterBus.subscribeDebounced('AGENT_UPDATED', filteredRefresh, 300),
      masterBus.subscribeDebounced('BALANCE_UPDATED', refresh, 300),
      masterBus.subscribeDebounced('CREDIT_UPDATED', filteredRefresh, 300),
    ];
    return () => unsubs.forEach((u) => u());
  }, [clubId, refreshDashboard]);

  // ── Supabase Realtime - cross-user WebSocket updates ──
  const loadDashboardRef = useRef(loadDashboard);
  loadDashboardRef.current = loadDashboard;

  useEffect(() => {
    if (!clubId) return;
    let isMounted = true;
    let acquiredChannel: ReturnType<typeof masterBus.getOrCreateChannel> | null = null;
    const channelKey = `agent-dashboard-${clubId}`;

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
            table: 'cashout_requests',
            filter: `club_id=eq.${resolvedId}`,
          },
          () => loadDashboardRef.current(clubId)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chip_transactions',
            filter: `club_id=eq.${resolvedId}`,
          },
          () => loadDashboardRef.current(clubId)
        )
        .subscribe((status: string, err?: Error) => {
          if (status === 'CHANNEL_ERROR') {
            if (err) reportError(err?.message || err, 'AgentDashboardPage._Realtime_channel_error');
          }
          if (status === 'TIMED_OUT') {
            console.warn('[AgentDashboardPage] Realtime channel timed out');
          }
        });
    };

    masterBus.registerChannelFactory?.(channelKey, () => {
      if (isMounted) void setupRealtime();
    });
    setupRealtime().catch((e) => console.warn('[AgentDashboardPage] Realtime setup failed:', e));

    return () => {
      isMounted = false;
      masterBus.removeChannelFactory?.(channelKey);
      if (acquiredChannel) {
        masterBus.removeRegisteredChannel(channelKey, acquiredChannel);
      }
    };
  }, [clubId]);

  // ── Visibility Refresh - refresh on tab focus after 30s ──
  useVisibilityRefresh(() => loadDashboard(clubId));

  const decisions = usePreparedCashoutOperations(
    pendingCashouts.flatMap((row) => [
      {
        key: `${row.id}:approve`,
        intent: {
          userId: user?.id ?? '',
          receiptViewCurrent: isCurrent,
          playerId: row.player_id,
          clubId: row.club_id,
          targetId: row.id,
          kind: 'cashout_approve' as const,
          amount: row.amount,
        },
      },
      {
        key: `${row.id}:reject`,
        intent: {
          userId: user?.id ?? '',
          receiptViewCurrent: isCurrent,
          playerId: row.player_id,
          clubId: row.club_id,
          targetId: row.id,
          kind: 'cashout_decline' as const,
          amount: row.amount,
          note: 'Denied by agent',
        },
      },
    ]),
    cashoutRowsCurrent.current,
    pendingCashouts
  );

  const receiptChecks = useCashoutReceiptChecks(isCurrent, () => {
    void loadDashboard(clubId);
  });

  // Cashout decisions use a frozen scoped row and durable operation identity.
  const processCashout = async (cashoutId: string, action: 'approve' | 'reject') => {
    if (
      !user?.id ||
      !clubId ||
      !isCurrent() ||
      !cashoutRowsCurrent.current?.() ||
      cashoutInFlight.current
    )
      return;
    const cashout = pendingCashouts.find((row) => row.id === cashoutId && row.status === 'pending');
    if (!cashout || cashout.club_id !== resolvedClubIdRef.current) {
      setError('Refresh To Verify This Cashout Before Acting');
      return;
    }
    cashoutInFlight.current = true;
    let start: CashoutStart | null = null;
    let checkingOutcome = false;
    try {
      const prepared = decisions.get(
        `${cashout.id}:${action}`,
        action === 'approve' ? 'cashout_approve' : 'cashout_decline'
      );
      if (!prepared) throw new Error('Wait For This Cashout Request To Be Verified');
      start = captureCashoutStart(prepared);
      setProcessing(true);
      setError(null);
      checkingOutcome = true;
      const recovery = await recoverCashoutOperation(start);
      checkingOutcome = false;
      assertCashoutStartCurrent(start);
      if (!recovery.found) {
        const confirmed = await confirmDialog({
          message:
            action === 'approve'
              ? 'Approve this cashout request?'
              : 'Decline and return this cashout’s chips?',
          variant: 'danger',
        });
        if (!confirmed) return;
        assertCashoutStartCurrent(start);
        checkingOutcome = true;
        await runCashoutOperation(start);
        checkingOutcome = false;
      }
      assertCashoutStartCurrent(start);
      setSuccess(
        action === 'approve'
          ? 'Cashout approved. Invoice recorded.'
          : 'Cashout declined. Chips returned to the player.'
      );
      void loadDashboard(clubId);
    } catch (err) {
      if (checkingOutcome && start && isCurrent() && outcomeNeedsReceiptCheck(err))
        receiptChecks.retain(
          `${cashout.id}:${action}`,
          cashout.amount,
          action === 'approve' ? 'Cashout Approval' : 'Cashout Decline',
          start
        );
      if (isCurrent() && (!start || isCashoutStartCurrent(start))) setError(safeErrorMessage(err));
    } finally {
      cashoutInFlight.current = false;
      if (isCurrent()) {
        setProcessing(false);
        if (!dashLoadingRef.current && dashReloadRef.current !== undefined) {
          const trailing = dashReloadRef.current;
          dashReloadRef.current = undefined;
          void loadDashboard(trailing);
        }
      }
    }
  };
  const approveCashout = (id: string) => processCashout(id, 'approve');
  const denyCashout = (id: string) => processCashout(id, 'reject');

  // ── Transfer ───────────────────────────────────────────────
  /**
   * WHAT THIS USED TO CALL, AND WHY NOTHING EVER MOVED.
   *
   * `WalletService.transferToUser` goes to the `wallet_user_transfer` RPC,
   * which is SECURITY INVOKER and on which `authenticated` holds no EXECUTE.
   * Every press of this button, on a modal titled "Agent-To-Agent Transfer",
   * came back a permission error. Had it been granted it would still have been
   * the wrong call: a bare PLAYER to PLAYER wallet move, with no club in it at
   * all, from a form that asks for a club member.
   *
   * fn_agent_wallet_send is the send the platform actually uses. It is
   * definer, it is granted, it enforces the downline server-side, it credits
   * the wallet the sender chose (2026-10-16), and it takes a retry key
   * so a repeated call replays rather than sending twice. The note the form
   * has always collected and thrown away is now the send's reason.
   */
  const executeTransfer = async () => {
    if (
      !transferTarget ||
      !transferAmount ||
      !clubId ||
      !user?.id ||
      walletOperationInFlightRef.current
    )
      return;
    walletOperationInFlightRef.current = true;
    setProcessing(true);
    setError(null);
    try {
      const resolvedClub = await resolveClubUUID(clubId);
      const amt = Number(transferAmount);
      assertChipAmount(amt);
      await runAgentWalletOperation(
        {
          userId: user.id,
          clubId: resolvedClub,
          targetId: transferTarget,
          kind: 'agent_send',
          destination: transferDestination,
          amount: amt,
        },
        async (operation) => {
          const { data, error: sendError } = await supabase.rpc('fn_agent_wallet_send', {
            p_club_id: resolvedClub,
            p_to_user_id: transferTarget,
            p_amount: amt,
            p_destination: transferDestination,
            p_reason: transferNotes.trim() || 'Agent transfer',
            p_op_id: operation.operationId,
          });
          if (sendError) throw sendError;
          if (!confirmedAgentWalletReceipt(data, amt, 'agent_send', transferDestination)) {
            throw new Error(data?.error || 'The Cashier Did Not Confirm That Transfer');
          }
        }
      );
      setSuccess(`Transferred ${fmtChips(amt)} chips.`);
      masterBus.emit('CHIPS_DISTRIBUTED', { clubId: resolvedClub, amount: amt });
      setShowTransfer(false);
      setTransferTarget('');
      setTransferAmount('');
      setTransferNotes('');
      setTransferDestination('agent_wallet');
      loadDashboard(clubId);
    } catch (err: unknown) {
      setError(safeErrorMessage(err));
    } finally {
      walletOperationInFlightRef.current = false;
      setProcessing(false);
    }
  };

  // ── Derived Data ───────────────────────────────────────────
  const filteredPlayers = useMemo(() => {
    if (!playerSearch) return players;
    const q = playerSearch.toLowerCase();
    return players.filter((p) => {
      const name = (p.profile ? playerDisplayName(p.profile) : p.user_id || '').toLowerCase();
      return name.includes(q);
    });
  }, [players, playerSearch]);

  const totalPlayerChips = players.reduce((sum, p) => sum + (p.chip_balance || 0), 0);
  const onlinePlayers = players.filter((p) => p.profile?.online === true);

  // ── Workspace Mast ─────────────────────────────────────────
  /* #SmarterDesign (Dan 2026-11-27): the arena mast carries the title, the
     club the link named and the chrome "?" help. */
  const header = (
    <ArenaWorkspaceHeader
      area="operations"
      title="Agent Dashboard"
      context={clubContext(searchParams.get('club') || searchParams.get('clubId') || undefined)}
      summary="Your Downline, Cashouts, Commissions And Agent Wallet In One Place."
    />
  );

  // ── Loading State ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="arena-workspace agent-dash-page">
        {header}
        <ArenaState tone="loading" title="Loading" message="Reading Your Agent Network" />
      </div>
    );
  }

  if (!clubId) {
    return (
      <div className="arena-workspace agent-dash-page">
        {header}
        <ArenaState
          tone="empty"
          title="No Agent Workspace Is Available"
          message={
            error ||
            'Agent Balances, Downlines, Cashouts, And Commissions Belong To A Club. Open The Agent Team From An Authorized Club Workspace.'
          }
          actions={
            <>
              <button type="button" onClick={() => navigate('/')}>
                Return To Arena
              </button>
              <button type="button" onClick={() => navigate('/search')}>
                Find Clubs
              </button>
            </>
          }
        />
      </div>
    );
  }

  const isOwnerOrAdmin = ['owner', 'co_owner', 'admin'].includes(role);
  const isOwner = role === 'owner';
  const pendingCashoutTotal = sumChips(pendingCashouts.map((c: CashoutRequest) => c.amount || 0));

  return (
    <div className="arena-workspace agent-dash-page">
      {header}
      {/* Bus-driven reloads were invisible: isRefreshing was set and never
          read, so a balance that changed under the operator changed with no
          sign the page had moved. */}
      <PageBar
        title="Agent Dashboard"
        titleAs={false}
        showHelp={false}
        metrics={[
          { label: 'Role', value: role.toUpperCase() },
          { label: 'Players', value: fmt(players.length) },
          { label: 'Online Now', value: fmt(onlinePlayers.length), tone: 'live' },
          {
            label: 'Pending Cashouts',
            value: cashoutsAvailable ? fmt(pendingCashouts.length) : 'Unavailable',
            tone: cashoutsAvailable && pendingCashouts.length > 0 ? 'attention' : 'default',
          },
        ]}
      >
        {isRefreshing && (
          <p className="arena-ops-live" aria-live="polite">
            Refreshing...
          </p>
        )}
      </PageBar>

      {/* Banners */}
      {error && (
        <p className="agent-dash-banner" data-tone="danger">
          {error}
        </p>
      )}
      {success && (
        <p className="agent-dash-banner" data-tone="live">
          {success}
        </p>
      )}

      {/* Transfer Modal */}
      {showTransfer && (
        <div className="agent-dash-overlay" onClick={() => setShowTransfer(false)}>
          <div
            className="arena-case arena-ops-case agent-dash-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="arena-section-title">
              Agent-To-Agent Transfer
              <span className="arena-switch">
                <button type="button" aria-label="Close" onClick={() => setShowTransfer(false)}>
                  ✕
                </button>
              </span>
            </h3>
            <div className="agent-dash-form">
              <label className="agent-dash-field">
                <span>Recipient Agent User ID</span>
                <input
                  className="arena-ops-well"
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                  placeholder="UUID Of Receiving Agent"
                />
              </label>
              <div className="agent-dash-field">
                <label htmlFor="agent-transfer-recipient-wallet">Recipient Wallet</label>
                <select
                  id="agent-transfer-recipient-wallet"
                  className="arena-ops-well"
                  value={transferDestination}
                  disabled={processing}
                  onChange={(event) =>
                    setTransferDestination(event.target.value as ClubBankRecipientWallet)
                  }
                >
                  {(['agent_wallet', 'promo_wallet', 'player_wallet'] as const).map((wallet) => (
                    <option key={wallet} value={wallet}>
                      {SEND_DESTINATION_LABELS[wallet]}
                    </option>
                  ))}
                </select>
                {transferDestination === 'promo_wallet' && (
                  <>
                    <p className="arena-ops-copy">{PROMO_PLAY_THROUGH_SENDER_TERMS}</p>
                    <p className="arena-ops-copy">
                      Each Downline Can Receive 50 Promo Chips Total From All Agents In Any 7 Days.
                      All Funding And Destination Wallets Share This Limit.
                    </p>
                  </>
                )}
              </div>
              <label className="agent-dash-field">
                <span>Amount (Chips)</span>
                <input
                  className="arena-ops-well"
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0"
                  min="1"
                />
              </label>
              <label className="agent-dash-field">
                <span>Notes (Optional)</span>
                <input
                  className="arena-ops-well"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="Transfer Reason..."
                />
              </label>
              <div className="arena-switch arena-ops-primary">
                <button
                  type="button"
                  onClick={executeTransfer}
                  disabled={processing || !transferTarget || !transferAmount}
                >
                  {processing
                    ? 'Processing...'
                    : `Transfer ${transferAmount ? fmtChips(parseFloat(transferAmount)) : '0'} Chips`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header keys */}
      <div className="arena-switch arena-ops-keys">
        <button type="button" onClick={() => navigate('/')}>
          Lobby
        </button>
        <button type="button" onClick={() => setShowTransfer(true)}>
          Transfer
        </button>
        <button type="button" onClick={() => loadDashboard(clubId)} disabled={processing}>
          ↻ Refresh
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              if (tab === 'players' && players.length > 0) {
                exportToCSV(
                  players.map((p) => ({
                    username: p.profile ? playerDisplayName(p.profile) : p.user_id,
                    role: p.role,
                    chip_balance: p.chip_balance,
                    status: p.status,
                    joined: p.created_at,
                  })),
                  'agent_players.csv',
                  [
                    { key: 'username', label: 'Player' },
                    { key: 'role', label: 'Role' },
                    { key: 'chip_balance', label: 'Balance' },
                    { key: 'status', label: 'Status' },
                    { key: 'joined', label: 'Joined' },
                  ]
                );
              } else if (tab === 'cashouts' && cashoutsAvailable && pendingCashouts.length > 0) {
                exportToCSV(pendingCashouts, 'agent_cashouts.csv', [
                  { key: 'player_id', label: 'Player ID' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'status', label: 'Status' },
                  { key: 'created_at', label: 'Requested' },
                ]);
              } else if (tab === 'commissions' && commissions.length > 0) {
                exportToCSV(commissions, 'agent_commissions.csv', [
                  { key: 'amount', label: 'Amount' },
                  // The export carries the same fact the table now shows:
                  // a claimed row and an owed row are not the same money.
                  { key: 'settled_at', label: 'Claimed At' },
                  { key: 'source_type', label: 'Source' },
                  { key: 'notes', label: 'Notes' },
                  { key: 'created_at', label: 'Date' },
                ]);
              } else if (tab === 'overview' && recentTx.length > 0) {
                exportToCSV(recentTx, 'agent_transactions.csv', [
                  { key: 'transaction_type', label: 'Type' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'from_user_id', label: 'From' },
                  { key: 'to_user_id', label: 'To' },
                  { key: 'created_at', label: 'Date' },
                ]);
              }
            } catch (e) {
              reportError(e, 'AgentDashboardPage');
              /* silent */
            }
          }}
        >
          Export
        </button>
      </div>

      {/* Pending Cashouts Alert */}
      {cashoutsAvailable && pendingCashouts.length > 0 && tab !== 'cashouts' && (
        <button type="button" className="agent-dash-alert" onClick={() => setTab('cashouts')}>
          <strong>{pendingCashouts.length}</strong> Pending Cashout Request
          {pendingCashouts.length !== 1 ? 's' : ''} - {fmtChips(pendingCashoutTotal)} Chips Waiting
        </button>
      )}

      {/* Tabs: one chrome switch; the open view lights blue. */}
      <nav className="arena-switch arena-ops-keys" aria-label="Agent Dashboard Views">
        {[
          { id: 'overview' as AgentTab, label: 'Overview' },
          { id: 'players' as AgentTab, label: 'Players', badge: players.length },
          {
            id: 'cashouts' as AgentTab,
            label: 'Cashouts',
            badge: cashoutsAvailable ? pendingCashouts.length || undefined : undefined,
          },
          { id: 'commissions' as AgentTab, label: 'Commissions' },
          { id: 'statement' as AgentTab, label: 'Statement' },
          { id: 'analytics' as AgentTab, label: 'Analytics' },
          { id: 'score' as AgentTab, label: 'Score' },
          ...(isOwnerOrAdmin ? [{ id: 'promo' as AgentTab, label: 'Promo' }] : []),
          ...(isOwner ? [{ id: 'credit' as AgentTab, label: 'Credit' }] : []),
        ].map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge ? <span className="agent-dash-count">{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      {/* ══════ TAB: OVERVIEW ══════ */}
      {tab === 'overview' && (
        <section className="arena-case arena-ops-case" aria-label="Overview">
          <ArenaReadings
            label="Agent Overview"
            readings={[
              { id: 'players', label: 'Total Players', value: fmt(players.length) },
              {
                id: 'online',
                label: 'Online Now',
                value: fmt(onlinePlayers.length),
                tone: 'live',
              },
              { id: 'chips', label: 'Player Chips', value: fmtChips(totalPlayerChips) },
              {
                id: 'pending',
                label: 'Pending Cashouts',
                value: cashoutsAvailable ? fmt(pendingCashouts.length) : 'Unavailable',
                tone: 'attention',
              },
              {
                id: 'amount',
                label: 'Cashout Amount',
                value: cashoutsAvailable
                  ? fmtChips(sumChips(pendingCashouts.map((c: CashoutRequest) => c.amount)))
                  : 'Unavailable',
                tone: 'danger',
              },
            ]}
          />

          {/* Recent Transactions */}
          <h2 className="arena-section-title">Recent Transactions</h2>
          {recentTx.length === 0 ? (
            <ArenaState tone="empty" title="No Recent Transactions" />
          ) : (
            <>
              <ul className="arena-ops-rows arena-ops-rows--single">
                {recentTx.map((tx, i: number) => (
                  <li key={tx.id || i}>
                    <ArenaRow
                      title={tx.transaction_type || 'Transfer'}
                      line={`${tx.from_user_id?.substring(0, 8) || '-'}.. → ${tx.to_user_id?.substring(0, 8) || '-'}.. - ${timeAgo(tx.created_at)}`}
                      signal={fmtChips(tx.amount)}
                      signalTone="attention"
                    />
                  </li>
                ))}
              </ul>
              {txHasMore ? (
                <div className="arena-switch">
                  <button
                    type="button"
                    onClick={() => void loadMoreTransactions()}
                    disabled={txLoadingMore}
                  >
                    {txLoadingMore ? 'Loading...' : `Load ${fmt(TX_PAGE)} More`}
                  </button>
                </div>
              ) : (
                <p className="arena-ops-copy">All {fmt(recentTx.length)} Transactions Loaded</p>
              )}
            </>
          )}
        </section>
      )}

      {/* ══════ TAB: PLAYERS ══════ */}
      {tab === 'players' && (
        <section className="arena-case arena-ops-case" aria-label="Players">
          <input
            className="arena-ops-well"
            placeholder="Search Players By Name..."
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
          />
          <ArenaReadings
            label="Player Summary"
            readings={[
              {
                id: 'players',
                label: `${playerSearch ? 'Matching' : 'Total'} Players`,
                value: filteredPlayers.length,
              },
              {
                id: 'online',
                label: 'Online Now',
                value: filteredPlayers.filter((p) => p.profile?.online === true).length,
                tone: 'live',
              },
              {
                id: 'chips',
                label: 'Total Chips',
                value: fmtChips(
                  sumChips(filteredPlayers.map((p: DownlineMember) => p.chip_balance || 0))
                ),
                tone: 'attention',
              },
            ]}
          />

          {filteredPlayers.length === 0 ? (
            <ArenaState
              tone="empty"
              title={
                playerSearch ? 'No Players Match Your Search' : 'No Players In Your Downline Yet'
              }
            />
          ) : (
            <ul className="arena-ops-rows">
              {filteredPlayers.map((p) => {
                const name = p.profile ? playerDisplayName(p.profile) : p.user_id?.substring(0, 8);
                const isOnline = p.profile?.online === true;
                return (
                  <li key={p.user_id}>
                    <ArenaRow
                      title={name}
                      line={`${p.role} - ${p.chip_balance !== undefined ? formatWalletChips(p.chip_balance) : '...'} - ${timeAgo(p.profile?.last_played)}`}
                      signal={isOnline ? 'Online' : undefined}
                      signalTone="live"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <CashoutReceiptChecks checks={receiptChecks} />
      {/* ══════ TAB: CASHOUTS ══════ */}
      {tab === 'cashouts' && (
        <section className="arena-case arena-ops-case" aria-label="Pending Cashout Requests">
          <h2 className="arena-section-title">
            Pending Cashout Requests
            <small>{cashoutsAvailable ? `${pendingCashouts.length} Pending` : 'Unavailable'}</small>
          </h2>

          {decisions.error && <p role="status">{decisions.error}</p>}
          {!cashoutsAvailable ? (
            <ArenaState
              tone="error"
              title="Pending Cashouts Could Not Be Verified."
              actions={
                <button type="button" onClick={() => void loadDashboard(clubId)}>
                  Refresh Cashouts
                </button>
              }
            />
          ) : pendingCashouts.length === 0 ? (
            <ArenaState tone="empty" title="No Pending Cashout Requests" />
          ) : (
            <ul className="arena-ops-rows arena-ops-rows--single">
              {pendingCashouts.map((c) => (
                <li key={c.id} className="arena-ledger-row agent-dash-row">
                  <span className="agent-dash-row-head">
                    <strong>{c.player_id?.substring(0, 8)}..</strong>
                    <span className="agent-dash-gold">{fmtChips(c.amount)}</span>
                  </span>
                  <small>
                    {c.player_note || '-'} - {timeAgo(c.created_at)}
                  </small>
                  <div className="arena-switch arena-ops-keys">
                    <button
                      type="button"
                      onClick={() => approveCashout(c.id)}
                      disabled={processing || !decisions.get(`${c.id}:approve`, 'cashout_approve')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => denyCashout(c.id)}
                      disabled={processing || !decisions.get(`${c.id}:reject`, 'cashout_decline')}
                    >
                      Deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <ArenaReadings
            label="Cashout Totals"
            readings={[
              {
                id: 'pending',
                label: 'Pending',
                value: cashoutsAvailable ? fmt(pendingCashouts.length) : 'Unavailable',
                tone: 'attention',
              },
              {
                id: 'amount',
                label: 'Total Amount',
                value: cashoutsAvailable
                  ? fmtChips(sumChips(pendingCashouts.map((c: CashoutRequest) => c.amount)))
                  : 'Unavailable',
                tone: 'danger',
              },
            ]}
          />
        </section>
      )}

      {/* ══════ TAB: COMMISSIONS ══════ */}
      {tab === 'commissions' && (
        <section className="arena-case arena-ops-case" aria-label="Commission History">
          <h2 className="arena-section-title">Commission History</h2>
          {commissions.length === 0 ? (
            <ArenaState tone="empty" title="No Commission Records Yet" />
          ) : (
            <ul className="arena-ops-rows arena-ops-rows--single">
              {commissions.map((c: AgentCommission, i: number) => (
                /* Claimed or not. Until phase 6 there was no way to claim
                   commission at all, so every row here meant the same thing;
                   now they do not, and a list that cannot tell them apart is
                   a list of two different numbers. */
                <li key={c.id || i}>
                  <ArenaRow
                    title={c.source_type || 'Rake'}
                    line={
                      <>
                        {c.settled_at ? 'Claimed' : 'Unclaimed'} - {c.notes || '-'} -{' '}
                        {timeAgo(c.created_at)}
                      </>
                    }
                    signal={fmtChips(c.amount)}
                    signalTone={c.settled_at ? 'live' : 'attention'}
                  />
                </li>
              ))}
            </ul>
          )}
          {commissions.length > 0 &&
            (commissionsHasMore ? (
              <div className="arena-switch">
                <button
                  type="button"
                  onClick={() => void loadMoreCommissions()}
                  disabled={commissionsLoadingMore}
                >
                  {commissionsLoadingMore ? 'Loading...' : `Load ${fmt(COMMISSION_PAGE)} More`}
                </button>
              </div>
            ) : (
              <p className="arena-ops-copy">All {fmt(commissions.length)} Commission Rows Loaded</p>
            ))}
        </section>
      )}

      {/* ══════ TAB: ANALYTICS ══════ */}
      {tab === 'analytics' && (
        <section className="arena-case arena-ops-case" aria-label="Player Activity">
          <ArenaReadings
            label="Downline Activity"
            readings={[
              { id: 'players', label: 'Total Players', value: fmt(players.length) },
              {
                id: 'active',
                label: 'Active (5Min)',
                value: fmt(onlinePlayers.length),
                tone: 'live',
              },
              {
                id: 'risk',
                label: 'At-Risk (5-14D)',
                value: fmt(
                  players.filter((p: DownlineMember) => {
                    const ls = p.profile?.last_played;
                    if (!ls) return false;
                    const days = (Date.now() - new Date(ls).getTime()) / 86400000;
                    return days >= 5 && days < 14;
                  }).length
                ),
                tone: 'attention',
              },
              {
                id: 'churned',
                label: 'Churned (14D+)',
                value: fmt(
                  players.filter((p: DownlineMember) => {
                    const ls = p.profile?.last_played;
                    if (!ls) return true;
                    return (Date.now() - new Date(ls).getTime()) / 86400000 >= 14;
                  }).length
                ),
                tone: 'danger',
              },
            ]}
          />

          <h2 className="arena-section-title">Player Activity</h2>
          {players.length === 0 ? (
            <ArenaState tone="empty" title="No Player Data" />
          ) : (
            <ul className="arena-ops-rows">
              {players.map((p: DownlineMember, i: number) => {
                const lastSeen = p.profile?.last_played;
                const daysSince = lastSeen
                  ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86400000)
                  : 999;
                const tone = daysSince <= 5 ? 'live' : daysSince <= 14 ? 'attention' : 'danger';
                return (
                  <li key={p.user_id || i}>
                    <ArenaRow
                      title={p.profile ? playerDisplayName(p.profile) : p.user_id?.substring(0, 8)}
                      line={`${daysSince <= 5 ? 'Active' : daysSince <= 14 ? 'At Risk' : 'Churned'} - ${p.chip_balance !== undefined ? formatWalletChips(p.chip_balance) : '...'} - ${timeAgo(lastSeen)}`}
                      signal={`${daysSince}d`}
                      signalTone={tone}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ══════ TAB: SCORE ══════ */}
      {tab === 'score' && user && (
        <section className="arena-case arena-ops-case" aria-label="Score">
          <AgentScoreCard userId={user.id} clubId={clubId || ''} />
        </section>
      )}

      {/* ══════ TAB: PROMO ══════ */}
      {tab === 'promo' && isOwnerOrAdmin && (
        <section className="arena-case arena-ops-case" aria-label="Grant Promo To Agent">
          <h2 className="arena-section-title">Grant Promo To Agent</h2>
          <div className="agent-dash-inline">
            <select
              className="arena-ops-well"
              value={creditTarget}
              onChange={(e) => {
                promoOpIdRef.current = null;
                setCreditTarget(e.target.value);
              }}
            >
              <option value="">Select Agent...</option>
              {agents.map((a: DownlineMember) => (
                <option key={a.user_id} value={a.user_id}>
                  {a.profile ? playerDisplayName(a.profile) : a.user_id?.slice(0, 8)} (
                  {a.chip_balance !== undefined ? formatWalletChips(a.chip_balance) : '...'} Chips)
                </option>
              ))}
            </select>
            <input
              className="arena-ops-well"
              type="number"
              placeholder="Amount"
              min="1"
              value={creditAmount}
              onChange={(e) => {
                promoOpIdRef.current = null;
                setCreditAmount(e.target.value);
              }}
            />
          </div>
          <div className="arena-switch arena-ops-primary">
            <button
              type="button"
              disabled={processing || !creditTarget || !creditAmount}
              onClick={async () => {
                setProcessing(true);
                setError(null);
                try {
                  const promoAmt = Number(creditAmount);
                  if (isNaN(promoAmt) || promoAmt <= 0) {
                    setError('Enter a valid chip amount');
                    setProcessing(false);
                    return;
                  }
                  // Promo is disbursed by the owner of the float: the union
                  // when this club is in one, the club itself when it is not.
                  // WalletService.disbursePromo resolves that and the database
                  // refuses anyone who is not that owner.
                  const resolvedClub = await resolveClubUUID(clubId || '');
                  if (!promoOpIdRef.current) promoOpIdRef.current = uuid();
                  await WalletService.disbursePromo(
                    resolvedClub,
                    creditTarget,
                    promoAmt,
                    'Promo granted from the club dashboard',
                    promoOpIdRef.current
                  );
                  promoOpIdRef.current = null;
                  setSuccess(`Granted ${fmtChips(promoAmt)} promo chips!`);
                  setCreditTarget('');
                  setCreditAmount('');
                  loadDashboard(clubId);
                } catch (err: unknown) {
                  setError(safeErrorMessage(err));
                } finally {
                  setProcessing(false);
                }
              }}
            >
              {processing ? 'Granting...' : 'Grant Promo'}
            </button>
          </div>

          {agents.length > 0 && (
            <>
              <h2 className="arena-section-title">Agent Breakdown</h2>
              <ul className="arena-ops-rows arena-ops-rows--single">
                {agents.map((a: DownlineMember) => (
                  <li key={a.user_id}>
                    <ArenaRow
                      title={a.profile ? playerDisplayName(a.profile) : a.user_id?.substring(0, 8)}
                      line={a.role}
                      signal={
                        a.chip_balance !== undefined ? formatWalletChips(a.chip_balance) : '...'
                      }
                      signalTone={
                        a.chip_balance !== undefined && a.chip_balance > 0 ? 'live' : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ══════ TAB: CREDIT ══════ */}
      {tab === 'credit' && isOwner && (
        <section className="arena-case arena-ops-case" aria-label="Agent Funding">
          <h2 className="arena-section-title">Agent Funding</h2>
          <p className="arena-ops-copy">
            Send Funded Chips Into An Agent Wallet. Credit Lines Track Advances Separately.
          </p>
          <div className="agent-dash-form">
            <label className="agent-dash-field">
              <span>Agent</span>
              <select
                className="arena-ops-well"
                value={creditTarget}
                onChange={(e) => {
                  invalidateCreditInput();
                  setCreditTarget(e.target.value);
                }}
              >
                <option value="">Select Agent...</option>
                {agents.map((a: DownlineMember) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.profile ? playerDisplayName(a.profile) : a.user_id?.slice(0, 8)} - {a.role}
                  </option>
                ))}
              </select>
            </label>
            <label className="agent-dash-field">
              <span>Amount</span>
              <input
                className="arena-ops-well"
                type="number"
                value={creditAmount}
                onChange={(e) => {
                  invalidateCreditInput();
                  setCreditAmount(e.target.value);
                }}
                placeholder="0"
                min="1"
              />
            </label>
            <label className="agent-dash-field">
              <span>Notes (Optional)</span>
              <input
                className="arena-ops-well"
                value={creditNotes}
                onChange={(e) => {
                  invalidateCreditInput();
                  setCreditNotes(e.target.value);
                }}
                placeholder="Reason..."
              />
            </label>
            <div className="arena-switch arena-ops-primary">
              <button
                type="button"
                disabled={processing || !creditTarget || !creditAmount}
                onClick={async () => {
                  if (!user?.id || !clubId || walletOperationInFlightRef.current) return;
                  walletOperationInFlightRef.current = true;
                  setProcessing(true);
                  setError(null);
                  try {
                    const amt = Number(creditAmount);
                    assertChipAmount(amt);
                    /* Funding moves existing chips into the Agent Wallet.
                         A tracking line never supplies chips to this send. */
                    const resolvedCreditClub = await resolveClubUUID(clubId || '');
                    const note = creditNotes.trim() || undefined;
                    await runAgentWalletOperation(
                      {
                        userId: user.id,
                        clubId: resolvedCreditClub,
                        targetId: creditTarget,
                        kind: 'agent_send',
                        destination: 'agent_wallet',
                        amount: amt,
                      },
                      async (operation) => {
                        const { data, error: fundError } = await supabase.rpc(
                          'fn_agent_wallet_send',
                          {
                            p_club_id: resolvedCreditClub,
                            p_to_user_id: creditTarget,
                            p_amount: amt,
                            p_destination: 'agent_wallet',
                            p_reason: note || 'Prepaid funding',
                            p_op_id: operation.operationId,
                          }
                        );
                        if (fundError) throw fundError;
                        if (!confirmedAgentWalletReceipt(data, amt, 'agent_send', 'agent_wallet')) {
                          throw new Error(
                            data?.error || 'The Cashier Did Not Confirm That Funding'
                          );
                        }
                      }
                    );
                    setSuccess(`Prepaid Chips Sent - ${fmtChips(amt)} Chips`);
                    masterBus.emit('CREDIT_UPDATED', {
                      clubId: clubId || '',
                      userId: creditTarget,
                    });
                    setCreditAmount('');
                    setCreditNotes('');
                    loadDashboard(clubId);
                  } catch (err: unknown) {
                    setError(safeErrorMessage(err));
                  } finally {
                    walletOperationInFlightRef.current = false;
                    setProcessing(false);
                  }
                }}
              >
                {processing ? 'Processing...' : 'Send Prepaid Chips'}
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === 'statement' && (
        <section className="arena-case arena-ops-case" aria-label="Weekly Statement">
          <AgentBackOffice
            key={`${user?.id}:${clubId}`}
            clubId={clubId ?? undefined}
            title="Weekly Statement & Roster"
          />
        </section>
      )}

      {/* TRANSACTION HISTORY - chip_ledger entries for this agent */}
      <section className="arena-case arena-ops-case" aria-label="Transaction History">
        <h2 className="arena-section-title">Transaction History</h2>
        <TransactionLedgerView
          userId={user?.id || undefined}
          clubId={clubId || undefined}
          limit={20}
        />
      </section>
    </div>
  );
}

/** The reduction form owns its accepted intent; reload cards have receipt-only authority. */
export function CreditReductionControls(props: {
  actorId: string;
  clubId: string;
  targetUserId: string;
  amount: string;
  note: string;
  enabled: boolean;
  isCurrent: () => boolean;
  revision: number;
  getRevision: () => number;
}) {
  const { actorId, clubId } = props;
  const scope = useCashoutScope(actorId, clubId);
  const live = useRef(true);
  const token = useRef<object | null>(null);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [prepared, setPrepared] = useState<{
    token: object;
    value: PreparedCreditReduction;
  } | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [pendingRows, setPendingRows] = useState<{
    scope: () => boolean;
    rows: PendingCreditReduction[];
  } | null>(null);
  const [receipt, setReceipt] = useState<{
    scope: () => boolean;
    value: Readonly<CreditReductionEnvelope>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const inputKey = JSON.stringify([
    actorId,
    clubId,
    props.targetUserId,
    props.amount,
    props.note,
    props.enabled,
    props.revision,
    refresh,
  ]);
  const input = useRef<{ key: string; token: object } | null>(null);
  if (!input.current || input.current.key !== inputKey)
    input.current = { key: inputKey, token: {} };
  token.current = input.current.token;
  const formToken = input.current.token;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      token.current = null;
    };
  }, []);
  const receiptCurrent = useCallback(
    () => live.current && scope() && props.isCurrent(),
    [scope, props.isCurrent]
  );
  useEffect(() => {
    let active = true;
    setPendingRows(null);
    void listPendingCreditReductions(actorId, clubId, receiptCurrent)
      .then((rows) => {
        if (active && receiptCurrent()) setPendingRows({ scope: receiptCurrent, rows });
      })
      .catch(() => {
        if (active && receiptCurrent())
          setError(
            'Pending Credit Changes Are Unavailable. Keep This Browser Data And Check Again.'
          );
      });
    return () => {
      active = false;
    };
  }, [actorId, clubId, receiptCurrent, refresh]);
  useEffect(() => {
    setPrepared(null);
    setPreparationError(null);
    if (!props.enabled || !props.targetUserId || !props.amount) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () =>
      active &&
      receiptCurrent() &&
      token.current === formToken &&
      props.getRevision() === props.revision;
    try {
      const amount = creditReductionAmount(props.amount);
      const reason = props.note.trim() || null;
      // Invalidation above is immediate. Delay only idle snapshot/hash/storage
      // preparation so ordinary typing does not lock the server row per key.
      timer = setTimeout(() => {
        if (!current()) return;
        void prepareCreditReduction({
          actorId,
          clubId,
          targetUserId: props.targetUserId,
          amount,
          reason,
          isCurrent: current,
          receiptViewCurrent: receiptCurrent,
        })
          .then((value) => {
            if (current()) setPrepared({ token: formToken, value });
          })
          .catch((err) => {
            if (current()) setPreparationError(safeErrorMessage(err));
          });
      }, 300);
    } catch (err) {
      if (current()) setPreparationError(safeErrorMessage(err));
    }
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formToken, receiptCurrent, actorId, clubId]);
  const canStart =
    props.enabled &&
    !working &&
    prepared?.token === formToken &&
    receiptCurrent() &&
    props.getRevision() === props.revision;
  const showResult = (value: Readonly<CreditReductionEnvelope>) => {
    if (!receiptCurrent()) return;
    setReceipt({ scope: receiptCurrent, value });
    setRefresh((value) => value + 1);
  };
  const rows = pendingRows?.scope() ? pendingRows.rows : [];
  const result = receipt?.scope() ? receipt.value : null;
  return (
    <div aria-label="Credit Reduction Recovery">
      {props.enabled && (
        <>
          {preparationError && <p role="alert">{preparationError}</p>}
          <div className="arena-switch arena-ops-primary">
            <button
              type="button"
              disabled={!canStart}
              onClick={async () => {
                if (!canStart || !prepared || busy.current) return;
                busy.current = true;
                setWorking(true);
                setError(null);
                try {
                  // Capture before any wait. A capture refusal is shown without dispatching.
                  const start = captureCreditReduction(prepared.value);
                  const value = await CreditService.lowerCreditLine(start);
                  assertCreditReductionCurrent(start);
                  showResult(value);
                } catch (err) {
                  if (receiptCurrent()) {
                    setError(safeErrorMessage(err));
                    setRefresh((value) => value + 1);
                  }
                } finally {
                  busy.current = false;
                  if (receiptCurrent()) setWorking(false);
                }
              }}
            >
              {working ? 'Checking Credit Change...' : 'Reduce Credit Line'}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {rows.length > 0 && (
        <div aria-label="Pending Credit Changes">
          <p>
            A Pending Credit Change Must Be Checked Or Cancelled Before Another Change For That
            Agent.
          </p>
          {rows.map((row, index) => (
            <div key={row.operationId}>
              <span>Pending Credit Change {index + 1}</span>
              <div className="arena-switch arena-ops-keys">
                {(['check', 'cancel'] as const).map((action) => (
                  <button
                    key={action}
                    disabled={working}
                    onClick={async () => {
                      if (busy.current || !receiptCurrent()) return;
                      busy.current = true;
                      setWorking(true);
                      setError(null);
                      try {
                        const start = capturePendingCreditReduction(row);
                        const value =
                          action === 'check'
                            ? await recoverCreditReduction(start)
                            : await retireCreditReduction(start);
                        assertCreditReductionCurrent(start);
                        showResult(value);
                      } catch (err) {
                        if (receiptCurrent()) setError(safeErrorMessage(err));
                      } finally {
                        busy.current = false;
                        if (receiptCurrent()) setWorking(false);
                      }
                    }}
                  >
                    {action === 'check' ? 'Check Receipt' : 'Cancel Pending Change'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {result?.state === 'recorded' && (
        <div role="status">
          <p>
            {result.receipt.outcome === 'no_change'
              ? 'No Credit Capacity Changed.'
              : `Credit Line Reduced By ${result.receipt.applied_reduction} Chips.`}
          </p>
          <p>Limit After This Change: {result.receipt.after_limit} Chips.</p>
          <p>This Is The Recorded Result Of That Change. No Chips Moved And No Payment Is Due.</p>
        </div>
      )}
      {result?.state === 'retired' && (
        <p role="status">Pending Change Cancelled. Its Original Request Cannot Apply.</p>
      )}
      {result?.state === 'absent' && (
        <p role="status">No Recorded Result Yet. This Change Remains Pending.</p>
      )}
    </div>
  );
}
