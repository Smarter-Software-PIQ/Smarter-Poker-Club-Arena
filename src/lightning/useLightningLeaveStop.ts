import { useEffect, useRef } from 'react';
import { reportError } from '../utils/errorReporter';
import { stopLightningPlaying, type LightningStopPlayingResult } from './lightningSessionApi';
import type { LightningPoolEntry } from './lightningSession';

/** Every Lightning leave door shares one durable stop before awaiting the anchor. */
export function useLightningLeaveStop(
  room: LightningPoolEntry | null,
  userId: string | null | undefined
) {
  const key = room && userId && userId !== 'guest' ? `${room.poolSessionId}/${userId}` : null;
  const current = useRef(key);
  current.current = key;
  const request = useRef<{
    key: string;
    result: Promise<LightningStopPlayingResult | null>;
  } | null>(null);
  useEffect(() => {
    current.current = key;
    return () => {
      current.current = null;
    };
  }, [key]);
  const receipt = async (): Promise<LightningStopPlayingResult | null> => {
    if (!room || !key || current.current !== key) return null;
    if (request.current?.key === key) return request.current.result;
    const result = stopLightningPlaying(room.clusterId).then(
      (out) => (out?.ok === true && current.current === key ? out : null),
      (error) => {
        reportError(error, 'LightningLeaveStop.stop');
        return null;
      }
    );
    request.current = { key, result };
    const ok = await result;
    if (!ok && request.current?.result === result) request.current = null;
    return ok;
  };
  /** A withdrawn stop (cancelled Leave Next Hand) must be sent again next time. */
  const stop = async () => !key || (await receipt())?.ok === true;
  return Object.assign(stop, {
    receipt,
    reset: () => {
      request.current = null;
    },
  });
}
