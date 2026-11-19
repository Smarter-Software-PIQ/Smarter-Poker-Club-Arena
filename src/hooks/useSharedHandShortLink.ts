/**
 * The sender's short link for one hand (SharedHandLinkService).
 *
 * Reserved when the hand (or the Share sheet) opens, so a Link tap hands the
 * phone's share sheet a finished address at once. `markSent` is
 * fire-and-forget; `revoke` stops sharing and reserves a fresh token for the
 * next share.
 *
 * A SHARE NEVER SENDS THE LONG LINK WHILE THE SHORT ONE IS ON ITS WAY
 * (Dan 2026-11-18). `url` used to be null from the instant the payload
 * changed until the reservation answered, and every caller read null as
 * "send the long link". A hand shared while its recording was still being
 * written changes payload several times in a few seconds (three reservations
 * in ten seconds were measured), so the sheet kept dropping back to a link
 * thousands of characters long even though every reservation succeeded.
 *
 * `pending` now says a reservation is in flight, callers wait for it
 * (`ready()`), and one failed reservation is tried again. Only a reservation
 * that has really failed, or not answered within the ceiling, leaves `url`
 * null with `pending` false; that is the one case the long link is for.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  markSharedHandSent,
  reserveSharedHand,
  revokeSharedHand,
  shortHandUrl,
  type ReservedShortLink,
  type SharedHandPreview,
} from '../services/SharedHandLinkService';

/** One more try after a reservation that failed outright. */
export const SHORT_LINK_RETRY_MS = 250;
/** A reservation that has not answered by now is treated as failed. */
export const SHORT_LINK_CEILING_MS = 8000;

export interface SharedHandShortLink {
  url: string | null;
  token: string | null;
  /** A reservation for this exact hand is in flight: wait, do not send the long link. */
  pending: boolean;
  sent: boolean;
  views: number;
  markSent: () => void;
  revoke: () => Promise<boolean>;
  /** The short link once the reservation in flight settles; null if it failed. */
  ready: () => Promise<string | null>;
}

interface Settled {
  key: string;
  link: { token: string; sent: boolean; views: number } | null;
}

export function useSharedHandShortLink(
  payload: string | null,
  inviteCode: string | null,
  preview: SharedHandPreview | null,
  enabled: boolean
): SharedHandShortLink {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [generation, setGeneration] = useState(0);
  const previewKey = preview ? JSON.stringify(preview) : '';
  const active = enabled && !!payload;
  const key = active ? `${generation}|${inviteCode ?? ''}|${previewKey}|${payload}` : '';
  const inFlight = useRef<{ key: string; done: Promise<ReservedShortLink | null> } | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !payload) {
      inFlight.current = null;
      tokenRef.current = null;
      return;
    }
    tokenRef.current = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ceilingTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (ceilingTimer !== null) {
        clearTimeout(ceilingTimer);
        ceilingTimer = null;
      }
    };
    const attempt = () => reserveSharedHand(payload, inviteCode, preview ?? {}).catch(() => null);
    const reserved = attempt().then((first) => {
      if (first || cancelled) return first;
      return new Promise<ReservedShortLink | null>((resolve) => {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          resolve(cancelled ? null : attempt());
        }, SHORT_LINK_RETRY_MS);
      });
    });
    const ceiling = new Promise<null>((resolve) => {
      ceilingTimer = setTimeout(() => {
        ceilingTimer = null;
        resolve(null);
      }, SHORT_LINK_CEILING_MS);
    });
    const done = Promise.race([reserved, ceiling]).then((link) => {
      clearTimers();
      if (!cancelled) {
        tokenRef.current = link?.token ?? null;
        setSettled({ key, link });
      }
      return link;
    });
    inFlight.current = { key, done };
    return () => {
      cancelled = true;
      clearTimers();
    };
    // `key` stands for payload, invite, preview and generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = active && settled?.key === key ? settled.link : null;
  const pending = active && settled?.key !== key;
  const token = current?.token ?? null;
  if (token) tokenRef.current = token;

  const markSent = useCallback(() => {
    const activeToken = tokenRef.current;
    if (!activeToken) return;
    setSettled((s) =>
      s?.link && s.link.token === activeToken ? { ...s, link: { ...s.link, sent: true } } : s
    );
    void markSharedHandSent(activeToken).catch(() => {});
  }, []);

  const revoke = useCallback(async () => {
    const activeToken = tokenRef.current;
    if (!activeToken) return false;
    const ok = await revokeSharedHand(activeToken).catch(() => false);
    if (ok) {
      tokenRef.current = null;
      setGeneration((g) => g + 1);
    }
    return ok;
  }, []);

  const ready = useCallback(async (): Promise<string | null> => {
    if (token) return shortHandUrl(token);
    const flight = inFlight.current;
    if (!flight || flight.key !== key) return null;
    const link = await flight.done;
    return link ? shortHandUrl(link.token) : null;
  }, [token, key]);

  return {
    url: token ? shortHandUrl(token) : null,
    token,
    pending,
    sent: !!current?.sent,
    views: current?.views ?? 0,
    markSent,
    revoke,
    ready,
  };
}
