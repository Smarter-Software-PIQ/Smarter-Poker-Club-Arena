/**
 * CLUB BOMB POT REPORT (2026-08-29)
 * ============================================================================
 * The club staff's view of their own bomb pots: which tables run them, under
 * which trigger, how many players each one pulls in, how much forced money it
 * moves, and how often somebody scoops.
 *
 * WHY THIS PAGE EXISTS. The platform already had three bomb-pot views
 * (v_bomb_pot_daily, v_bomb_pot_vs_normal, v_bomb_pot_outcomes) and not one of
 * them carries club_id or table_id - they aggregate across the WHOLE platform.
 * They were operator views wearing a club-analytics label, no UI read any of
 * them, and until 2026-08-29 they were readable by anon into the bargain. A
 * club owner could not answer the first question anybody asks about a forced
 * ante: is it bringing players to my tables or driving them away.
 *
 * Data: fn_club_bomb_pot_report_v2 - SECURITY DEFINER, gated server-side on the
 * same owner / co_owner / admin test fn_request_manual_bomb_pot uses, raising
 * ERRCODE 42501 like its siblings. The client gate below is cosmetic.
 *
 * `unrecorded_hands` is deliberately on the face of the page rather than
 * buried: it is the count of bomb hands with no award-unit rows, which is the
 * same hole fn_bomb_pot_ledger_gaps reports to reconcile_ledger_nightly. A
 * non-zero number there means this report is reading an incomplete ledger, and
 * the owner should be told that rather than shown a total that looks whole.
 *
 * #SmarterDesign (Dan 2026-11-27): the painted console is gone. The page
 * wears the arena workspace: the finance mast with the club's name, the
 * headline figures as chrome meters, the window as a chrome switch that lights
 * the selected window, the six totals as chrome readouts and every table as a
 * chrome ledger row. Every read, guard and pinned literal is kept.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { isAuthzError } from '../../utils/clubDashboard';
import { reportError } from '../../utils/errorReporter';
import { downloadCsv, csvEscape } from '../../utils/downloadCsv';
import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../../components/help/PageBar';
import { useArenaClubName } from '../../components/ops/useArenaClubName';
import { ArenaReadings, ArenaState } from '../../components/ops/ArenaOps';
import { compactChips } from '../../utils/format';
import { titleCase } from '../../utils/titleCase';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useAuthUser } from '../../hooks/useAuthUser';
import { useToast } from '../../components/common/Toast';
import styles from './ClubBombPotReportPage.module.css';
import { chipCents } from '../../utils/cashierAmount';

interface ReportRow {
  table_id: string;
  table_name: string | null;
  trigger_reason: string | null;
  board_count: number | null;
  variant: string | null;
  hands: number;
  avg_players: number | null;
  avg_pot: number | null;
  total_pot: number | null;
  total_rake: number | null;
  total_antes: number | null;
  scoops: number;
  splits: number;
  unrecorded_hands: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const BOMB_POT_REPORT_CONTRACT = 'fn_club_bomb_pot_report.v2';
const BOMB_POT_DATA_BASIS =
  'Totals Cover Saved Reports And Retained Hands. Older Unsaved Activity May Be Unavailable.';
const UUID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reportText(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Bomb pot report ${label} is invalid`);
  }
  return value;
}

function reportCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Bomb pot report ${label} is invalid`);
  }
  return value as number;
}

function reportAmount(value: unknown, label: string, nullable = false): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Bomb pot report ${label} is invalid`);
  }
  return value;
}

/** A successful RPC response is still untrusted until every row is safe to
 * total, paint and export. */
