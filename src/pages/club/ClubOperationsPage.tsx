import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getClubOperationBadge,
  getClubOperationQueueTotal,
  getClubOperationGroups,
} from '../../config/clubOperationsNavigation';
import { ErrorState, LoadingState, PermissionState } from '../../components/common/EmptyState';
import { useClubNavigationAccess } from '../../hooks/useClubNavigationAccess';
import { useClubWorkspace } from '../../contexts/ClubWorkspaceContext';
import {
  mayReadClubOperationsOverview,
  useClubOperationsOverview,
} from '../../hooks/useClubOperationsOverview';
import { roleLabel } from '../../types/clubRoles';
import { formatInt } from '../../utils/clubDashboard';
import { compactChips } from '../../utils/format';
import { titleCase } from '../../utils/titleCase';
import PageBar from '../../components/help/PageBar';
import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import { ArenaReadings, ArenaRow, type ArenaTone } from '../../components/ops/ArenaOps';
import '../../components/lobby/ArenaWorkspace.css';
import '../../components/ops/ArenaOps.css';
import { freshnessLabel } from '../../utils/clubOperationsFreshness';
import styles from './ClubOperationsPage.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FRESHNESS_TICK_MS = 15_000;

export { ago, freshnessLabel } from '../../utils/clubOperationsFreshness';

/* The skeleton reserves the strip as empty chrome meters while the first read
   is in flight, so the page does not jump when the numbers land. */
const SKELETON = [0, 1, 2, 3, 4, 5].map((slot) => ({ id: `slot-${slot}`, label: '', value: '' }));

const ALERT_TONE: Record<string, ArenaTone> = {
  critical: 'danger',
  warning: 'attention',
  info: 'live',
};

interface Tile {
  id: string;
  label: string;
  value: string;
  sub?: string;
}

