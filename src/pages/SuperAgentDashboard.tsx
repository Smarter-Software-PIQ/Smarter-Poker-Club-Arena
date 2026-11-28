/**
 * SUPER AGENT DASHBOARD - Agent Network Management with Live Updates
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useIsMounted } from '../hooks/useIsMounted';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { masterBus } from '../core/MasterBus';
import { AgentService } from '../services/AgentService';
import type { Agent, AgentPlayer } from '../services/AgentService';
import { CommissionService } from '../services/CommissionService';
import type { CommissionSpread } from '../services/CommissionService';
import { useAuthUser } from '../hooks/useAuthUser';
import { useProfilePresence } from '../hooks/useProfilePresence';
import { useToast } from '../components/common/Toast';
import { fmt, formatWalletChips } from '../utils/format';
import {
  clubBankRecipientWallets,
  clubBankDestinationFor,
  type ClubBankRecipientWallet,
} from '../components/wallet/cashierModes';

/* The three agent roles, spelled the way an operator reads them. This list
   used to print the raw enum - a person saw "super_agent" where every other
   surface in the app says "Super Agent". */
const AGENT_ROLE_LABELS: Record<string, string> = {
  super_agent: 'Super Agent',
  agent: 'Agent',
  sub_agent: 'Sub-Agent',
};
import CreditRequestWidget from '../components/agent/CreditRequestWidget';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import { ArenaReadings, ArenaRow, ArenaState } from '../components/ops/ArenaOps';
import { useArenaClubName } from '../components/ops/useArenaClubName';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';
import { resolveClubUUID } from '../utils/clubIdResolver';
import { SEND_DESTINATION_LABELS } from '../utils/cashierSendWallets';
import { useRecipientWalletBalances, walletOptionLabel } from '../hooks/useRecipientWalletBalances';
import '../components/ops/ArenaOps.css';
import './SuperAgentDashboard.css';
import { reportError } from '../utils/errorReporter';
import { platformFrozenMessage } from '../utils/platformFrozen';
import AgentBackOffice from '../components/agent/AgentBackOffice';

type DashboardTab = 'overview' | 'agents' | 'players' | 'commissions' | 'transfers' | 'backoffice';

export default function SuperAgentDashboard() {
  const { clubId } = useParams();
  const { user, isHydrating } = useAuthUser();
  if (isHydrating)
    return (
      <div className="arena-workspace super-agent-dashboard">
        <ArenaState tone="loading" title="Loading" />
      </div>
    );
  if (!user?.id || !clubId)
    return (
      <div className="arena-workspace super-agent-dashboard">
        <ArenaState tone="empty" title="Sign In And Select A Club To Open Your Agent Dashboard." />
      </div>
    );
  // A different account or route owns a different component and every pending
  // read/action belonging to the old surface loses permission to update it.
  return (
    <SuperAgentDashboardForScope
      key={JSON.stringify([user.id, clubId])}
      userId={user.id}
      clubId={clubId}
    />
  );
}