export function parseClubBombPotReport(
  value: unknown,
  expectedClubId: string,
  expectedDays: number
): ReportRow[] {
  if (!isRecord(value)) throw new Error('Bomb pot report response is invalid');
  if (
    !UUID_TOKEN.test(expectedClubId) ||
    value.contract !== BOMB_POT_REPORT_CONTRACT ||
    value.contract_version !== 2 ||
    value.club_id !== expectedClubId ||
    value.requested_days !== expectedDays ||
    value.window_days !== expectedDays
  ) {
    throw new Error('Bomb pot report scope receipt is invalid');
  }
  const windowStart = reportText(value.window_start, 'window start') as string;
  const windowEnd = reportText(value.window_end, 'window end') as string;
  const startMs = Date.parse(`${windowStart}T00:00:00.000Z`);
  const endMs = Date.parse(`${windowEnd}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(windowStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(windowEnd) ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    new Date(startMs).toISOString().slice(0, 10) !== windowStart ||
    new Date(endMs).toISOString().slice(0, 10) !== windowEnd ||
    (endMs - startMs) / 86_400_000 !== expectedDays - 1 ||
    typeof value.generated_at !== 'string' ||
    !Number.isFinite(Date.parse(value.generated_at)) ||
    !Array.isArray(value.rows)
  ) {
    throw new Error('Bomb pot report window receipt is invalid');
  }
  const identities = new Set<string>();
  return value.rows.map((candidate) => {
    if (!isRecord(candidate)) throw new Error('Bomb pot report row is invalid');
    const tableId = reportText(candidate.table_id, 'table identity') as string;
    if (!UUID_TOKEN.test(tableId)) throw new Error('Bomb pot report table identity is invalid');
    const tableName = reportText(candidate.table_name, 'table name', true);
    const triggerReason = reportText(candidate.trigger_reason, 'trigger', true);
    const variant = reportText(candidate.variant, 'variant', true);
    const boardCount =
      candidate.board_count === null ? null : reportCount(candidate.board_count, 'board count');
    if (boardCount !== null && boardCount < 1) {
      throw new Error('Bomb pot report board count is invalid');
    }
    const hands = reportCount(candidate.hands, 'hand count');
    const scoops = reportCount(candidate.scoops, 'scoop count');
    const splits = reportCount(candidate.splits, 'split count');
    const unrecordedHands = reportCount(candidate.unrecorded_hands, 'unrecorded count');
    if (scoops + splits + unrecordedHands !== hands) {
      throw new Error('Bomb pot report outcomes do not reconcile');
    }
    const identity = JSON.stringify([tableId, triggerReason, boardCount, variant]);
    if (identities.has(identity)) throw new Error('Bomb pot report row is duplicated');
    identities.add(identity);
    return {
      table_id: tableId,
      table_name: tableName,
      trigger_reason: triggerReason,
      board_count: boardCount,
      variant,
      hands,
      avg_players: reportAmount(candidate.avg_players, 'average players', true),
      avg_pot: reportAmount(candidate.avg_pot, 'average pot', true),
      total_pot: reportAmount(candidate.total_pot, 'total pot', true),
      total_rake: reportAmount(candidate.total_rake, 'total rake', true),
      total_antes: reportAmount(candidate.total_antes, 'total antes', true),
      scoops,
      splits,
      unrecorded_hands: unrecordedHands,
    };
  });
}

const WINDOWS = [7, 30, 90] as const;

interface ReportSnapshot {
  scope: string;
  rows: ReportRow[];
}

interface ReportRequestState {
  scope: string;
  loading: boolean;
  denied: boolean;
  notFound: boolean;
  error: string | null;
}

/* Report money is forward-facing and reads compact (Dan: no decimals, 1.2K
   past a thousand). The CSV below still carries the exact figures. */
const chips = (n: number | null | undefined) => compactChips(Number(n ?? 0));

const SUMMARY =
  'Read Which Tables Run Bomb Pots, How Many Players Each One Pulls In, The Forced Money It Moves And How Often Somebody Scoops.';

/**
 * The four trigger values are DB enums. The lobby maps them to English and the
 * replay does too; a report is no place to print `every_n_hands` at a club
 * owner either.
 */
const TRIGGER_LABEL: Record<string, string> = {
  every_n_hands: 'Scheduled',
  once_per_orbit: 'Every Orbit',
  timed: 'On The Clock',
  bomb_pot_only: 'Bomb Pot Table',
  manual_next_hand: 'Called By The Host',
};

const triggerLabel = (t: string | null) =>
  (t && TRIGGER_LABEL[t]) || (t ? titleCase(t.replace(/_/g, ' ')) : 'Unknown');

const boardLabel = (n: number | null) => (n && n >= 2 ? `${n} Boards` : '1 Board');

export default function ClubBombPotReportPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const mastName = useArenaClubName();
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const toast = useToast();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const scopeKey = `${user?.id ?? 'signed-out'}:${clubId ?? ''}:${days}`;
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [requestState, setRequestState] = useState<ReportRequestState>({
    scope: scopeKey,
    loading: true,
    denied: false,
    notFound: false,
    error: null,
  });
  const isMounted = useIsMounted();
  const requestVersionRef = useRef(0);
  const inFlightRef = useRef<{ scope: string; requestId: number } | null>(null);
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;

  const rows = snapshot?.scope === scopeKey ? snapshot.rows : null;
  const stateForScope: ReportRequestState =
    requestState.scope === scopeKey
      ? requestState
      : { scope: scopeKey, loading: true, denied: false, notFound: false, error: null };
  const { loading, denied, notFound, error } = stateForScope;

  const load = useCallback(async () => {
    if (!clubId) return;
    const requestScope = scopeKey;
    if (inFlightRef.current?.scope === requestScope) return;
    const requestId = ++requestVersionRef.current;
    inFlightRef.current = { scope: requestScope, requestId };
    const isCurrent = () =>
      isMounted.current &&
      activeScopeRef.current === requestScope &&
      requestVersionRef.current === requestId;

    setRequestState({
      scope: requestScope,
      loading: true,
      denied: false,
      notFound: false,
      error: null,
    });
    // The route carries the club's SLUG (clubs/deep-stack-society-11192/...)
    // and this handed it to a uuid argument, so on every slug URL the RPC
    // answered 22P02 and the page said "Could Not Load". Resolve first, and
    // name a club that does not exist as one.
    try {
      let resolved: string;
      try {
        const { resolveClubUUIDStrict } = await import('../../utils/strictClubIdResolver');
        resolved = await resolveClubUUIDStrict(clubId);
      } catch (e) {
        if (!isCurrent()) return;
        setSnapshot(null);
        if ((e as { name?: string } | null)?.name === 'ClubNotFoundError') {
          setRequestState((current) =>
            current.scope === requestScope ? { ...current, notFound: true } : current
          );
        } else {
          reportError(e, 'ClubBombPotReportPage.Resolve_failed');
          setRequestState((current) =>
            current.scope === requestScope
              ? { ...current, error: 'The Club Could Not Be Resolved' }
              : current
          );
        }
        return;
      }

      if (!isCurrent()) return;
      const { data, error: rpcError } = await supabase.rpc('fn_club_bomb_pot_report_v2', {
        p_club_id: resolved,
        p_days: days,
      });
      if (!isCurrent()) return;
      if (rpcError) {
        setSnapshot(null);
        if (isAuthzError(rpcError)) {
          setRequestState((current) =>
            current.scope === requestScope ? { ...current, denied: true } : current
          );
        } else {
          reportError(rpcError, 'ClubBombPotReportPage.Load_failed');
          setRequestState((current) =>
            current.scope === requestScope
              ? { ...current, error: 'Could Not Load The Bomb Pot Report' }
              : current
          );
        }
      } else {
        setSnapshot({
          scope: requestScope,
          rows: parseClubBombPotReport(data, resolved, days),
        });
      }
    } catch (e) {
      if (!isCurrent()) return;
      reportError(e, 'ClubBombPotReportPage.Load_failed');
      setSnapshot(null);
      setRequestState((current) =>
        current.scope === requestScope
          ? { ...current, error: 'Could Not Load The Bomb Pot Report' }
          : current
      );
    } finally {
      if (inFlightRef.current?.requestId === requestId) inFlightRef.current = null;
      if (isCurrent()) {
        setRequestState((current) =>
          current.scope === requestScope ? { ...current, loading: false } : current
        );
      }
    }
  }, [clubId, days, isMounted, scopeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const r = rows ?? [];
    const hands = r.reduce((s, x) => s + Number(x.hands ?? 0), 0);
    const scoops = r.reduce((s, x) => s + Number(x.scoops ?? 0), 0);
    const splits = r.reduce((s, x) => s + Number(x.splits ?? 0), 0);
    const antes = chipCents(r.reduce((s, x) => s + Number(x.total_antes ?? 0), 0));
    const rake = chipCents(r.reduce((s, x) => s + Number(x.total_rake ?? 0), 0));
    const pot = chipCents(r.reduce((s, x) => s + Number(x.total_pot ?? 0), 0));
    const unrecorded = r.reduce((s, x) => s + Number(x.unrecorded_hands ?? 0), 0);
    // Weighted by hands, so a table that ran three bombs does not count as
    // much as one that ran three hundred.
    const weightedPlayers = r.reduce(
      (s, x) => s + Number(x.avg_players ?? 0) * Number(x.hands ?? 0),
      0
    );
    return {
      hands,
      scoops,
      splits,
      antes,
      rake,
      pot,
      unrecorded,
      tables: new Set(r.map((x) => x.table_id)).size,
      avgPlayers: hands > 0 ? weightedPlayers / hands : 0,
      // Of the hands whose outcome the ledger actually recorded.
      scoopRate: scoops + splits > 0 ? Math.round((scoops / (scoops + splits)) * 100) : null,
    };
  }, [rows]);

  const exportCsv = useCallback(async () => {
    if (!rows) return;
    const exportScope = scopeKey;
    const isCurrent = () => isMounted.current && activeScopeRef.current === exportScope;
    const header =
      'table,trigger,boards,variant,hands,avg_players,avg_pot,total_pot,total_rake,total_antes,scoops,splits,unrecorded,data_basis';
    const body = rows.map((d) =>
      [
        d.table_name ?? 'Table Name Unavailable',
        triggerLabel(d.trigger_reason),
        d.board_count ?? 1,
        d.variant ?? '',
        d.hands,
        d.avg_players ?? '',
        d.avg_pot ?? '',
        d.total_pot ?? '',
        d.total_rake ?? '',
        d.total_antes ?? '',
        d.scoops,
        d.splits,
        d.unrecorded_hands,
        BOMB_POT_DATA_BASIS,
      ]
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
    try {
      const downloaded = await downloadCsv(
        `bomb-pot-report-${clubId}-${days}d.csv`,
        [header, ...body].join('\n'),
        isCurrent
      );
      if (isCurrent() && !downloaded) {
        toast.error('This Browser Could Not Start The Download');
      }
    } catch (error) {
      if (!isCurrent()) return;
      reportError(error, 'ClubBombPotReportPage.Export_failed');
      toast.error('This Browser Could Not Start The Download');
    }
  }, [rows, clubId, days, isMounted, scopeKey, toast]);

  const header = (
    <ArenaWorkspaceHeader
      area="finance"
      id="bomb-pot-report-title"
      title="Bomb Pot Report"
      context={mastName}
      summary={SUMMARY}
    />
  );

  if (notFound) {
    return (
      <div className={`${styles.page} arena-workspace`}>
        {header}
        <section className="arena-case arena-ops-case">
          <ArenaState
            tone="empty"
            title="Club Not Found"
            message="No Club Answers To That Address."
            actions={
              <button type="button" onClick={() => navigate('/clubs')}>
                Back To Clubs
              </button>
            }
          />
        </section>
      </div>
    );
  }

  if (denied) {
    return (
      <div className={`${styles.page} arena-workspace`}>
        {header}
        <section className="arena-case arena-ops-case">
          <ArenaState
            tone="error"
            title="Bomb Pot Report"
            message="This Report Is Only Available To Club Staff."
            actions={
              <button type="button" onClick={() => navigate(`/clubs/${clubId}`)}>
                Back To Club
              </button>
            }
          />
        </section>
      </div>
    );
  }

  const hasRows = !!rows && rows.length > 0;

  return (
    <div className={`${styles.page} arena-workspace`}>
      <div className="arena-switch arena-ops-keys">
        <button type="button" onClick={() => navigate(`/clubs/${clubId}`)}>
          Back
        </button>
      </div>
      {header}
      <PageBar
        title="Bomb Pot Report"
        titleAs={false}
        showHelp={false}
        status={`${days} Days`}
        statusTone={loading ? 'attention' : 'live'}
        metrics={
          hasRows
            ? [
                { label: 'Bomb Pots Dealt', value: totals.hands.toLocaleString() },
                { label: 'Tables Running Them', value: totals.tables },
                { label: 'Rake From Bomb Pots', value: chips(totals.rake), tone: 'live' },
              ]
            : []
        }
      />

      <section className="arena-case arena-ops-case" aria-label="Bomb Pot Report">
        <h2 className="arena-section-title">
          Report Window<small>{days} Days</small>
        </h2>
        <div className="arena-switch" role="group" aria-label="Report Window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" aria-pressed={days === w} onClick={() => setDays(w)}>
              {w} Days
            </button>
          ))}
        </div>
        <div className="arena-switch arena-ops-keys arena-ops-primary">
          <button type="button" onClick={exportCsv} disabled={!hasRows}>
            Export CSV
          </button>
        </div>
        <p className="arena-ops-copy" aria-label="Data Coverage">
          {BOMB_POT_DATA_BASIS}
        </p>
      </section>

      {loading && !rows ? (
        <section className="arena-case arena-ops-case">
          <ArenaState tone="loading" title="Loading Report..." />
        </section>
      ) : error ? (
        <section className="arena-case arena-ops-case">
          <div className={styles.errorState}>
            <ArenaState
              tone="error"
              title="Report Unavailable"
              message={error}
              actions={
                <button type="button" onClick={() => void load()}>
                  Retry
                </button>
              }
            />
          </div>
        </section>
      ) : !rows || rows.length === 0 ? (
        <section className="arena-case arena-ops-case">
          <ArenaState
            tone="empty"
            title="No Bomb Pots"
            message={`No Recorded Bomb Pots At This Club In The Last ${days} Days.`}
          />
        </section>
      ) : (
        <>
          <section className="arena-case arena-ops-case" aria-label="Totals">
            <h2 className="arena-section-title">Totals</h2>
            <ArenaReadings
              label="Bomb Pot Totals"
              readings={[
                { id: 'hands', label: 'Bomb Pots Dealt', value: totals.hands.toLocaleString() },
                { id: 'tables', label: 'Tables Running Them', value: totals.tables },
                {
                  id: 'players',
                  label: 'Players Per Bomb',
                  value: compactChips(totals.avgPlayers),
                },
                { id: 'antes', label: 'Forced Antes Collected', value: chips(totals.antes) },
                {
                  id: 'rake',
                  label: 'Rake From Bomb Pots',
                  value: chips(totals.rake),
                  tone: 'live',
                },
                {
                  id: 'scoops',
                  label: 'Scooped Outright',
                  value: totals.scoopRate === null ? '-' : `${totals.scoopRate}%`,
                },
              ]}
            />

            {/* The ledger telling on itself. A report that quietly averages over
                hands it has no record of is how a hole stays invisible. */}
            {totals.unrecorded > 0 && (
              <p className={styles.notice}>
                {totals.unrecorded.toLocaleString()} Of These Hands Have No Award Record, So The
                Scoop Figures Above Cover The Rest. Hand Counts And Money Are Unaffected.
              </p>
            )}
          </section>

          <section className="arena-case arena-ops-case" aria-labelledby="bomb-pot-per-table">
            <h2 id="bomb-pot-per-table" className="arena-section-title">
              Per Table
            </h2>
            <ul className={styles.records}>
              {rows.map((d) => (
                <li
                  key={`${d.table_id}-${d.trigger_reason}-${d.board_count}-${d.variant ?? ''}`}
                  className={`arena-ledger-row ${styles.record}`}
                >
                  <div className={styles.recordHead}>
                    <span className={styles.recordName}>
                      {d.table_name ? titleCase(d.table_name) : 'Table Name Unavailable'}
                    </span>
                    <span className={styles.recordMeta}>
                      {triggerLabel(d.trigger_reason)}
                      {' / '}
                      {boardLabel(d.board_count)}
                      {d.variant ? ` / ${d.variant.toUpperCase()}` : ''}
                    </span>
                  </div>
                  <dl className={styles.figures}>
                    <div className={styles.figure}>
                      <dt className={styles.figureLabel}>Hands</dt>
                      <dd className={styles.figureValue}>{d.hands}</dd>
                    </div>
                    <div className={styles.figure}>
                      <dt className={styles.figureLabel}>Players</dt>
                      <dd className={styles.figureValue}>
                        {d.avg_players == null ? '-' : compactChips(Number(d.avg_players))}
                      </dd>
                    </div>
                    <div className={styles.figure}>
                      <dt className={styles.figureLabel}>Avg Pot</dt>
                      <dd className={styles.figureValue}>{chips(d.avg_pot)}</dd>
                    </div>
                    <div className={styles.figure}>
                      <dt className={styles.figureLabel}>Antes</dt>
                      <dd className={styles.figureValue}>{chips(d.total_antes)}</dd>
                    </div>
                    <div className={styles.figure}>
                      <dt className={styles.figureLabel}>Rake</dt>
                      <dd className={`${styles.figureValue} ${styles.up}`}>
                        {chips(d.total_rake)}
                      </dd>
                    </div>
                    <div className={styles.figure}>
                      <dt className={styles.figureLabel}>Scoops</dt>
                      <dd className={styles.figureValue}>{d.scoops}</dd>
                    </div>
                    <div className={styles.figure}>
                      <dt className={styles.figureLabel}>Splits</dt>
                      <dd className={styles.figureValue}>{d.splits}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
