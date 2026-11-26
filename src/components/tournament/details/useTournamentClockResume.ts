import { useEffect, useState } from 'react';
import type { Tournament } from '../../../types/database.types';

/** A break release and its credited level clock can arrive in separate row updates. */
export function useTournamentClockResume(
  tournament: Tournament,
  isRunning: boolean,
  eventPaused: boolean
): boolean {
  const [observedPause, setObservedPause] = useState<{
    id: string;
    index: number;
    anchor: number | null;
  } | null>(null);
  const clockAnchor = Date.parse(tournament.level_started_at || '');
  const clockIndex = Number(tournament.current_level);
  const pauseForThisEvent = observedPause?.id === tournament.id ? observedPause : null;
  const creditedClock = Boolean(
    pauseForThisEvent &&
    ((Number.isFinite(clockAnchor) &&
      (pauseForThisEvent.anchor === null || clockAnchor > pauseForThisEvent.anchor)) ||
      (Number.isInteger(clockIndex) && clockIndex > pauseForThisEvent.index))
  );
  // The engine clears on_break before it persists the resumed level anchor.
  // Hold an observed pause through that gap; neither deadline expiry nor a
  // global maintenance release can credit this tournament's clock.
  useEffect(() => {
    if (eventPaused) {
      setObservedPause({
        id: tournament.id,
        index: Number.isInteger(clockIndex) ? clockIndex : -1,
        anchor: Number.isFinite(clockAnchor) ? clockAnchor : null,
      });
    } else if (!isRunning || observedPause?.id !== tournament.id || creditedClock) {
      setObservedPause(null);
    }
  }, [eventPaused, tournament.id, clockIndex, clockAnchor, isRunning, creditedClock]);

  return isRunning && Boolean(pauseForThisEvent) && !creditedClock;
}
