import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { ChipAnimationManager, type ChipAnimationEvent } from '../table/ChipAnimation';
import { replayChip, type SharedChip } from '../../lib/sharedChipFlights';

export function RecordedChips({
  chips,
  scaler,
  offset,
  playing,
  rate,
}: {
  chips: SharedChip[];
  scaler: RefObject<HTMLDivElement | null>;
  offset: number;
  playing: boolean;
  rate: number;
}) {
  const [active, setActive] = useState<ChipAnimationEvent[]>([]);
  const cursor = useRef(offset);
  cursor.current = offset;
  useEffect(() => {
    setActive([]);
    if (!playing) return;
    const start = cursor.current;
    const epoch = performance.now() - start / rate;
    let i = chips.findIndex((chip) => chip[0] >= start);
    if (i < 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      if (i === chips.length) return;
      const at = chips[i][0];
      timer = setTimeout(
        () => {
          const rect = scaler.current?.getBoundingClientRect();
          const batch: ChipAnimationEvent[] = [];
          do {
            if (rect) batch.push(replayChip(chips[i], 'shared-chip-' + i, rect, rate));
            i++;
          } while (i < chips.length && chips[i][0] === at);
          setActive((items) => [...items, ...batch]);
          schedule();
        },
        Math.max(0, epoch + at / rate - performance.now())
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [chips, playing, rate, scaler]);
  const remove = useCallback(
    (id: string) => setActive((items) => items.filter((e) => e.id !== id)),
    []
  );
  return (
    <ChipAnimationManager animations={active} playbackRate={rate} onAnimationComplete={remove} />
  );
}
