/**
 * The sender's short link for one hand (SharedHandLinkService).
 *
 * Reserved when the hand (or the Share sheet) opens, so a Link tap hands the
 * phone's share sheet a finished address at once. Until the reservation
 * answers, or if it fails, `url` is null and callers send the long link,
 * which always works. `markSent` is fire-and-forget; `revoke` stops sharing
 * and reserves a fresh token for the next share.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  markSharedHandSent,
  reserveSharedHand,
  revokeSharedHand,
  shortHandUrl,
  type SharedHandPreview,
} from '../services/SharedHandLinkService';

export interface SharedHandShortLink {
  url: string | null;
  token: string | null;
  sent: boolean;
  views: number;
  markSent: () => void;
  revoke: () => Promise<boolean>;
}

export function useSharedHandShortLink(
  payload: string | null,
  inviteCode: string | null,
  preview: SharedHandPreview | null,
  enabled: boolean
): SharedHandShortLink {
  const [state, setState] = useState<{ token: string; sent: boolean; views: number } | null>(null);
  const [generation, setGeneration] = useState(0);
  const previewKey = preview ? JSON.stringify(preview) : '';

  useEffect(() => {
    setState(null);
    if (!enabled || !payload) return;
    let cancelled = false;
    void reserveSharedHand(payload, inviteCode, preview ?? {})
      .then((r) => {
        if (!cancelled) setState(r);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
    // previewKey stands for preview: same facts, same reservation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, inviteCode, previewKey, enabled, generation]);

  const token = state?.token ?? null;

  const markSent = useCallback(() => {
    if (!token) return;
    setState((s) => (s ? { ...s, sent: true } : s));
    void markSharedHandSent(token).catch(() => {});
  }, [token]);

  const revoke = useCallback(async () => {
    if (!token) return false;
    const ok = await revokeSharedHand(token).catch(() => false);
    if (ok) setGeneration((g) => g + 1);
    return ok;
  }, [token]);

  return {
    url: token ? shortHandUrl(token) : null,
    token,
    sent: !!state?.sent,
    views: state?.views ?? 0,
    markSent,
    revoke,
  };
}
