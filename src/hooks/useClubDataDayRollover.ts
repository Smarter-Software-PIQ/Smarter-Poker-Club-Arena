import { useEffect, useRef } from 'react';
import {
  addCalendarDays,
  clubDataDayOn,
  clubDataDayStart,
  type ClubDataDayBasis,
} from '../lib/clubDataDay';

/** Advance the open reporting day at its real midnight, also after a sleeping tab wakes. */
export function useClubDataDayRollover(basis: ClubDataDayBasis, onDay: (day: string) => void) {
  const notify = useRef(onDay);
  notify.current = onDay;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      const day = clubDataDayOn(basis, now);
      notify.current(day);
      const next = clubDataDayStart(addCalendarDays(day, 1), basis);
      if (next) timer = setTimeout(refresh, Math.max(1, next.getTime() - now.getTime() + 1));
    };
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [basis]);
}
