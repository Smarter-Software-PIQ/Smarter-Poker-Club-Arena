import { Modal } from '../common/Modal';
import { formatWalletChips } from '../../utils/format';
import styles from './ClubDataReconciliation.module.css';

export interface ClubDataSourceRow {
  id: string;
  kind: string;
  name: string;
  fee?: number | string | null;
  winnings?: number | string | null;
}
interface Props {
  row: ClubDataSourceRow;
  clubId: string;
  start: string;
  end: string;
  onClose: () => void;
}
/** Identity and figures come from the accepted report row, without another financial read. */
export default function ClubDataSourceDetails({ row, clubId, start, end, onClose }: Props) {
  return (
    <Modal isOpen onClose={onClose} ariaLabel="Contributing Game Source" size="large">
      <section className={styles.reconciliation}>
        <h2>Contributing Game Source</h2>
        <p className={styles.note}>{row.name}</p>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>Game ID</dt>
            <dd>{row.id}</dd>
          </div>
          <div className={styles.row}>
            <dt>Game Type</dt>
            <dd>{row.kind}</dd>
          </div>
          <div className={styles.row}>
            <dt>Report Club ID</dt>
            <dd>{clubId}</dd>
          </div>
          <div className={styles.row}>
            <dt>Selected Dates</dt>
            <dd>
              {start} Through {end}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Fee</dt>
            <dd>{formatWalletChips(row.fee)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Total Winnings</dt>
            <dd>{formatWalletChips(row.winnings)}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          This Is The Game Contribution In The Selected Report Window And Filters. A Game Can
          Contribute On Multiple Dates. These Figures Are Not Its Lifetime Result Or A List Of
          Individual Hand Receipts.
        </p>
        <button className={styles.action} type="button" onClick={onClose}>
          Close Source Details
        </button>
      </section>
    </Modal>
  );
}
