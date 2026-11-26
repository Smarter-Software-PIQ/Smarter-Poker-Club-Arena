import { lazy, Suspense } from 'react';
import { CHIP_STATS } from '../../services/statsScope';
import { titleCase } from '../../utils/titleCase';
import {
  type ClubComparisonRow,
  type ClubComparisonSort,
  type StatsClubOption,
} from './playerStatsPageModel';

const ClubComparisonPanel = lazy(() => import('./ClubComparisonTable'));

interface Props {
  gameMode?: 'cash' | 'tournament';
  statsScope: string;
  clubLabel: string;
  selectedClub?: StatsClubOption | null;
  selectedClubId: string | null;
  changeClub: (clubId: string | null) => void;
  clubs: StatsClubOption[];
  clubsLoading: boolean;
  clubsError: boolean;
  onRetryClubs: () => void;
  comparisonOpen: boolean;
  setComparisonOpen: (open: boolean) => void;
  onRetryComparison: () => void;
  comparisonSort: ClubComparisonSort;
  changeComparisonSort: (sort: ClubComparisonSort) => void;
  comparisonLoading: boolean;
  comparisonError: boolean;
  sortedComparisonRows: ClubComparisonRow[];
}

export default function ClubScopeConsole(props: Props) {
  const {
    statsScope,
    clubLabel,
    selectedClub,
    selectedClubId,
    changeClub,
    clubs,
    clubsLoading,
    clubsError,
    onRetryClubs,
    comparisonOpen,
    setComparisonOpen,
    onRetryComparison,
    comparisonSort,
    changeComparisonSort,
    comparisonLoading,
    comparisonError,
    sortedComparisonRows,
  } = props;
  const tournament = props.gameMode === 'tournament';
  return (
    <>
      {statsScope === CHIP_STATS && (
        <section className="stats-club-command" aria-labelledby="stats-club-scope-title">
          <img
            src={`${import.meta.env.BASE_URL}images/stats/player-intelligence-console-v1.webp`}
            alt=""
            aria-hidden="true"
            loading="eager"
          />
          <div className="stats-club-command-copy">
            <span className="stats-section-kicker">Authorized Club Ledger</span>
            <h2 id="stats-club-scope-title">{titleCase(clubLabel)}</h2>
            <p>
              {selectedClub
                ? 'Every Readout Below Is Restricted To This Club.'
                : 'All Clubs Uses Recorded Hands In The Selected Game Mode.'}
            </p>
            <div className="stats-club-selector" role="group" aria-label="Statistics Club">
              <button
                type="button"
                aria-pressed={!selectedClubId}
                className={!selectedClubId ? 'active' : ''}
                onClick={() => changeClub(null)}
              >
                All Clubs
              </button>
              {clubs.map((club) => (
                <button
                  type="button"
                  key={club.id}
                  aria-pressed={selectedClubId === club.id}
                  className={selectedClubId === club.id ? 'active' : ''}
                  onClick={() => changeClub(club.id)}
                >
                  {titleCase(club.name)}
                </button>
              ))}
            </div>
            <div className="stats-club-actions">
              {clubsLoading && <span role="status">Loading Club Access...</span>}
              {clubsError && (
                <span role="alert">
                  Club Access Could Not Be Loaded.
                  <button type="button" onClick={onRetryClubs}>
                    Retry Club Access
                  </button>
                </span>
              )}
              {clubs.length > 1 && (
                <button
                  type="button"
                  aria-expanded={comparisonOpen}
                  aria-controls={comparisonOpen ? 'stats-club-comparison' : undefined}
                  onClick={() => {
                    const next = !comparisonOpen;
                    setComparisonOpen(next);
                  }}
                >
                  {comparisonOpen ? 'Close Club Comparison' : 'Compare Clubs'}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {comparisonOpen && (
        <Suspense
          fallback={
            <div id="stats-club-comparison" className="stats-section-loading" role="status">
              Loading Club Ledgers...
            </div>
          }
        >
          <ClubComparisonPanel
            tournament={tournament}
            changeClub={changeClub}
            onRetryComparison={onRetryComparison}
            comparisonSort={comparisonSort}
            changeComparisonSort={changeComparisonSort}
            comparisonLoading={comparisonLoading}
            comparisonError={comparisonError}
            sortedComparisonRows={sortedComparisonRows}
          />
        </Suspense>
      )}
    </>
  );
}