function SuperAgentDashboardForScope({ userId, clubId }: { userId: string; clubId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isMounted = useIsMounted();
  useVisibilityRefresh(() => {
    loadDashboardData();
  });

  const clubName = useArenaClubName();
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [creditApproverUserId, setCreditApproverUserId] = useState<string | undefined>();
  const [canReviewCredit, setCanReviewCredit] = useState(false);
  const [subAgents, setSubAgents] = useState<Agent[]>([]);
  const [players, setPlayers] = useState<AgentPlayer[]>([]);
  // Re-asked every minute while shown, so a dot goes dark when its heartbeat does.
  const livePresence = useProfilePresence(players.map((p) => p.userId));
  const [spread, setSpread] = useState<CommissionSpread | null>(null);
  const [loading, setLoading] = useState(true);
  /* Told apart from "you hold no agency here": see the catch in the loader. */
  const [loadFailed, setLoadFailed] = useState(false);

  const [transferPlayerId, setTransferPlayerId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferWallet, setTransferWallet] = useState<ClubBankRecipientWallet | null>(null);
  const transferRecipient = players.find((player) => player.userId === transferPlayerId);
  const transferWallets = transferRecipient ? clubBankRecipientWallets(transferRecipient.role) : [];
  const transferDestination = transferRecipient
    ? clubBankDestinationFor(transferRecipient.role, transferWallet)
    : 'player_wallet';
  useEffect(() => setTransferWallet(null), [transferPlayerId]);
  // Every wallet the recipient holds, with its current balance (Dan 2026-10-15).
  const [transferBalanceRefresh, setTransferBalanceRefresh] = useState(0);
  const transferBalances = useRecipientWalletBalances(
    clubId,
    transferRecipient?.userId,
    transferBalanceRefresh
  );
  // The rakeback this agent gives their own players (Dan, 2026-10-15: "THE
  // AGENT ASSIGNS WHAT THEY WANT TO GIVE THEIR PLAYERS"). Blank until they type;
  // the saved figure is shown beside it.
  const [playerRakebackInput, setPlayerRakebackInput] = useState('');
  const [savingPlayerRakeback, setSavingPlayerRakeback] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const transferInFlight = useRef(false);
  const [visibleStatCards, setVisibleStatCards] = useState(new Set<number>());
  const [visibleAgentRows, setVisibleAgentRows] = useState(new Set<number>());
  const [visiblePlayerRows, setVisiblePlayerRows] = useState(new Set<number>());

  // Stagger stat cards on mount
  useEffect(() => {
    const timers = [0, 1, 2, 3].map((i) =>
      setTimeout(() => setVisibleStatCards((prev) => new Set([...prev, i])), i * 60)
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // Stagger agent rows
  useEffect(() => {
    setVisibleAgentRows(new Set());
    const timers = subAgents.map((_, i) =>
      setTimeout(() => setVisibleAgentRows((prev) => new Set([...prev, i])), i * 50)
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [subAgents.length]);

  // Stagger player rows
  useEffect(() => {
    setVisiblePlayerRows(new Set());
    const timers = players.map((_, i) =>
      setTimeout(() => setVisiblePlayerRows((prev) => new Set([...prev, i])), i * 40)
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [players.length]);

  useEffect(() => {
    if (clubId && userId) {
      loadDashboardData();

      // Real-time updates for agent activity
      let isMounted = true;
      let acquiredChannel: ReturnType<typeof masterBus.getOrCreateChannel> | null = null;
      const channelKey = `super-agent-live:${userId}:${clubId}`;

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
              table: 'club_members',
              filter: `club_id=eq.${resolvedId}`,
            },
            () => loadDashboardData()
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'chip_transactions',
              // DB LOAD PASS 2026-08-24: this had no filter, so every chip
              // movement anywhere on the platform was decoded and delivered to
              // every open super-agent dashboard, which then reloaded a view
              // that only ever shows THIS club. chip_transactions carries
              // club_id - scope to it, and do not widen it again.
              filter: `club_id=eq.${resolvedId}`,
            },
            () => loadDashboardData()
          )
          .subscribe((status: string, err?: Error) => {
            if (status === 'CHANNEL_ERROR') {
              if (err)
                reportError(err?.message || err, 'SuperAgentDashboard._Realtime_channel_error');
            }
            if (status === 'TIMED_OUT') {
              console.warn('[SuperAgentDashboard] Realtime channel timed out');
            }
          });
      };

      masterBus.registerChannelFactory?.(channelKey, () => {
        if (isMounted) void setupRealtime();
      });
      setupRealtime().catch((e) => console.warn('[SuperAgentDashboard] Realtime setup failed:', e));

      return () => {
        isMounted = false;
        masterBus.removeChannelFactory?.(channelKey);
        if (acquiredChannel) {
          masterBus.removeRegisteredChannel(channelKey, acquiredChannel);
        }
      };
    }
  }, [clubId, userId]);

  // Bus event listeners for cross-component sync (debounced to prevent rapid-fire reloads)
  useEffect(() => {
    if (!clubId || !userId) return;
    const unsubWallet = masterBus.subscribeDebounced(
      'WALLET_REFRESHED',
      () => {
        loadDashboardData();
      },
      300
    );
    const unsubBalance = masterBus.subscribeDebounced(
      'BALANCE_UPDATED',
      () => {
        loadDashboardData();
      },
      300
    );
    // Phase 4: Cross-page sync events (ported from World Hub agent-dashboard.js)
    const unsubCashoutApproved = masterBus.subscribeDebounced(
      'CASHOUT_APPROVED',
      () => loadDashboardData(),
      300
    );
    const unsubCashoutCancelled = masterBus.subscribeDebounced(
      'CASHOUT_CANCELLED',
      () => loadDashboardData(),
      300
    );
    const unsubCashoutReq = masterBus.subscribeDebounced(
      'CASHOUT_REQUESTED',
      () => loadDashboardData(),
      300
    );
    const unsubChips = masterBus.subscribeDebounced(
      'CHIPS_DISTRIBUTED',
      () => loadDashboardData(),
      300
    );
    const unsubAgent = masterBus.subscribeDebounced(
      'AGENT_UPDATED',
      () => loadDashboardData(),
      300
    );
    const unsubCredit = masterBus.subscribeDebounced(
      'CREDIT_UPDATED',
      () => loadDashboardData(),
      300
    );
    return () => {
      unsubWallet();
      unsubBalance();
      unsubCashoutApproved();
      unsubCashoutCancelled();
      unsubCashoutReq();
      unsubChips();
      unsubAgent();
      unsubCredit();
    };
  }, [clubId, userId]);

  const loadingRef = useRef(false);
  const loadGeneration = useRef(0);
  useEffect(() => {
    return () => {
      loadGeneration.current += 1;
      loadingRef.current = false;
    };
  }, []);

  const loadDashboardData = async () => {
    if (!isMounted.current || loadingRef.current) return;
    loadingRef.current = true;
    const generation = ++loadGeneration.current;
    const current = () => isMounted.current && generation === loadGeneration.current;
    setLoading(true);
    setLoadFailed(false);
    setCanReviewCredit(false);
    try {
      const resolvedId = await resolveClubUUID(clubId);
      if (!current()) return;
      if (!resolvedId) throw new Error('The selected club could not be resolved.');
      const [agents, club, membership] = await Promise.all([
        AgentService.getAgents(resolvedId),
        supabase.from('clubs').select('owner_id').eq('id', resolvedId).maybeSingle(),
        supabase
          .from('club_members')
          .select('role, status')
          .eq('club_id', resolvedId)
          .eq('user_id', userId)
          .maybeSingle(),
      ]);
      if (!current()) return;
      if (club.error) throw club.error;
      if (membership.error) throw membership.error;
      if (!club.data || agents.some((a) => a.clubId !== resolvedId)) {
        throw new Error('Agent club identity could not be confirmed.');
      }
      const matches = agents.filter((a) => a.userId === userId);
      if (matches.length > 1) throw new Error('More than one agent record matched this account.');
      const myAgent = matches[0];
      if (myAgent) {
        const myPlayers =
          await /* Scoped to the club being viewed. Without it this list, the player count
             beside it and the transfer picker below all showed the agent's
             players from every club they hold an agents row in - while the
             transfer itself is scoped to THIS club, so an operator could send
             to a name that does not belong here. */
          AgentService.getAgentPlayers(myAgent.id, resolvedId);
        if (!current()) return;
        const commSpread = await CommissionService.calculateSpread(myAgent.id);
        if (!current()) return;
        // Requesters cannot read their upline's private agent/membership rows.
        // Route to the current owner recorded on this exact club, which also
        // matches CreditService's shared creation route. A hierarchy ID is
        // never treated as an account or as approval authority.
        const approver = club.data.owner_id;
        setCreditApproverUserId(
          typeof approver === 'string' && approver && approver !== userId ? approver : undefined
        );
        setCanReviewCredit(
          club.data.owner_id === userId ||
            (['owner', 'co_owner', 'admin'].includes(membership.data?.role || '') &&
              ['active', 'approved'].includes(membership.data?.status || ''))
        );
        setAgent(myAgent);
        setSubAgents(agents.filter((a) => a.parentAgentId === myAgent.id));
        setPlayers(myPlayers);
        setSpread(commSpread);
      } else {
        setAgent(null);
        setCreditApproverUserId(undefined);
        setSubAgents([]);
        setPlayers([]);
        setSpread(null);
      }
    } catch (error) {
      reportError(error, 'SuperAgentDashboard.Failed_to_load_dashboard');
      /* A FAILED READ IS NOT A VERDICT ON WHO YOU ARE. `agent` stays null when
         this throws, and the empty state below renders "You Are Not An Agent
         In This Club" - an accusation, for what is usually a network blip.
         The two are separated now. */
      if (current()) {
        setAgent(null);
        setCreditApproverUserId(undefined);
        setSubAgents([]);
        setPlayers([]);
        setSpread(null);
        setLoadFailed(true);
        toast.error('Failed to load dashboard data');
      }
    } finally {
      if (current()) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  };

  const handleSavePlayerRakeback = async () => {
    if (!agent || savingPlayerRakeback) return;
    const pct = Number(playerRakebackInput);
    const maxPct = Math.min(50, (agent.commissionRate || 0) * 100);
    if (playerRakebackInput.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > maxPct) {
      toast.error(`Enter A Player Rakeback From 0 To ${maxPct.toLocaleString()} Percent.`);
      return;
    }
    setSavingPlayerRakeback(true);
    try {
      const { data, error } = await supabase.rpc('fn_agent_set_player_rakeback', {
        p_club_id: agent.clubId,
        p_rate: Math.round(pct * 100) / 10000,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Player Rakeback Was Not Saved');
      if (!isMounted.current) return;
      toast.success(`Your Players Now Receive ${pct.toLocaleString()}% Rakeback`);
      setPlayerRakebackInput('');
      await loadDashboardData();
    } catch (error) {
      reportError(error, 'SuperAgentDashboard.Set_player_rakeback');
      if (isMounted.current) {
        toast.error(error instanceof Error ? error.message : 'Player Rakeback Was Not Saved');
      }
    } finally {
      if (isMounted.current) setSavingPlayerRakeback(false);
    }
  };

  const handleTransfer = async () => {
    if (!agent || !transferRecipient || !transferAmount || transferInFlight.current) return;
    const amount = parseFloat(transferAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    transferInFlight.current = true;
    setIsTransferring(true);
    try {
      // The sender is no longer a parameter: fn_agent_wallet_send derives it
      // from auth.uid(). This used to pass agent.id - the agents-table ROW id -
      // where a user id was expected, so the transfer could never have landed.
      await AgentService.transferToPlayer(transferPlayerId, clubId!, amount, transferDestination);
      if (!isMounted.current) {
        transferInFlight.current = false;
        return;
      }
      setTransferPlayerId('');
      setTransferAmount('');
      setTransferBalanceRefresh((n) => n + 1);
      if (isMounted.current)
        toast.success(`Transferred ${amount.toLocaleString()} chips successfully`);
      loadDashboardData();
    } catch (error) {
      reportError(error, 'SuperAgentDashboard.Transfer_failed');
      // Maintenance break refusal is definitive (2026-10-16).
      if (isMounted.current) toast.error(platformFrozenMessage(error) ?? 'Transfer failed');
    }
    transferInFlight.current = false;
    if (isMounted.current) setIsTransferring(false);
  };

  const header = (
    <ArenaWorkspaceHeader
      area="operations"
      title="Agent Network"
      context={clubName}
      summary="Your Balances, Rates, Sub-Agents, Players, Commissions And Chip Sends In One Place."
    />
  );

  if (loading) {
    return (
      <div className="arena-workspace super-agent-dashboard">
        {header}
        <ArenaState tone="loading" title="Loading" message="Reading Your Agent Network" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="arena-workspace super-agent-dashboard">
        {header}
        <ArenaState
          tone={loadFailed ? 'error' : 'empty'}
          title={
            loadFailed
              ? 'Your Agent Details Could Not Be Loaded. This Is Not The Same As Holding No Agency Here.'
              : 'You Are Not An Agent In This Club'
          }
          actions={
            <button type="button" onClick={() => navigate(-1)}>
              Go Back
            </button>
          }
        />
      </div>
    );
  }

  /* The stagger still plays: each readout and row rises in on its own timer. */
  const rise = (visible: boolean) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(8px)',
    transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  });

  return (
    <div className="arena-workspace super-agent-dashboard">
      {header}
      <PageBar
        title="Agent Network"
        titleAs={false}
        showHelp={false}
        metrics={[
          { label: 'Role', value: AGENT_ROLE_LABELS[agent.role] || agent.role },
          {
            label: 'Agent Rakeback',
            value: `${((agent.commissionRate || 0) * 100).toFixed(1)}%`,
            tone: 'live',
          },
        ]}
      />

      {/* Stats */}
      <dl className="arena-ops-readings" aria-label="Agent Summary">
        <div className="arena-meter" style={rise(visibleStatCards.has(0))}>
          <dt>Total Players</dt>
          <dd>{fmt(agent.totalPlayers)}</dd>
        </div>
        <div className="arena-meter" data-tone="live" style={rise(visibleStatCards.has(1))}>
          <dt>Active Now</dt>
          <dd>{fmt(agent.activePlayerCount)}</dd>
        </div>
        <div className="arena-meter" style={rise(visibleStatCards.has(2))}>
          <dt>Sub-Agents</dt>
          <dd>{fmt(agent.subAgentCount)}</dd>
        </div>
        <div className="arena-meter" data-tone="attention" style={rise(visibleStatCards.has(3))}>
          <dt>Weekly Rake</dt>
          <dd>{agent.weeklyRakeGenerated.toLocaleString()}</dd>
        </div>
      </dl>

      {/* Tabs: one chrome switch; the open view lights blue. */}
      <nav className="arena-switch arena-ops-keys" aria-label="Agent Network Views">
        {(
          [
            'overview',
            'agents',
            'players',
            'commissions',
            'transfers',
            'backoffice',
          ] as DashboardTab[]
        ).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'backoffice' ? 'Back Office' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <>
          <section className="arena-case arena-ops-case" aria-label="Balances">
            <h2 className="arena-section-title">Balances</h2>
            <ArenaReadings
              readings={[
                {
                  id: 'business',
                  label: 'Business Balance',
                  value: formatWalletChips(agent.businessBalance),
                  tone: 'attention',
                },
                {
                  id: 'player',
                  label: 'Player Balance',
                  value: formatWalletChips(agent.playerBalance),
                  tone: 'attention',
                },
                {
                  id: 'credit',
                  label: 'Credit Line (Tracking Only)',
                  value: formatWalletChips(agent.creditLimit),
                },
              ]}
            />
          </section>
          <section className="arena-case arena-ops-case" aria-label="Your Rates">
            <h2 className="arena-section-title">Your Rates</h2>
            <ArenaReadings
              readings={[
                {
                  id: 'own',
                  label: 'Your Rakeback (Set By The Club)',
                  value: `${((agent.commissionRate || 0) * 100).toFixed(1)}%`,
                  tone: 'live',
                },
                {
                  id: 'players',
                  label: 'Rakeback You Give Your Players',
                  value: `${((agent.playerRakebackRate || 0) * 100).toFixed(1)}%`,
                  tone: 'live',
                },
              ]}
            />
            <div className="super-agent-field">
              <label htmlFor="player-rakeback-input">
                Set Your Players&apos; Rakeback (0 To{' '}
                {Math.min(50, (agent.commissionRate || 0) * 100).toLocaleString()}%)
              </label>
              <div className="super-agent-inline">
                <input
                  id="player-rakeback-input"
                  className="arena-ops-well"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={Math.min(50, (agent.commissionRate || 0) * 100)}
                  step={1}
                  placeholder={((agent.playerRakebackRate || 0) * 100).toString()}
                  value={playerRakebackInput}
                  onChange={(e) => setPlayerRakebackInput(e.target.value)}
                  disabled={savingPlayerRakeback || agent.status !== 'active'}
                />
                <div className="arena-switch arena-ops-primary">
                  <button
                    type="button"
                    onClick={() => void handleSavePlayerRakeback()}
                    disabled={
                      savingPlayerRakeback ||
                      agent.status !== 'active' ||
                      playerRakebackInput.trim() === ''
                    }
                  >
                    {savingPlayerRakeback ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              <p className="arena-ops-copy">
                Paid Out Of Your Own Rakeback, So It Cannot Be Higher Than Your Rate.
              </p>
            </div>
          </section>
          {/* Credit Request Widget */}
          <section className="arena-case arena-ops-case" aria-label="Credit">
            <h2 className="arena-section-title">Credit</h2>
            <CreditRequestWidget
              userId={userId}
              clubId={agent.clubId}
              approverUserId={creditApproverUserId}
              canRequest={agent.status === 'active'}
              canReview={canReviewCredit}
              currentCreditLimit={agent.creditLimit}
              currentCreditUsed={agent.creditUsed}
            />
          </section>
        </>
      )}

      {activeTab === 'agents' && (
        <section className="arena-case arena-ops-case" aria-label="Your Sub-Agents">
          <h2 className="arena-section-title">
            Your Sub-Agents<small>{fmt(subAgents.length)}</small>
          </h2>
          {subAgents.length === 0 ? (
            <ArenaState tone="empty" title="No Sub-Agents Yet" />
          ) : (
            <ul className="arena-ops-rows">
              {subAgents.map((sub, index) => (
                <li key={sub.id} style={rise(visibleAgentRows.has(index))}>
                  <ArenaRow
                    title={sub.displayName || 'Agent'}
                    line={`${AGENT_ROLE_LABELS[sub.role] || sub.role} - ${fmt(sub.totalPlayers)} Players`}
                    signal={sub.weeklyRakeGenerated.toLocaleString()}
                    signalTone="attention"
                    signalLabel="Weekly Rake"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'players' && (
        <section className="arena-case arena-ops-case" aria-label="Your Players">
          <h2 className="arena-section-title">
            Your Players<small>{fmt(players.length)}</small>
          </h2>
          {players.length === 0 ? (
            <ArenaState tone="empty" title="No Players Yet" />
          ) : (
            <ul className="arena-ops-rows">
              {players.map((player, index) => (
                <li
                  key={player.id}
                  className="arena-ledger-row super-agent-player"
                  style={rise(visiblePlayerRows.has(index))}
                >
                  <span className="super-agent-avatar">
                    {player.avatarUrl ? (
                      <img src={player.avatarUrl} alt="" loading="lazy" />
                    ) : (
                      <span>{(player.displayName || 'P')[0].toUpperCase()}</span>
                    )}
                    {(livePresence.get(player.userId) ?? player.isOnline) && (
                      <span className="super-agent-online" />
                    )}
                  </span>
                  <span className="arena-ops-row__copy">
                    <strong>{player.displayName}</strong>
                    <small>{((player.rakebackPercent || 0) * 100).toFixed(1)}% Rakeback</small>
                  </span>
                  <span className="arena-ops-row__signal" data-tone="attention">
                    {formatWalletChips(player.chipBalance ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'commissions' && spread && (
        <section className="arena-case arena-ops-case" aria-label="Commission Breakdown">
          <h2 className="arena-section-title">Commission Breakdown</h2>
          <ArenaReadings
            readings={[
              {
                id: 'gross',
                label: 'Gross Commission Rate',
                value: `${((spread.grossCommissionRate || 0) * 100).toFixed(1)}%`,
              },
              {
                id: 'downlines',
                label: 'Paid To Downlines',
                value: `-${spread.payoutToDownlines.toLocaleString()}`,
                tone: 'danger',
              },
              {
                id: 'net',
                label: 'Net Margin',
                value: spread.netMargin.toLocaleString(),
                tone: 'attention',
              },
            ]}
          />
        </section>
      )}

      {activeTab === 'transfers' && (
        <section className="arena-case arena-ops-case" aria-label="Send Chips">
          <h2 className="arena-section-title">Send Chips</h2>
          <div className="super-agent-field">
            <label htmlFor="super-agent-recipient">Select Recipient</label>
            <select
              id="super-agent-recipient"
              className="arena-ops-well"
              value={transferPlayerId}
              onChange={(e) => setTransferPlayerId(e.target.value)}
            >
              <option value="">Choose Recipient...</option>
              {players.map((p) => (
                <option key={p.id} value={p.userId}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
          {transferRecipient && (
            <div className="super-agent-field">
              <label htmlFor="super-agent-recipient-wallet">Recipient Wallet</label>
              <select
                id="super-agent-recipient-wallet"
                className="arena-ops-well"
                value={transferDestination}
                disabled={isTransferring}
                onChange={(event) =>
                  setTransferWallet(event.target.value as ClubBankRecipientWallet)
                }
              >
                {transferWallets.map((wallet) => (
                  <option key={wallet} value={wallet}>
                    {walletOptionLabel(SEND_DESTINATION_LABELS[wallet], transferBalances, wallet)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="super-agent-field">
            <label htmlFor="super-agent-amount">Amount</label>
            <input
              id="super-agent-amount"
              className="arena-ops-well"
              type="number"
              placeholder="0.00"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
            />
          </div>
          <div className="arena-switch arena-ops-primary">
            <button
              type="button"
              onClick={handleTransfer}
              disabled={isTransferring || !transferRecipient || !transferAmount}
            >
              {isTransferring ? 'Sending...' : 'Send Chips'}
            </button>
          </div>
        </section>
      )}

      {activeTab === 'backoffice' && (
        <section className="arena-case arena-ops-case" aria-label="Back Office">
          <AgentBackOffice />
        </section>
      )}
    </div>
  );
}
