import { clubDataReportPath } from '../../utils/clubDataReportPath';
import { Link, useSearchParams, useParams } from 'react-router-dom';
import { readClubDataRange } from '../../lib/clubDataRange';
import { accountingDay, clubDataCalendarLabel } from '../../lib/clubDataDay';
import styles from './ClubDataReconciliation.module.css';

/** Retain report context without relabeling the member ledger's Chicago accounting. */
export default function ClubDataReturnLink() {
  const [params] = useSearchParams();
  const { clubId } = useParams();
  const range = readClubDataRange(params, accountingDay());
  const source = params.get('dataClub') || clubId;
  if (!range?.start || !source || !/^[a-zA-Z0-9-]+$/.test(source)) return null;
  const query = new URLSearchParams();
  for (const key of [
    'dataStart',
    'dataEnd',
    'dataUntil',
    'dataGame',
    'dataStakes',
    'dataSearch',
    'report',
    'dataTab',
  ]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  const returnPath =
    params.get('view') === 'advanced' || params.get('report') === 'open'
      ? clubDataReportPath(source, query)
      : `/clubs/${encodeURIComponent(source)}/data?${query}`;
  return (
    <p className={styles.note}>
      <Link className={styles.action} to={returnPath}>
        Return To Club Data
      </Link>{' '}
      {clubDataCalendarLabel(range.start, range.end, 'pacific')}. Member Ledger Figures Retain Their
      Stated Chicago Basis.
    </p>
  );
}
