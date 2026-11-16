import { useEffect, useRef, useState } from 'react';
import type { SeatPaintEvent } from '../../lib/sharedSeatPresentation';

/** Apply each committed display change on its own sender-clock deadline, including between actions. */
export function useRecordedSeats(
  events: SeatPaintEvent[] | undefined,
  offset: number,
  playing: boolean,
  rate: number
) {
  const [seats, setSeats] = useState<Record<number, SeatPaintEvent>>({});
  const cursor = useRef(offset);
  cursor.current = offset;
  useEffect(() => {
    if (!events) {
      setSeats({});
      return;
    }
    const from = cursor.current;
    const epoch = performance.now() - from / rate;
    let i = 0;
    const painted: Record<number, SeatPaintEvent> = {};
    function advance(now: number) {
      while (i < events!.length && events![i][0] <= now) {
        const change = events![i++];
        painted[change[1]] = change;
      }
      setSeats({ ...painted });
    }
    advance(from);
    if (!playing) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      if (i >= events.length) return;
      const deadline = epoch + events[i][0] / rate;
      timer = setTimeout(
        () => {
          advance(Math.max(events[i][0], (performance.now() - epoch) * rate));
          schedule();
        },
        Math.max(0, deadline - performance.now())
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [events, rate, playing, playing ? null : offset]);
  return seats;
}