export default function ClubOperationsPage() {
  const { clubId = '' } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const access = useClubNavigationAccess(clubId);
  const workspace = useClubWorkspace();

  /* The overview RPC takes a uuid. The workspace has already resolved this
     route's club, so use its answer; a uuid typed straight into the URL is
     accepted as itself. Anything else stays null and the page renders its
     tools without live readings rather than sending a slug to a uuid
     argument - the defect that left the whole Anti-Cheat page reading zero. */
  const clubUUID = useMemo(() => {
    if (workspace.clubUUID && (clubId === workspace.routeClubId || clubId === workspace.clubUUID)) {
      return workspace.clubUUID;
    }
    return UUID.test(clubId) ? clubId : null;
  }, [clubId, workspace.clubUUID, workspace.routeClubId]);

  /* Only ask for a reading the viewer is entitled to. The RPC refuses a
     non-staff caller anyway, but firing it to be told no is a wasted round
     trip and a misleading `club_capability_denied` in the telemetry. */
  const {
    overview,
    loading: overviewLoading,
    error: overviewError,
    denied: overviewDenied,
    refreshedAt,
    refresh,
  } = useClubOperationsOverview(mayReadClubOperationsOverview(access) ? clubUUID : null);
  /* A settled role the RPC refuses (agent, super agent, manager) is told so
     on screen, the same words a refusal from the database would produce,
     instead of waiting on a reading that is never asked for (2026-11-26). */
  const readingsDenied =
    overviewDenied || (!access.loading && !access.error && !access.canControlClub);

  /* The freshness line is a relative time, so it has to be re-rendered by
     something other than the next read or it silently ages on screen. */
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const groups = useMemo(
    () => (access.isClubStaff ? getClubOperationGroups(clubId, access) : []),
    [access, clubId]
  );

  const toolPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const item of group.items) map.set(item.id, item.path);
    }
    return map;
  }, [groups]);

  const tiles = useMemo<Tile[]>(() => {
    if (!overview) return [];
    const k = overview.kpis;
    const list: Tile[] = [
      {
        id: 'members',
        label: 'Members',
        value: formatInt(k.members),
        sub: `${formatInt(k.members_new_7d)} Joined This Week`,
      },
      { id: 'online', label: 'Online Now', value: formatInt(k.online_now) },
      {
        id: 'seated',
        label: 'Players Seated',
        value: formatInt(k.seated_now),
        sub: 'Counted As People, Not Seats',
      },
      {
        id: 'tables',
        label: 'Live Tables',
        value: formatInt(k.live_tables),
        sub: `${formatInt(k.running_tables)} Running, ${formatInt(k.waiting_tables)} Waiting`,
      },
      {
        id: 'tournaments',
        label: 'Tournaments',
        value: formatInt(k.tournaments_registering + k.tournaments_running),
        sub: `${formatInt(k.tournaments_registering)} Registering`,
      },
      { id: 'hands', label: 'Hands Today', value: formatInt(k.hands_today) },
    ];
    if (access.canViewFinance && typeof k.rake_today === 'number') {
      list.push({ id: 'rake', label: 'Cash Rake Today', value: compactChips(k.rake_today) });
    }
    if (access.canViewFinance && typeof k.club_bank === 'number') {
      list.push({
        id: 'bank',
        label: 'Club Bank',
        value: compactChips(k.club_bank),
        sub:
          typeof k.member_chips === 'number'
            ? `${compactChips(k.member_chips)} In Member Wallets`
            : undefined,
      });
    }
    return list;
  }, [overview, access.canViewFinance]);

  if (access.loading) {
    return <LoadingState message="Authorizing Club Operations" />;
  }

  if (access.error) {
    return <ErrorState message={access.error} onRetry={access.reload} />;
  }

  if (!access.isClubStaff) {
    return (
      <PermissionState
        title="Club Operations Is Restricted"
        description="This Workspace Is Available To Club Owners, Administrators, And Authorized Agent Staff."
        onBack={() => navigate(`/clubs/${clubId}`)}
      />
    );
  }

  const accessLabel = access.isPlatformStaff ? 'Platform Staff' : roleLabel(access.clubRole);
  const alerts = (overview?.alerts ?? []).filter((alert) => toolPath.has(alert.tool));
  const counts = overview?.counts ?? null;

  return (
    <div className={`arena-workspace ${styles.page}`}>
      <ArenaWorkspaceHeader
        area="operations"
        title="Club Operations"
        context={overview?.club.name || null}
      />
      <PageBar
        title="Club Operations"
        titleAs={false}
        showHelp={false}
        metrics={[{ label: 'Access', value: accessLabel }]}
      />
      <section className="arena-case arena-ops-case" aria-label="Club Readings">
        <div className="arena-switch arena-ops-keys">
          <button type="button" onClick={() => navigate(`/clubs/${clubId}`)}>
            Open Club Lobby
          </button>
          <button type="button" onClick={() => navigate(`/clubs/${clubId}/dashboard-full`)}>
            View Dashboard
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={overviewLoading || readingsDenied || !clubUUID}
            aria-label="Refresh Club Readings"
          >
            {overviewLoading ? 'Reading' : 'Refresh'}
          </button>
        </div>
        <p className="arena-ops-live" role="status">
          {freshnessLabel({
            error: !!overviewError,
            denied: readingsDenied,
            loading: overviewLoading,
            refreshedAt,
            now: tick,
          })}
        </p>

        {tiles.length === 0 && overviewLoading && (
          <ArenaReadings readings={SKELETON} label="Reading The Club" busy />
        )}

        {tiles.length > 0 && <ArenaReadings readings={tiles} label="Live Club Readings" />}
      </section>

      {alerts.length > 0 && (
        <section
          className="arena-case arena-ops-case"
          aria-label="Work Waiting In This Club"
          aria-live="polite"
        >
          <h2 className="arena-section-title">Waiting For You</h2>
          <ul className="arena-ops-rows arena-ops-rows--single">
            {alerts.map((alert) => {
              const destination =
                alert.tool === 'players' && access.canControlClub
                  ? toolPath.get('applicants')
                  : toolPath.get(alert.tool);
              return (
                <li key={alert.id}>
                  <ArenaRow
                    to={destination}
                    title={titleCase(alert.title)}
                    signal={alert.count > 0 ? formatInt(alert.count) : undefined}
                    signalTone={ALERT_TONE[alert.severity]}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className={styles.groups}>
        {groups.map((group) => {
          const groupTotal = counts ? getClubOperationQueueTotal(group.items, counts) : 0;
          return (
            <section
              className="arena-case arena-ops-case"
              key={group.id}
              aria-labelledby={`ops-${group.id}`}
            >
              <p className="arena-ops-eyebrow">{group.eyebrow}</p>
              <h2 id={`ops-${group.id}`} className="arena-section-title">
                {group.label}
                {groupTotal > 0 && <small>{formatInt(groupTotal)} Waiting</small>}
              </h2>
              <p className="arena-ops-copy">{group.description}</p>
              <ul className={styles.toolGrid}>
                {group.items.map((item) => {
                  const descriptionId = `ops-${item.id}-description`;
                  /* A row shows its OWN queue. The group heading above carries
                     the rollup, so passing no scope here keeps the same number
                     from appearing three times in one group. */
                  const signal = getClubOperationBadge(item, counts);
                  return (
                    <li key={item.id}>
                      <ArenaRow
                        to={item.path}
                        aria-describedby={descriptionId}
                        title={item.label}
                        line={item.description}
                        lineId={descriptionId}
                        signal={signal > 0 ? formatInt(signal) : undefined}
                        signalTone="attention"
                        signalLabel={`${signal} Waiting`}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
