/**
 * CLUB INSURANCE REPORT (2026-08-28)
 * ============================================================================
 * The club staff's view of the all-in insurance product: the decision FUNNEL
 * (offers -> accepted / declined / timeouts / cashouts) next to the MONEY
 * (bank in / out / net), per day. The dashboard's revenue card shows the
 * headline net; this page answers the question that number raises - are
 * players actually buying at the offered rates, and what is each day worth?
 *
 * Data: ca_club_insurance_report RPC - SECURITY DEFINER, gated server-side on
 * ca_can_view_club_finances (owner / admin / super_agent / platform admin),
 * ERRCODE 42501 like its siblings. The client gate is cosmetic.
 *
 * Funnel rows come from insurance_offer_events (engine-written, fire-and-
 * forget); money rows from insurance_transactions (the settled ledger). The
 * two are reconciled nightly (insurance_bank + insurance_offer_unresolved in
 * reconcile_ledger_nightly), so this page can present them side by side
 * without re-deriving anything.
 *
 * #SmarterDesign (Dan 2026-11-27): the painted console is gone. The page
 * wears the arena workspace: the finance mast with the club's name, the
 * headline figures as chrome meters, the window as a chrome switch that lights
 * the selected window, the funnel and the money as chrome readouts and every
 * day as a chrome ledger row. Every read, guard and pinned literal is kept.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { isAuthzError } from '../../utils/clubDashboard';
import { reportError } from '../../utils/errorReporter';
import { downloadCsv, csvEscape } from '../../utils/downloadCsv';
import styles from './ClubInsuranceReportPage.module.css';
import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../../components/help/PageBar';
import { useArenaClubName } from '../../components/ops/useArenaClubName';
import { ArenaReadings, ArenaState, type ArenaTone } from '../../components/ops/ArenaOps';
import { compactChips } from '../../utils/format';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useAuthUser } from '../../hooks/useAuthUser';
import { useToast } from '../../components/common/Toast';

interface ReportDay {
  day: string;
  offers: number;
  accepted: number;
  declined: number;
  timeouts: number;
  cashouts: number;
  contracts: number;
  bank_in: number;
  bank_out: number;
  bank_net: number;
}

interface Report {
  window_days: number;
  /** The UTC days the whole report covers, headline and rows alike. */
  window_start: string;
  window_end: string;
  bank: 'union' | 'club';
  totals: {
    offers: number;
    accepted: number;
    declined: number;
    timeouts: number;
    cashouts: number;
    /** Server-computed: (accepted + cashed out) / offers. */
    take_rate_pct: number | null;
    avg_offer_equity: number | null;
    avg_offer_pot: number | null;
  };
  money: {
    contracts: number;
    insurance_contracts: number;
    cashout_contracts: number;
    bank_in: number;
    bank_out: number;
    bank_net: number;
  };
  days: ReportDay[];
  generated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const INSURANCE_REPORT_CONTRACT = 'ca_club_insurance_report.v2';
