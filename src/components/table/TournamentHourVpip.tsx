import { useEffect, useState } from 'react';
import './TournamentBreakScreen.css';
import { serverNow } from '../../utils/serverClock';
import { subscribeTournamentStandings } from '../../services/tournamentStandingsUpdates';
import {
  readTournamentHourVpip,
  tournamentHourVpip,
  type TournamentVpipHand,
} from '../../services/readTournamentHourVpip';

export function TournamentHourVpip({
  tournamentId,
  userId,
}: {
  tournamentId: string;
  userId: string;
}) {
  const scope = JSON.stringify([tournamentId, userId]);
  const [sample, setSample] = useState<{
    scope: string;
    hands: TournamentVpipHand[] | null;
  } | null>(null);
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let pending = false;
    setSample(null);
    const read = async () => {
      if (!active) return;
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      pending = false;
      const hands = await readTournamentHourVpip(tournamentId, userId, serverNow());
      inFlight = false;
      if (!active) return;
      if (pending) {
        void read();
        return;
      }
      setNow(serverNow());
      setSample({ scope, hands });
    };
    const stop = subscribeTournamentStandings(tournamentId, () => void read());
    void read();
    return () => {
      active = false;
      stop();
    };
  }, [tournamentId, userId, scope]);
  const current = sample?.scope === scope ? sample : null;
  const result = current?.hands ? tournamentHourVpip(current.hands, now) : null;
  const expiresAt = result?.expiresAt;
  useEffect(() => {
    if (expiresAt == null) return;
    // Expire the sample at its actual rolling boundary without database polling.
    const timer = setTimeout(() => setNow(serverNow()), Math.max(1, expiresAt - serverNow()));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  return (
    <div className="break-screen__vpip" aria-label="Your VPIP (Last Hour)">
      <span className="break-screen__section-title">Your VPIP (Last Hour)</span>
      <span className="break-screen__my-stack">
        {!current
          ? 'Loading...'
          : !result
            ? 'Unavailable'
            : result.percent === null
              ? 'No Recorded Hands'
              : `${result.percent.toFixed(1)}%`}
        {result && result.hands > 0 && (
          <small>
            {result.hands.toLocaleString('en-US')} Settled {result.hands === 1 ? 'Hand' : 'Hands'}
          </small>
        )}
      </span>
    </div>
  );
}
