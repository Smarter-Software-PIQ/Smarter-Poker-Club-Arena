import { compactChips, cutFixed } from '../../utils/format';
import { titleCase } from '../../utils/titleCase';
import { NOT_YET_MEASURED } from './format';
import {
  CLUB_SORTS,
  type ClubComparisonRow,
  type ClubComparisonSort,
} from './playerStatsPageModel';

interface Props {
  rows: ClubComparisonRow[];
  tournament: boolean;
  changeClub: (clubId: string | null) => void;
}

function ClubComparisonTable({ rows, tournament, changeClub }: Props) {
  return (
    <div className="stats-club-table-wrap">
      <table className="stats-club-table stats-club-ledger" role="table">
        <thead>
          <tr>
            <th scope="col">Club</th>
            <th scope="col">Hands</th>
            {!tournament && <th scope="col">Profit</th>}
            {!tournament && <th scope="col">BB/100 Hands</th>}
            <th scope="col">VPIP</th>
            <th scope="col">PFR</th>
            <th scope="col">Hours</th>
            {!tournament && <th scope="col">Rake</th>}
            {tournament && <th scope="col">Tournament Results</th>}
            <th scope="col">Last Play</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.club.id}>
              <th scope="row">
                <button type="button" onClick={() => changeClub(row.club.id)}>
                  {titleCase(row.club.name)}
                </button>
              </th>
              <td data-label="Hands">{row.hands.toLocaleString()}</td>
              {!tournament && (
                <>
                  <td data-label="Profit" className={row.profit >= 0 ? 'positive' : 'negative'}>
                    {row.profit >= 0 ? '+' : ''}
                    {compactChips(row.profit)}
                  </td>
                  <td data-label="BB/100 Hands">
                    {row.hands ? cutFixed(row.bb100, 1) : NOT_YET_MEASURED}
                  </td>
                </>
              )}
              <td data-label="VPIP">
                {row.hands ? `${cutFixed(row.vpip * 100, 1)}%` : NOT_YET_MEASURED}
              </td>
              <td data-label="PFR">
                {row.hands ? `${cutFixed(row.pfr * 100, 1)}%` : NOT_YET_MEASURED}
              </td>
              <td data-label="Hours">
                {row.hours === null ? 'Unavailable' : cutFixed(row.hours, 1)}
              </td>
              {!tournament && <td data-label="Rake">{compactChips(row.rake)}</td>}
              {tournament && (
                <td data-label="Tournament Results">
                  {row.tournamentEntries.toLocaleString()} Entries //{' '}
                  {row.tournamentCashes.toLocaleString()} Cashes //{' '}
                  {row.tournamentWins.toLocaleString()} Wins //{' '}
                  {compactChips(row.tournamentWinnings)} Won
                </td>
              )}
              <td data-label="Last Play">
                {row.lastPlayedAt
                  ? new Date(row.lastPlayedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : NOT_YET_MEASURED}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PanelProps {
  tournament: boolean;
  changeClub: (clubId: string | null) => void;
  onRetryComparison: () => void;
  comparisonSort: ClubComparisonSort;
  changeComparisonSort: (sort: ClubComparisonSort) => void;
  comparisonLoading: boolean;
  comparisonError: boolean;
  sortedComparisonRows: ClubComparisonRow[];
}

export default function ClubComparisonPanel({
  tournament,
  changeClub,
  onRetryComparison,
  comparisonSort,
  changeComparisonSort,
  comparisonLoading,
  comparisonError,
  sortedComparisonRows,
}: PanelProps) {
  return (
    <section
      className="stats-club-comparison stats-workbench-surface"
      id="stats-club-comparison"
      aria-labelledby="stats-club-comparison-title"
    >
      <div className="stats-club-comparison-head">
        <div>
          <h2 id="stats-club-comparison-title">Club Comparison</h2>
        </div>
        <div className="stats-club-sort" role="group" aria-label="Sort Club Comparison">
          {CLUB_SORTS.filter((sort) =>
            tournament
              ? !['profit', 'bb100', 'rake'].includes(sort.key)
              : sort.key !== 'tournaments'
          ).map((sort) => (
            <button
              type="button"
              key={sort.key}
              aria-pressed={comparisonSort === sort.key}
              className={comparisonSort === sort.key ? 'active' : ''}
              onClick={() => changeComparisonSort(sort.key)}
            >
              {sort.label}
            </button>
          ))}
        </div>
      </div>
      {comparisonLoading && <div className="stats-section-loading">Loading Club Ledgers...</div>}
      {comparisonError && (
        <div className="stats-notice stats-notice-warn" role="alert">
          Club Comparison Could Not Be Loaded.{' '}
          <button type="button" className="hand-retry" onClick={onRetryComparison}>
            Try Again
          </button>
        </div>
      )}
      {!comparisonLoading && !comparisonError && sortedComparisonRows.length > 0 && (
        <ClubComparisonTable
          rows={sortedComparisonRows}
          tournament={tournament}
          changeClub={changeClub}
        />
      )}
      {!comparisonLoading && !comparisonError && sortedComparisonRows.length === 0 && (
        <p role="status">No Club Records In This Window.</p>
      )}
      <p className="stats-club-comparison-footnote">
        Club Hours Are Unavailable Because The Per-Club Facts Contract Does Not Retain Session
        Duration. Club History Begins At The First Preserved Club Fact.
      </p>
    </section>
  );
}
