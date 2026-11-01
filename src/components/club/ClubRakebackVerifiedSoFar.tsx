/**
 * VERIFIED SO FAR (owner, 2026-10-31: "live verified so far" in Club Data and
 * "these numbers accumulate daily"). The club's running tally for the current
 * accounting week, read by fn_club_rakeback_verified_so_far: every cash and
 * tournament rake source recorded so far, per player and in total, an ESTIMATE
 * of player rakeback at the rate in effect when each hand was played, how many
 * of the week's two-hour windows the close has proved, the last close and the
 * last paid week. The tally sums each completed recording hour once; when the
 * week is not fully counted yet, this keeps asking (one call at a time) until it
 * is, and says how far it has counted instead of showing a partial number as the
 * week. Viewers without whole-club access see nothing (the server refuses).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { compactChips } from '../../utils/format';
import { reportError } from '../../utils/errorReporter';
import { isAuthzError } from '../../utils/clubDashboard';
import './ClubRakebackVerifiedSoFar.css';

export interface VerifiedPlayer {
  player_id: string;
  player_name: string | null;
  rake_recorded: number;
  cash_rake: number;
  tournament_rake: number;
  sources: number;
  estimated_rakeback: number;
  last_recorded_at: string | null;
}
export interface VerifiedSoFar {
  week_start: string;
  week_end: string;
  paid_at: string;
  tally: {
    complete: boolean;
    counted_through: string;
    live_through: string | null;
    hours_counted: number;
    hours_settled: number;
  };
  totals: {
    players: number;
    sources: number;
    cash_rake: number;
    tournament_rake: number;
    rake_recorded: number;
    estimated_player_rakeback: number;
    last_recorded_at: string | null;
  };
  players: VerifiedPlayer[];
  windows: {
    proved: Record<string, number>;
    elapsed: number;
    per_week: number;
    proved_after: string;
  };
  last_close: { period_start: string; period_end: string; status: string } | null;
  last_paid_week: {
    period_start: string;
    period_end: string;
    players: number;
    paid: number;
    paid_at: string;
  } | null;
}

/** Calls in one sitting while the tally counts the week's completed hours. */
export const MAX_COUNTING_CALLS = 60;
const SHOWN = 25;

const when = (iso: string | null | undefined, withDay = true) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, {
        ...(withDay ? { weekday: 'short' as const } : {}),
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
        timeZoneName: 'short',
      });
};

export function ClubRakebackVerifiedSoFar({ clubId }: { clubId: string }) {
  const [data, setData] = useState<VerifiedSoFar | null>(null);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const run = useRef(0);

  const load = useCallback(async () => {
    const mine = ++run.current;
    setFailed(false);
    try {
      for (let call = 0; call < MAX_COUNTING_CALLS; call++) {
        const { data: answer, error } = await supabase.rpc('fn_club_rakeback_verified_so_far', {
          p_club_id: clubId,
        });
        if (mine !== run.current) return;
        if (error) throw error;
        const next = answer as VerifiedSoFar;
        setData(next);
        if (next.tally.complete) return;
      }
    } catch (err) {
      if (mine !== run.current) return;
      if (isAuthzError(err)) {
        setHidden(true);
        return;
      }
      reportError(err, 'ClubRakebackVerifiedSoFar.load');
      setFailed(true);
    }
  }, [clubId]);

  useEffect(() => {
    void load();
    return () => {
      run.current++;
    };
  }, [load]);

  if (hidden) return null;
  if (!data) {
    return failed ? (
      <section className="club-verified" aria-label="Rakeback Verified So Far">
        <h3>Rakeback Verified So Far</h3>
        <p className="club-verified__note">This Week Is Unavailable Right Now.</p>
        <button type="button" className="club-verified__more" onClick={() => void load()}>
          Try Again
        </button>
      </section>
    ) : null;
  }

  const { totals, tally, windows } = data;
  const proved =
    windows && Object.values(windows.proved).length
      ? Math.min(
          ...['earned_plan_window', 'round2_union_window', 'round3_union_window'].map(
            (k) => windows.proved[k] ?? 0
          )
        )
      : 0;
  const players = showAll ? data.players : data.players.slice(0, SHOWN);

  return (
    <section className="club-verified" aria-label="Rakeback Verified So Far">
      <h3>Rakeback Verified So Far</h3>
      <p className="club-verified__note">
        Week Of {when(data.week_start, false)} To {when(data.week_end, false)}. Paid{' '}
        {when(data.paid_at)}. Estimated From Every Raked Hand Recorded So Far At The Rate In Effect
        When It Was Played; The Paid Amount Is Computed At The Close.
      </p>
      {!tally.complete && (
        <p className="club-verified__counting" role="status" aria-live="polite">
          Counting The Week: {tally.hours_counted} Of {tally.hours_settled} Hours Counted, Through{' '}
          {when(tally.counted_through)}.
        </p>
      )}
      {failed && (
        <p className="club-verified__counting" role="status">
          Counting Paused.{' '}
          <button type="button" className="club-verified__more" onClick={() => void load()}>
            Continue
          </button>
        </p>
      )}
      <dl className="club-verified__totals">
        <div>
          <dt>Rake Recorded</dt>
          <dd>{compactChips(Number(totals.rake_recorded))}</dd>
        </div>
        <div>
          <dt>Cash / Tournament</dt>
          <dd>
            {compactChips(Number(totals.cash_rake))} /{' '}
            {compactChips(Number(totals.tournament_rake))}
          </dd>
        </div>
        <div>
          <dt>Estimated Player Rakeback</dt>
          <dd>{compactChips(Number(totals.estimated_player_rakeback))}</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd>{Number(totals.players)}</dd>
        </div>
        {windows && (
          <div>
            <dt>Windows Proved</dt>
            <dd>
              {proved} Of {windows.per_week}
              {proved === 0 ? ' (Proved After The Week Ends)' : ''}
            </dd>
          </div>
        )}
        {data.last_paid_week && (
          <div>
            <dt>Last Week Paid</dt>
            <dd>
              {compactChips(Number(data.last_paid_week.paid))} To{' '}
              {Number(data.last_paid_week.players)} Players
            </dd>
          </div>
        )}
        {data.last_close && (
          <div>
            <dt>Last Close</dt>
            <dd>{data.last_close.status === 'complete' ? 'Complete' : 'In Progress'}</dd>
          </div>
        )}
      </dl>
      {players.length > 0 && (
        <table className="club-verified__players">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Rake Recorded</th>
              <th scope="col">Estimated Rakeback</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.player_id}>
                <td>{p.player_name || 'Player'}</td>
                <td>{compactChips(Number(p.rake_recorded))}</td>
                <td>{compactChips(Number(p.estimated_rakeback))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.players.length > SHOWN && (
        <button type="button" className="club-verified__more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show Top Players' : `Show All ${data.players.length} Players`}
        </button>
      )}
    </section>
  );
}

export default ClubRakebackVerifiedSoFar;
