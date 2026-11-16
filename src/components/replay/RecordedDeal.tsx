import { useMemo } from 'react';
import { DealFlight } from '../table/DealAnimation';
import type { SharedDeal } from '../../lib/sharedDeal';

export function RecordedDeal({
  deal,
  playing,
  offset,
  rate,
}: {
  deal: SharedDeal;
  playing: boolean;
  offset: number;
  rate: number;
}) {
  const frame = useMemo(
    () => ({
      id: 1,
      handNumber: 0,
      flightMs: deal.flightMs,
      cards: deal.paths.map(([originX, originY, targetX, targetY, delay], index) => ({
        id: String(index),
        originX,
        originY,
        targetX,
        targetY,
        delay,
      })),
    }),
    [deal]
  );
  // During continuous playback CSS advances each path from the same origin.
  const origin = useMemo(() => offset, [deal, playing, rate, playing ? null : offset]);
  if (origin > deal.at + deal.flightMs + Math.max(...deal.paths.map((path) => path[4])))
    return null;
  return (
    <DealFlight
      key={origin + '/' + rate + '/' + playing}
      frame={frame}
      startOffset={origin - deal.at}
      rate={rate}
      paused={!playing}
    />
  );
}
