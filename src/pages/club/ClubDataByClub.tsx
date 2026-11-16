/**
 * BY CLUB - the union's Club Data figures, club by club (20261115205153).
 *
 * The union's own Club Data page ("All Member Clubs And Union Account") shows
 * the grand totals; this card under the totals says which club each part
 * belongs to: one row per member club and one row for the union's own
 * account, each with its Fee and Total Winnings for the same window and
 * filters. The rows come from the same read as the totals
 * (ca_club_data_screen's `clubs`, union answer only) and add up to them to the
 * cent. A member club's row opens that club's own Club Data page on the same
 * window.
 */
import { Link } from 'react-router-dom';
import styles from './ClubDataSimplePage.module.css';
import { titleCase } from '../../utils/titleCase';
import { figureDigits, formatWalletChips, type FigureInput } from '../../utils/format';
import { addCalendarDays } from '../../lib/clubDataDay';

export interface ClubDataClubRow {
  club_id: string;
  name: string;
  slug?: string | null;
  /** The union's own account (the union itself), not a member club. */
  union_account: boolean;
  fee: number | string;
  total_winnings: number | string;
}

const isFigure = (n: unknown): boolean =>
  (typeof n === 'number' || typeof n === 'string') && n !== '' && Number.isFinite(Number(n));

/** The `clubs` key of a union answer: every row whole, each club once, one union account. */
export function isClubRows(value: unknown): value is ClubDataClubRow[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  let accounts = 0;
  for (const r of value) {
    if (!r || typeof r !== 'object') return false;
    const row = r as Record<string, unknown>;
    if (typeof row.club_id !== 'string' || !row.club_id || seen.has(row.club_id)) return false;
    if (typeof row.name !== 'string' || typeof row.union_account !== 'boolean') return false;
    if (row.slug !== undefined && row.slug !== null && typeof row.slug !== 'string') return false;
    if (!isFigure(row.fee) || !isFigure(row.total_winnings)) return false;
    seen.add(row.club_id);
    if (row.union_account) accounts += 1;
  }
  return accounts <= 1;
}

/**
 * The member club's Club Data page on this window, written the way the page
 * writes its own dates: dataUntil is the boundary the window stops at (the day
 * after its last day), dataStart only when the window has a chosen start.
 */
export function clubDataWindowLink(
  club: Pick<ClubDataClubRow, 'club_id' | 'slug'>,
  end: string,
  start: string | null
): { pathname: string; search: string } {
  const params = new URLSearchParams();
  if (start !== null) params.set('dataStart', start);
  params.set('dataUntil', addCalendarDays(end, 1));
  const key = club.slug || club.club_id;
  return { pathname: `/clubs/${encodeURIComponent(key)}/data`, search: `?${params.toString()}` };
}

function ink(n: FigureInput): string {
  const d = figureDigits(n);
  if (!d || !/[1-9]/.test(d.whole + d.fraction)) return styles.inkNeutral;
  return d.negative ? styles.inkLoss : styles.inkWin;
}

interface Props {
  clubs: ClubDataClubRow[];
  /** Last day of the window (the page's endDate). */
  end: string;
  /** The window's chosen start, or null when it is a preset. */
  start: string | null;
}

export default function ClubDataByClub({ clubs, end, start }: Props) {
  if (clubs.length === 0) return null;
  return (
    <section className={styles.byClub} aria-label="By Club">
      <h2 className={styles.byClubTitle}>By Club</h2>
      <div className={styles.byClubHead} aria-hidden="true">
        <span>Club</span>
        <span>Total Winnings</span>
        <span>Fee</span>
      </div>
      <ul className={styles.byClubList}>
        {clubs.map((c) => {
          const label = c.union_account ? 'Union Account' : titleCase(c.name || 'Club');
          const figures = (
            <>
              <span className={styles.byClubName}>{label}</span>
              <span
                className={`${styles.byClubFigure} ${ink(c.total_winnings)}`}
                title={formatWalletChips(c.total_winnings)}
              >
                {formatWalletChips(c.total_winnings)}
              </span>
              <span className={styles.byClubFigure} title={formatWalletChips(c.fee)}>
                {formatWalletChips(c.fee)}
              </span>
            </>
          );
          return (
            <li key={c.club_id}>
              {c.union_account ? (
                <div
                  className={styles.byClubRow}
                  aria-label={`${label}: Total Winnings ${formatWalletChips(c.total_winnings)}, Fee ${formatWalletChips(c.fee)}`}
                >
                  {figures}
                </div>
              ) : (
                <Link
                  className={`${styles.byClubRow} ${styles.byClubLink}`}
                  to={clubDataWindowLink(c, end, start)}
                  aria-label={`${label}: Total Winnings ${formatWalletChips(c.total_winnings)}, Fee ${formatWalletChips(c.fee)}. View Club Data`}
                >
                  {figures}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
