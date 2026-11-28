import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DiamondReplayService, type BonusReplay } from '../../services/DiamondReplayService';
import { reportError } from '../../utils/errorReporter';
import BonusReplayPlayer from '../../components/games/BonusReplayPlayer';
import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import '../../components/ops/ArenaOps.css';
import './SharedBonusReplayPage.css';

export default function SharedBonusReplayPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const [replay, setReplay] = useState<BonusReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReplay(null);
    setError(null);
    DiamondReplayService.read(shareId ?? '', true)
      .then((value) => {
        if (active) setReplay(value);
      })
      .catch((e) => {
        reportError(e, 'SharedBonusReplayPage');
        if (active) setError(e instanceof Error ? e.message : 'Replay Could Not Be Loaded');
      });
    return () => {
      active = false;
    };
  }, [shareId, attempt]);
  return (
    <main className="arena-workspace bonus-replay-workspace">
      <div className="bonus-replay-shell">
        <div className="arena-switch arena-ops-keys bonus-replay-nav">
          <Link to="/" className="bonus-replay-back">
            Smarter.Poker Club Arena
          </Link>
        </div>
        <ArenaWorkspaceHeader
          area="handreview"
          title="Bonus Replay"
          summary="Watch A Recorded Diamond Bonus Replay From Smarter Poker."
        />
        <section className="arena-case arena-ops-case bonus-replay-case">
          {replay ? (
            <BonusReplayPlayer key={shareId} replay={replay} />
          ) : error ? (
            <div className="bonus-replay-state">
              <p role="alert" className="bonus-replay-error">
                {error}
              </p>
              <div className="arena-switch arena-ops-keys arena-ops-primary bonus-replay-actions">
                <button
                  className="bonus-replay-retry"
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : (
            <p role="status" className="bonus-replay-status">
              Loading Bonus Replay
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
