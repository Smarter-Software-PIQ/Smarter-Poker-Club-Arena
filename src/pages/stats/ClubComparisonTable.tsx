import { compactChips } from '../../utils/format';
import { titleCase } from '../../utils/titleCase';
import { NOT_YET_MEASURED } from './format';
import type { ClubComparisonRow } from './playerStatsPageModel';

interface Props {
  rows: ClubComparisonRow[];
  tournament: boolean;
  changeClub: (clubId: string | null) => void;
}

export default function ClubComparisonTable({ rows, tournament, changeClub }: Props) {
  return (
    <div className="stats-club-table-wrap">
      <table className="stats-club-table">
        <thead>
          <tr>
            <th scope="col">Club</th>
            <th scope="col">Hands</th>
            {!tournament && <th scope="col">Profit</th>}
            {!tournament && <th scope="col">BB/100</th>}
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
              <td>{row.hands.toLocaleString()}</td>
              {!tournament && (
                <>
                  <td className={row.profit >= 0 ? 'positive' : 'negative'}>
                    {row.profit >= 0 ? '+' : ''}
                    {compactChips(row.profit)}
                  </td>
                  <td>{row.hands ? row.bb100.toFixed(1) : NOT_YET_MEASURED}</td>
                </>
              )}
              <td>{row.hands ? `${(row.vpip * 100).toFixed(1)}%` : NOT_YET_MEASURED}</td>
              <td>{row.hands ? `${(row.pfr * 100).toFixed(1)}%` : NOT_YET_MEASURED}</td>
              <td>{row.hours === null ? 'Unavailable' : row.hours.toFixed(1)}</td>
              {!tournament && <td>{compactChips(row.rake)}</td>}
              {tournament && (
                <td>
                  {row.tournamentEntries.toLocaleString()} Entries //{' '}
                  {row.tournamentCashes.toLocaleString()} Cashes //{' '}
                  {row.tournamentWins.toLocaleString()} Wins //{' '}
                  {compactChips(row.tournamentWinnings)} Won
                </td>
              )}
              <td>
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
