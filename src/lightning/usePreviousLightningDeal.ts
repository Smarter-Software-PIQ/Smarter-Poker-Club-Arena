import { useEffect, useRef, useState } from 'react';
import { isLightningIdleSnapshot, type LightningSnapshotFields } from './lightningHand';

interface Deal {
  scope: string;
  number: number;
}

/** An early folder can move on before the old table has a history record. */
export function usePreviousLightningDeal(
  room: string | null | undefined,
  viewer: string,
  snapshot: LightningSnapshotFields | null | undefined
) {
  const scope = JSON.stringify([room, viewer]);
  const last = useRef<Deal | null>(null);
  const [previous, setPrevious] = useState<Deal | null>(null);
  useEffect(() => {
    last.current = null;
    setPrevious(null);
  }, [scope]);
  useEffect(() => {
    if (!room || !snapshot) return;
    const number = Number(snapshot.hand_number);
    const idle = isLightningIdleSnapshot(snapshot);
    const hero = Array.isArray(snapshot.players)
      ? snapshot.players.find((player) => player?.user_id === viewer)
      : undefined;
    let deal = last.current?.scope === scope ? last.current : null;
    if (deal && number > 0 && number < deal.number) return;
    if (deal && (idle || (hero && number > deal.number))) setPrevious(deal);
    if (idle || !hero || !Number.isSafeInteger(number) || number <= 0) return;
    if (deal?.number !== number) deal = { scope, number };
    last.current = deal;
    if (hero.is_folded) setPrevious(deal);
  }, [scope, room, viewer, snapshot]);
  return previous?.scope === scope ? previous : null;
}
