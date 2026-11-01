/**
 * THIS WEEK SO FAR / SUNDAY PREVIEW (owner, 2026-10-31). The player's own rake
 * recorded this week in each club, the rate in effect now, and an ESTIMATE of
 * the rakeback the Monday close will pay (each recorded rake at the rate in
 * effect when it was played). Read by fn_my_rakeback_week_so_far, bound to the
 * caller. The paid amount is computed at the Monday close, never here.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { compactChips } from '../../utils/format';
import { reportError } from '../../utils/errorReporter';

interface WeekClub {
  club_id: string;
  club_name: string | null;
  rake_recorded: number;
  cash_rake: number;
  tournament_rake: number;
  estimated_rakeback: number;
  current_rate_pct: number;
  last_recorded_at: string | null;
}
interface WeekSoFar {
  week_start: string;
  week_end: string;
  paid_at: string;
  clubs: WeekClub[];
}

const payday = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, {
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
        timeZoneName: 'short',
      });
};

export function RakebackWeekSoFar() {
  const [data, setData] = useState<WeekSoFar | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: answer, error } = await supabase.rpc('fn_my_rakeback_week_so_far');
      if (error) throw error;
      setData(answer as WeekSoFar);
      setFailed(false);
    } catch (err) {
      reportError(err, 'RakebackWeekSoFar.load');
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <section className="rakeback-week" aria-label="Rakeback This Week">
        <h3>Rakeback This Week</h3>
        <p>This Week Is Unavailable Right Now.</p>
      </section>
    );
  }
  if (!data) return null;
  if (data.clubs.length === 0) {
    return (
      <section className="rakeback-week" aria-label="Rakeback This Week">
        <h3>Rakeback This Week</h3>
        <p>No Raked Hands Recorded For You This Week Yet.</p>
      </section>
    );
  }
  return (
    <section className="rakeback-week" aria-label="Rakeback This Week">
      <h3>Rakeback This Week So Far</h3>
      <p className="rakeback-week__note">
        Estimated From Every Raked Hand Recorded So Far At The Rate In Effect When It Was Played.
        Paid {payday(data.paid_at)}; The Paid Amount Is Computed Then.
      </p>
      <ul>
        {data.clubs.map((club) => (
          <li key={club.club_id}>
            <span className="rakeback-week__club">{club.club_name || 'Club'}</span>
            <span>Rake Recorded {compactChips(Number(club.rake_recorded))}</span>
            <span>Rate Now {Number(club.current_rate_pct)}%</span>
            <strong>Estimated Rakeback {compactChips(Number(club.estimated_rakeback))}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default RakebackWeekSoFar;
