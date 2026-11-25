import type { ClubDataCoverage } from '../../lib/clubDataDay';
import {
  financialWindowStatus,
  pacificClosingBoundary,
  parseClubDataReconciliation,
} from '../../lib/clubDataReconciliation';
import { titleCase } from '../../utils/titleCase';
import styles from './ClubDataReconciliation.module.css';

interface Props {
  basis?: string;
  coverage?: ClubDataCoverage | null;
  range: { start: string; end: string };
  reconciliation?: unknown;
  generatedAt?: string;
  onGames?: () => void;
  onPlayers?: () => void;
  onHistory?: () => void;
}

const money = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'Unavailable';

/** Printed on the existing Data surface; no request, independent clock or poll. */
export default function ClubDataReconciliation({
  basis,
  coverage,
  range,
  reconciliation,
  generatedAt,
  onGames,
  onPlayers,
  onHistory,
}: Props) {
  if (basis !== 'union_invoice_accounting') return null;
  const status = financialWindowStatus(basis, coverage, range);
  const values = parseClubDataReconciliation(reconciliation);
  const bbjReady = values?.complete === true;
  return (
    <section className={styles.reconciliation} aria-label="Financial Reconciliation">
      <div className={styles.status} role="status">
        {status.current && <strong>Current Day</strong>}
        <strong>{status.posted ? 'Posted Totals Verified' : 'Source Verification Pending'}</strong>
        <strong>{status.final ? 'Billing Finalized' : 'Final Billing Pending'}</strong>
      </div>
      {status.closingBoundaries.map((day) => (
        <p key={day} className={styles.note}>
          Closing Boundary Awaiting Certification: {titleCase(pacificClosingBoundary(day))}.
        </p>
      ))}
      <p className={styles.note}>
        Games Count Unique Games Across This Range. A Game Played On Multiple Days Counts Once.
      </p>
      <dl className={styles.rows} aria-label="BBJ Totals">
        <div className={styles.row}>
          <dt>BBJ Collected</dt>
          <dd>{money(bbjReady ? values.bbj_gross : null)}</dd>
        </div>
        <div className={styles.row}>
          <dt>BBJ Awards Paid</dt>
          <dd>{money(bbjReady ? values.bbj_awards : null)}</dd>
        </div>
        <div className={styles.row}>
          <dt>BBJ Net After Awards</dt>
          <dd>{money(bbjReady ? values.bbj_net : null)}</dd>
        </div>
      </dl>
      {!bbjReady && (
        <p className={styles.note} role="status">
          BBJ Totals Await Original Source Verification.
          {values?.missing_days.length ? ` Missing Dates: ${values.missing_days.join(', ')}.` : ''}
        </p>
      )}
      <details className={styles.details}>
        <summary>Closing And Source Evidence</summary>
        <p className={styles.note}>
          Selected Dates: {range.start} Through {range.end}. Posted Coverage:{' '}
          {status.posted ? 'Verified' : 'Pending'}. Billing Certificate:{' '}
          {status.final ? 'Finalized' : 'Pending'}.
        </p>
        {generatedAt && Number.isFinite(Date.parse(generatedAt)) && (
          <p className={styles.note}>
            Source Snapshot:{' '}
            {new Date(generatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Chicago
            Time.
          </p>
        )}
        <p className={styles.note}>
          Open Tournament Entries Can Be Replaced By Settled Results At Closing. Coverage And Issued
          Invoices Establish Finalization. This Snapshot Does Not Contain A Revision-By-Revision
          History Or The Reason For A Particular Past Change.
        </p>
        {onHistory && (
          <button type="button" className={styles.action} onClick={onHistory}>
            View Issued Invoices
          </button>
        )}
      </details>
      {(onGames || onPlayers) && (
        <div className={styles.status} role="group" aria-label="Reconciliation Drilldowns">
          {onGames && (
            <button type="button" className={styles.action} onClick={onGames}>
              View Contributing Games
            </button>
          )}
          {onPlayers && (
            <button type="button" className={styles.action} onClick={onPlayers}>
              View Player Totals
            </button>
          )}
        </div>
      )}
      <details className={styles.details}>
        <summary>How These Totals Reconcile</summary>
        <p className={styles.note}>
          These Figures Use The Same Dates, Scope And Filters As The Totals Above.
        </p>
        <dl className={styles.rows} aria-label="Cash And Tournament Reconciliation">
          <div className={styles.row}>
            <dt>Cash Rake</dt>
            <dd>{money(values?.cash_fee)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Cash Winnings</dt>
            <dd>{money(values?.cash_winnings)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Cash Result Difference</dt>
            <dd>{money(bbjReady ? values.cash_residual : null)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Tournament Fees</dt>
            <dd>{money(values?.tournament_fee)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Tournament Winnings</dt>
            <dd>{money(values?.tournament_winnings)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Tournament Flow Difference</dt>
            <dd>{money(values?.tournament_flow_difference)}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          BBJ Net After Awards Is Collected Minus Awards Paid, Not The Jackpot Pool Balance. Cash
          Result Difference Is Player Cash Losses Minus Cash Rake And BBJ After Awards. A Filtered
          Group Can Win Or Lose Against Players Outside That Group. Tournament Flow Difference Is
          Tournament Player Losses Minus Tournament Fees. Entries, Payouts And Closing Adjustments
          Can Affect That Difference. Neither Difference Is BBJ Collected.
        </p>
        <p className={styles.note}>
          Use The Existing Game And Player Breakdowns To Inspect The Results Behind These Totals.
        </p>
      </details>
    </section>
  );
}
