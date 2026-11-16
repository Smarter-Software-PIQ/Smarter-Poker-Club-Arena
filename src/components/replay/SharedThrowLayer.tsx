import { useCallback, useEffect, useRef, useState } from 'react';
import { ThrowAnimationContainer } from '../table/ThrowAnimation';
import { throwableService, type ThrowEvent } from '../../services/ThrowableService';
import type { SharedThrow } from '../../lib/sharedThrows';

/** Playback only: dispatch the already displayed art directly to the same animation layer. */
export function SharedThrowLayer({
  throws,
  positions,
  playing,
  rate,
  offset,
}: {
  throws: SharedThrow[];
  positions: Map<number, { x: number; y: number }>;
  playing: boolean;
  rate: number;
  offset: number;
}) {
  const [active, setActive] = useState<ThrowEvent[]>([]);
  const playhead = useRef(offset);
  playhead.current = offset;
  useEffect(() => {
    setActive([]);
    if (!playing) return;
    const start = playhead.current;
    const timers = throws.flatMap(([at, fromSeat, toSeat, item, seed], index) => {
      if (at < start) return [];
      const throwable = throwableService.getThrowableById(item);
      if (!throwable) return [];
      return [
        setTimeout(
          () => {
            setActive((previous) => [
              ...previous,
              {
                id: 'shared-' + index,
                throwableId: item,
                throwable,
                fromSeat,
                toSeat,
                particleSeed: seed,
                timestamp: Date.now(),
              },
            ]);
          },
          (at - start) / rate
        ),
      ];
    });
    return () => timers.forEach(clearTimeout);
  }, [throws, playing, rate]);
  const complete = useCallback(
    (id: string) => setActive((previous) => previous.filter((e) => e.id !== id)),
    []
  );
  return (
    <ThrowAnimationContainer events={active} seatPositions={positions} onEventComplete={complete} />
  );
}
