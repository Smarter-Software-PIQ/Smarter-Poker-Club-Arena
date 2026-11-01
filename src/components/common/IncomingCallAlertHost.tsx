/**
 * INCOMING CALL ALERTS (Dan 2026-10-31)
 *
 * "THE ONLY TIME ANYTHING APPEARS IS ONLY IF YOU ARE INSIDE THE MESSENGER
 * WHILE THE CALL IS RINGING, ZERO NOTIFICATIONS ANYWHERE ELSE."
 *
 * Calls ring in the World Hub (its CallProvider). Club Arena is a separate
 * app with no call screen, and the production trace of the 20:50 UTC call
 * showed the callee had been at a Club Arena table just before it. The World
 * Hub now writes every ringing call as an `incoming_call` notification row;
 * the header data store's existing notifications channel hands it here.
 *
 * The alert stays for the ring window. Tapping it answers in the World Hub:
 * with live tables open the call opens in a "+" hub tab (HubFrame allows
 * camera and microphone and keeps every felt mounted), otherwise the page
 * goes to the call. The alert is removed when the row is deleted, which the
 * World Hub does once the call is answered, declined or over.
 */
import { useEffect, useRef } from 'react';
import { CALL_ALERT_CLEARED_EVENT, INCOMING_CALL_EVENT } from '../../stores/useHeaderDataStore';
import { masterBus } from '../../core/MasterBus';
import { useAuthUser } from '../../hooks/useAuthUser';
import { useToast } from './Toast';

export const CALL_ALERT_MS = 45000;

export interface IncomingCallAlert {
  id: string;
  roomName: string;
  callerName: string;
  callType: 'video' | 'voice';
}

/** Pure: the ringing call a notification row describes, or null. */
export function incomingCallFromRow(row: unknown): IncomingCallAlert | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { id?: unknown; type?: unknown; data?: Record<string, unknown> | null };
  const data = r.data || {};
  const roomName = typeof data.roomName === 'string' ? data.roomName : '';
  if (
    r.type !== 'incoming_call' ||
    typeof r.id !== 'string' ||
    !/^sp-call-[0-9a-z-]+$/i.test(roomName)
  ) {
    return null;
  }
  const callerName =
    typeof data.callerName === 'string' && data.callerName.trim()
      ? data.callerName.trim()
      : 'Someone';
  return {
    id: r.id,
    roomName,
    callerName,
    callType: data.callType === 'video' ? 'video' : 'voice',
  };
}

/** Pure: the World Hub page that answers this call as it opens. */
export function incomingCallAnswerPath(roomName: string): string {
  return `/hub/messenger?incomingCall=${encodeURIComponent(roomName)}&answer=1`;
}

export function incomingCallMessage(call: IncomingCallAlert): string {
  return `Incoming ${call.callType === 'video' ? 'Video' : 'Voice'} Call From ${call.callerName}. Tap To Answer`;
}

const liveTablesOpen = (): boolean =>
  typeof document !== 'undefined' && Number(document.body?.dataset.caLiveTables ?? '0') > 0;

export default function IncomingCallAlertHost() {
  const toast = useToast();
  const { user } = useAuthUser();
  const userId = user?.id;
  const shown = useRef(new Map<string, string>());

  useEffect(() => {
    const onCall = (event: Event) => {
      const call = incomingCallFromRow((event as CustomEvent).detail);
      if (!call || shown.current.has(call.id)) return;
      const path = incomingCallAnswerPath(call.roomName);
      const answer = () => {
        if (liveTablesOpen()) masterBus.emit('OPEN_HUB_TAB', { path, requestedBy: userId });
        else window.location.assign(path);
      };
      toast.info(incomingCallMessage(call), CALL_ALERT_MS, answer);
      const toastId = [...toast.getToasts()]
        .reverse()
        .find((t) => /tap to answer/i.test(t.message))?.id;
      shown.current.set(call.id, toastId || '');
      window.setTimeout(() => shown.current.delete(call.id), CALL_ALERT_MS + 5000);
    };
    const onCleared = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id || !shown.current.has(id)) return;
      const toastId = shown.current.get(id);
      if (toastId) toast.removeToast(toastId);
      shown.current.delete(id);
    };
    window.addEventListener(INCOMING_CALL_EVENT, onCall);
    window.addEventListener(CALL_ALERT_CLEARED_EVENT, onCleared);
    return () => {
      window.removeEventListener(INCOMING_CALL_EVENT, onCall);
      window.removeEventListener(CALL_ALERT_CLEARED_EVENT, onCleared);
    };
  }, [toast, userId]);

  return null;
}
