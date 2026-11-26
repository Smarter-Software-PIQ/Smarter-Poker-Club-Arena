import { lazy, Suspense } from 'react';
import { CHIP_STATS } from '../../services/statsScope';
import { titleCase } from '../../utils/titleCase';
import {
  CLUB_SORTS,
  type ClubComparisonRow,
  type ClubComparisonSort,
  type StatsClubOption,
} from './playerStatsPageModel';

const ClubComparisonTable = lazy(() => import('./ClubComparisonTable'));

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
                  aria-controls="stats-club-comparison"
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
        <section
          className="stats-club-comparison"
          id="stats-club-comparison"
          aria-labelledby="stats-club-comparison-title"
        >
          <div className="stats-club-comparison-head">
            <div>
              <span className="stats-section-kicker">One Read // Every Authorized Club</span>
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
          {comparisonLoading && (
            <div className="stats-section-loading">Loading Club Ledgers...</div>
          )}
          {comparisonError && (
            <div className="stats-notice stats-notice-warn" role="alert">
              Club Comparison Could Not Be Loaded.{' '}
              <button type="button" className="hand-retry" onClick={onRetryComparison}>
                Try Again
              </button>
            </div>
          )}
          {!comparisonLoading && !comparisonError && sortedComparisonRows.length > 0 && (
            <Suspense
              fallback={
                <div className="stats-section-loading" role="status">
                  Loading Club Ledgers...
                </div>
              }
            >
              <ClubComparisonTable
                rows={sortedComparisonRows}
                tournament={tournament}
                changeClub={changeClub}
              />
            </Suspense>
          )}
          <p className="stats-club-comparison-footnote">
            Club Hours Are Unavailable Because The Per-Club Facts Contract Does Not Retain Session
            Duration. Club History Begins At The First Preserved Club Fact.
          </p>
        </section>
      )}
    </>
  );
}