const UUID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reportCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Insurance report ${label} is invalid`);
  }
  return value;
}

function reportAmount(
  value: unknown,
  label: string,
  options: { nullable?: boolean; minimum?: number } = {}
): number | null {
  if (value === null && options.nullable) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (options.minimum !== undefined && value < options.minimum)
  ) {
    throw new Error(`Insurance report ${label} is invalid`);
  }
  return value;
}

function moneyCents(value: unknown, label: string, minimum?: number): number {
  const amount = reportAmount(value, label, { minimum });
  const cents = Math.round((amount as number) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - (amount as number)) > 1e-9) {
    throw new Error(`Insurance report ${label} is invalid`);
  }
  return cents;
}

function reportDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Insurance report ${label} is invalid`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Insurance report ${label} is invalid`);
  }
  return value;
}

function reportTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Insurance report generated timestamp is invalid');
  }
  return value;
}

/** Bind a report to the requested window and reconcile every exported count
 * and amount before any server success is allowed to paint. */
export function parseClubInsuranceReport(
  value: unknown,
  expectedClubId: string,
  expectedDays: number
): Report {
  if (!isRecord(value)) throw new Error('Insurance report response is invalid');
  if (
    !UUID_TOKEN.test(expectedClubId) ||
    value.contract !== INSURANCE_REPORT_CONTRACT ||
    value.contract_version !== 2 ||
    value.club_id !== expectedClubId ||
    value.requested_days !== expectedDays
  ) {
    throw new Error('Insurance report scope receipt is invalid');
  }
  if (value.window_days !== expectedDays) throw new Error('Insurance report window is invalid');
  const windowStart = reportDate(value.window_start, 'window start');
  const windowEnd = reportDate(value.window_end, 'window end');
  const startMs = Date.parse(`${windowStart}T00:00:00.000Z`);
  const endMs = Date.parse(`${windowEnd}T00:00:00.000Z`);
  if ((endMs - startMs) / 86_400_000 + 1 !== expectedDays) {
    throw new Error('Insurance report window is invalid');
  }
  if (value.bank !== 'union' && value.bank !== 'club') {
    throw new Error('Insurance report bank is invalid');
  }
  if (!isRecord(value.totals) || !isRecord(value.money) || !Array.isArray(value.days)) {
    throw new Error('Insurance report shape is invalid');
  }

  const totals = {
    offers: reportCount(value.totals.offers, 'offer count'),
    accepted: reportCount(value.totals.accepted, 'accepted count'),
    declined: reportCount(value.totals.declined, 'declined count'),
    timeouts: reportCount(value.totals.timeouts, 'timeout count'),
    cashouts: reportCount(value.totals.cashouts, 'cashout count'),
    take_rate_pct: reportAmount(value.totals.take_rate_pct, 'take rate', {
      nullable: true,
      minimum: 0,
    }),
    avg_offer_equity: reportAmount(value.totals.avg_offer_equity, 'average equity', {
      nullable: true,
      minimum: 0,
    }),
    avg_offer_pot: reportAmount(value.totals.avg_offer_pot, 'average pot', {
      nullable: true,
      minimum: 0,
    }),
  };
  if (
    totals.accepted + totals.declined + totals.timeouts + totals.cashouts > totals.offers ||
    (totals.avg_offer_equity !== null && totals.avg_offer_equity > 100)
  ) {
    throw new Error('Insurance report funnel does not reconcile');
  }
  const expectedTakeRate =
    totals.offers === 0
      ? null
      : Math.round(((totals.accepted + totals.cashouts) / totals.offers) * 1_000) / 10;
  if (
    totals.take_rate_pct !== expectedTakeRate &&
    (totals.take_rate_pct === null ||
      expectedTakeRate === null ||
      Math.abs(totals.take_rate_pct - expectedTakeRate) > 1e-9)
  ) {
    throw new Error('Insurance report take rate does not reconcile');
  }

  const money = {
    contracts: reportCount(value.money.contracts, 'contract count'),
    insurance_contracts: reportCount(value.money.insurance_contracts, 'insurance contract count'),
    cashout_contracts: reportCount(value.money.cashout_contracts, 'cashout contract count'),
    bank_in: moneyCents(value.money.bank_in, 'bank in', 0) / 100,
    bank_out: moneyCents(value.money.bank_out, 'bank out', 0) / 100,
    bank_net: moneyCents(value.money.bank_net, 'bank net') / 100,
  };
  if (
    money.insurance_contracts + money.cashout_contracts !== money.contracts ||
    Math.round(money.bank_in * 100) - Math.round(money.bank_out * 100) !==
      Math.round(money.bank_net * 100)
  ) {
    throw new Error('Insurance report money does not reconcile');
  }

  const seenDays = new Set<string>();
  let previousDay = '9999-12-31';
  const days = value.days.map((candidate) => {
    if (!isRecord(candidate)) throw new Error('Insurance report day is invalid');
    const day = reportDate(candidate.day, 'day');
    if (day < windowStart || day > windowEnd || day >= previousDay || seenDays.has(day)) {
      throw new Error('Insurance report days are invalid');
    }
    seenDays.add(day);
    previousDay = day;
    const bankIn = moneyCents(candidate.bank_in, 'daily bank in', 0) / 100;
    const bankOut = moneyCents(candidate.bank_out, 'daily bank out', 0) / 100;
    const bankNet = moneyCents(candidate.bank_net, 'daily bank net') / 100;
    if (Math.round(bankIn * 100) - Math.round(bankOut * 100) !== Math.round(bankNet * 100)) {
      throw new Error('Insurance report daily money does not reconcile');
    }
    const row: ReportDay = {
      day,
      offers: reportCount(candidate.offers, 'daily offer count'),
      accepted: reportCount(candidate.accepted, 'daily accepted count'),
      declined: reportCount(candidate.declined, 'daily declined count'),
      timeouts: reportCount(candidate.timeouts, 'daily timeout count'),
      cashouts: reportCount(candidate.cashouts, 'daily cashout count'),
      contracts: reportCount(candidate.contracts, 'daily contract count'),
      bank_in: bankIn,
      bank_out: bankOut,
      bank_net: bankNet,
    };
    if (row.accepted + row.declined + row.timeouts + row.cashouts > row.offers) {
      throw new Error('Insurance report daily funnel does not reconcile');
    }
    return row;
  });

  const summed = days.reduce(
    (sum, day) => ({
      offers: sum.offers + day.offers,
      accepted: sum.accepted + day.accepted,
      declined: sum.declined + day.declined,
      timeouts: sum.timeouts + day.timeouts,
      cashouts: sum.cashouts + day.cashouts,
      contracts: sum.contracts + day.contracts,
      bankInCents: sum.bankInCents + Math.round(day.bank_in * 100),
      bankOutCents: sum.bankOutCents + Math.round(day.bank_out * 100),
      bankNetCents: sum.bankNetCents + Math.round(day.bank_net * 100),
    }),
    {
      offers: 0,
      accepted: 0,
      declined: 0,
      timeouts: 0,
      cashouts: 0,
      contracts: 0,
      bankInCents: 0,
      bankOutCents: 0,
      bankNetCents: 0,
    }
  );
  if (
    summed.offers !== totals.offers ||
    summed.accepted !== totals.accepted ||
    summed.declined !== totals.declined ||
    summed.timeouts !== totals.timeouts ||
    summed.cashouts !== totals.cashouts ||
    summed.contracts !== money.contracts ||
    summed.bankInCents !== Math.round(money.bank_in * 100) ||
    summed.bankOutCents !== Math.round(money.bank_out * 100) ||
    summed.bankNetCents !== Math.round(money.bank_net * 100)
  ) {
    throw new Error('Insurance report totals do not reconcile');
  }

  return {
    window_days: expectedDays,
    window_start: windowStart,
    window_end: windowEnd,
    bank: value.bank,
    totals,
    money,
    days,
    generated_at: reportTimestamp(value.generated_at),
  };
}

const WINDOWS = [7, 30, 90] as const;

interface ReportSnapshot {
  scope: string;
  report: Report;
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
const chips = (n: number) => compactChips(Number(n ?? 0));

const SUMMARY =
  'Read The Insurance Decision Funnel Next To The Money It Moved, Per Day, For The Selected Window.';

export default function ClubInsuranceReportPage() {
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

  const report = snapshot?.scope === scopeKey ? snapshot.report : null;
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
          reportError(e, 'ClubInsuranceReportPage.Resolve_failed');
          setRequestState((current) =>
            current.scope === requestScope
              ? { ...current, error: 'The Club Could Not Be Resolved' }
              : current
          );
        }
        return;
      }

      if (!isCurrent()) return;
      const { data, error: rpcError } = await supabase.rpc('ca_club_insurance_report', {
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
          reportError(rpcError, 'ClubInsuranceReportPage.Load_failed');
          setRequestState((current) =>
            current.scope === requestScope
              ? { ...current, error: 'Could Not Load The Insurance Report' }
              : current
          );
        }
      } else {
        setSnapshot({
          scope: requestScope,
          report: parseClubInsuranceReport(data, resolved, days),
        });
      }
    } catch (e) {
      if (!isCurrent()) return;
      reportError(e, 'ClubInsuranceReportPage.Load_failed');
      setSnapshot(null);
      setRequestState((current) =>
        current.scope === requestScope
          ? { ...current, error: 'Could Not Load The Insurance Report' }
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

  const exportCsv = useCallback(async () => {
    if (!report) return;
    const exportScope = scopeKey;
    const isCurrent = () => isMounted.current && activeScopeRef.current === exportScope;
    const header =
      'day,offers,accepted,declined,timeouts,cashouts,contracts,bank_in,bank_out,bank_net';
    const rows = report.days.map((d) =>
      [
        d.day,
        d.offers,
        d.accepted,
        d.declined,
        d.timeouts,
        d.cashouts,
        d.contracts,
        d.bank_in,
        d.bank_out,
        d.bank_net,
      ]
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
    try {
      const downloaded = await downloadCsv(
        `insurance-report-${clubId}-${report.window_days}d.csv`,
        [header, ...rows].join('\n'),
        isCurrent
      );
      if (isCurrent() && !downloaded) {
        toast.error('This Browser Could Not Start The Download');
      }
    } catch (error) {
      if (!isCurrent()) return;
      reportError(error, 'ClubInsuranceReportPage.Export_failed');
      toast.error('This Browser Could Not Start The Download');
    }
  }, [report, clubId, isMounted, scopeKey, toast]);

  const header = (
    <ArenaWorkspaceHeader
      area="finance"
      id="insurance-report-title"
      title="Insurance Report"
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
            title="Insurance Report"
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

  const t = report?.totals;
  const m = report?.money;
  // PHASE 6 (2026-09-04): the take rate is the server's now, computed over
  // OFFERS. This divided event counts by event counts - an offer accepted and
  // then cashed out counted twice in the numerator and once in the
  // denominator, so the rate could pass 100% - and the funnel and the money
  // used different windows (a rolling timestamp against UTC day buckets), so
  // the day rows below could never sum to the headline above them.
  const acceptRate = t?.take_rate_pct ?? null;

  const netTone = (n: number): ArenaTone => (n >= 0 ? 'live' : 'danger');
  const netClass = (n: number) => (n >= 0 ? styles.up : styles.down);

  return (
    <div className={`${styles.page} arena-workspace`}>
      <div className="arena-switch arena-ops-keys">
        <button type="button" onClick={() => navigate(`/clubs/${clubId}`)}>
          Back
        </button>
      </div>
      {header}
      <PageBar
        title="Insurance Report"
        titleAs={false}
        showHelp={false}
        status={`${days} Days`}
        statusTone={loading ? 'attention' : 'live'}
        metrics={
          report
            ? [
                { label: 'Offers Shown', value: (t?.offers ?? 0).toLocaleString() },
                { label: 'Take Rate', value: acceptRate === null ? '-' : `${acceptRate}%` },
                { label: 'Bank In', value: chips(m?.bank_in ?? 0) },
                {
                  label: 'Net',
                  value: chips(m?.bank_net ?? 0),
                  tone: (m?.bank_net ?? 0) >= 0 ? 'live' : 'attention',
                },
              ]
            : []
        }
      />

      <section className="arena-case arena-ops-case" aria-label="Insurance Report">
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
          <button type="button" onClick={exportCsv} disabled={!report}>
            Export CSV
          </button>
        </div>
      </section>

      {loading && !report ? (
        <section className="arena-case arena-ops-case">
          <ArenaState tone="loading" title="Loading Report..." />
        </section>
      ) : error ? (
        <section className="arena-case arena-ops-case">
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
        </section>
      ) : !report ? (
        <section className="arena-case arena-ops-case">
          <ArenaState tone="empty" title="No Report Data" />
        </section>
      ) : (
        <>
          <section className="arena-case arena-ops-case" aria-label="Decision Funnel">
            <h2 className="arena-section-title">Decision Funnel</h2>
            <ArenaReadings
              label="Decision Funnel Readings"
              readings={[
                { id: 'offers', label: 'Offers Shown', value: (t?.offers ?? 0).toLocaleString() },
                {
                  id: 'insured',
                  label: 'Insured / Cashed Out',
                  value: `${t?.accepted ?? 0} / ${t?.cashouts ?? 0}`,
                },
                {
                  id: 'declined',
                  label: 'Declined / Timed Out',
                  value: `${t?.declined ?? 0} / ${t?.timeouts ?? 0}`,
                },
                {
                  id: 'take-rate',
                  label: 'Take Rate',
                  value: acceptRate === null ? '-' : `${acceptRate}%`,
                  tone: 'live',
                },
                {
                  id: 'equity',
                  label: 'Avg Offer Equity',
                  value: t?.avg_offer_equity == null ? '-' : `${t.avg_offer_equity}%`,
                },
                {
                  id: 'pot',
                  label: 'Avg Insurable Pot',
                  value: t?.avg_offer_pot == null ? '-' : chips(t.avg_offer_pot),
                },
              ]}
            />
          </section>

          <section className="arena-case arena-ops-case" aria-label="Money">
            <h2 className="arena-section-title">Money</h2>
            <ArenaReadings
              label="Money Readings"
              readings={[
                {
                  id: 'contracts',
                  label: 'Settled Contracts',
                  value: m?.contracts ?? 0,
                  sub: `${m?.insurance_contracts ?? 0} Ins / ${m?.cashout_contracts ?? 0} Cash`,
                },
                {
                  id: 'bank-in',
                  label: 'Bank In (Fees + Redirects)',
                  value: chips(m?.bank_in ?? 0),
                },
                { id: 'bank-out', label: 'Bank Out (Payouts)', value: chips(m?.bank_out ?? 0) },
                {
                  id: 'net',
                  label: `Net ${report.bank === 'union' ? '(To Union Bank)' : '(Club Bank)'}`,
                  value: chips(m?.bank_net ?? 0),
                  tone: netTone(m?.bank_net ?? 0),
                },
              ]}
            />
          </section>

          <section className="arena-case arena-ops-case" aria-labelledby="insurance-per-day">
            <h2 id="insurance-per-day" className="arena-section-title">
              Per Day
              {report.window_start ? (
                <small>
                  {report.window_start} To {report.window_end}
                </small>
              ) : null}
            </h2>
            {report.days.length === 0 ? (
              <ArenaState tone="empty" title="No Insurance Activity In This Window" />
            ) : (
              <ul className={styles.records}>
                {report.days.map((d) => (
                  <li key={d.day} className={`arena-ledger-row ${styles.record}`}>
                    <div className={styles.recordHead}>
                      <span className={styles.recordName}>{d.day}</span>
                      <span className={`${styles.recordNet} ${netClass(d.bank_net)}`}>
                        {chips(d.bank_net)} Net
                      </span>
                    </div>
                    <dl className={styles.figures}>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>Offers</dt>
                        <dd className={styles.figureValue}>{d.offers}</dd>
                      </div>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>Ins</dt>
                        <dd className={styles.figureValue}>{d.accepted}</dd>
                      </div>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>Cash</dt>
                        <dd className={styles.figureValue}>{d.cashouts}</dd>
                      </div>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>Decl</dt>
                        <dd className={styles.figureValue}>{d.declined}</dd>
                      </div>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>T/O</dt>
                        <dd className={styles.figureValue}>{d.timeouts}</dd>
                      </div>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>Contracts</dt>
                        <dd className={styles.figureValue}>{d.contracts}</dd>
                      </div>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>In</dt>
                        <dd className={styles.figureValue}>{chips(d.bank_in)}</dd>
                      </div>
                      <div className={styles.figure}>
                        <dt className={styles.figureLabel}>Out</dt>
                        <dd className={styles.figureValue}>{chips(d.bank_out)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
