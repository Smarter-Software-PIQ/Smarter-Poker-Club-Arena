import { clubDataCalendarLabel, type ClubDataDayBasis } from '../../lib/clubDataDay';
import styles from './ClubDataReconciliation.module.css';

interface Props {
  start: string;
  end: string;
  basis: ClubDataDayBasis;
  union: boolean;
}
/** Shared explanations use the answer's financial basis, never the viewer's local zone. */
export default function ClubDataReportGuide({ start, end, basis, union }: Props) {
  return (
    <section className={styles.reconciliation} aria-label="Report Dates And Definitions">
      <p className={styles.note}>{clubDataCalendarLabel(start, end, basis)}</p>
      <details className={styles.details}>
        <summary>Metric Definitions</summary>
        <p className={styles.note}>
          Reports Are Limited To The Past 90 Days. The End Date Is Included. The Chicago Boundary
          Above Is Exclusive. Today Stops At The Current Time. Pacific And Chicago Clock Changes Can
          Change The Displayed Boundary Hour.
        </p>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>Total Winnings</dt>
            <dd>
              {union
                ? 'Player Cash Hand Results, Including BBJ Awards, Plus Tournament Results. Chips Still On The Felt Are Excluded.'
                : 'Net Money Flow From Cash And Tournaments, Including Chips Still On The Felt.'}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>MTT Winnings</dt>
            <dd>Finished MTT Prizes, Bounties And Refunds Less Buy-Ins, Rebuys And Add-Ons.</dd>
          </div>
          <div className={styles.row}>
            <dt>Fee</dt>
            <dd>
              {union
                ? 'Rake Credited To The Club Before Agent Shares. Tournament Fees Are Recognized At Settlement.'
                : 'Fees Generated Before Agent Shares And Adjustments.'}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>BBJ Collected</dt>
            <dd>
              Gross Jackpot Contributions From Verified Source Records. Player Losses Minus Rake Are
              Not A Substitute.
            </dd>
          </div>
          <div className={styles.row}>
            <dt>BBJ Net</dt>
            <dd>BBJ Collected Minus BBJ Awards Paid. This Is Not The Jackpot Pool Balance.</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
