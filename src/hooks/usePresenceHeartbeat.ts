/**
 * The signed-in player's presence heartbeat (src/lib/presenceHeartbeat.ts):
 * one beat on load, one every PRESENCE_HEARTBEAT_MS while the tab is
 * visible, one immediately when it becomes visible again, none while hidden.
 * Mounted ONCE, at the app root, as <PresenceHeartbeat /> (App.tsx,
 * src/components/common/PresenceHeartbeat.tsx).
 */
import { useEffect } from 'react';
import {
  isTerminalPresenceRefusal,
  PRESENCE_HEARTBEAT_MS,
  resumePresence,
  sendPresence,
  signalLeave,
} from '../lib/presenceHeartbeat';
import { isNativeAppActive, NATIVE_PAUSE_EVENT, NATIVE_RESUME_EVENT } from '../lib/nativeResume';
import { reportError } from '../utils/errorReporter';

const tabHidden = () =>
  !isNativeAppActive() ||
  (typeof document !== 'undefined' && document.visibilityState === 'hidden');

export function usePresenceHeartbeat(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;
    // A heartbeat starting for this user is a sign-in; a sign-out before it
    // silenced this account (src/lib/presenceHeartbeat.ts).
    resumePresence(userId);
    let stopped = false;
    // One report per run of failures, not one every two minutes while offline.
    let failing = false;
    let beatInFlight = false;
    /* Held in a box so a terminal refusal inside beat() can stop the interval
       that is created after the first beat. */
    const interval: { id?: ReturnType<typeof setInterval> } = {};

    const beat = () => {
      if (stopped || tabHidden()) return;
      if (beatInFlight) return;
      beatInFlight = true;
      sendPresence(userId, true).then(
        () => {
          beatInFlight = false;
          failing = false;
        },
        (e) => {
          beatInFlight = false;
          // A closed account or a revoked session: no later beat can land,
          // so this mount stops beating (src/lib/presenceHeartbeat.ts).
          if (isTerminalPresenceRefusal(e)) {
            stopped = true;
            if (interval.id !== undefined) clearInterval(interval.id);
            return;
          }
          if (!failing) reportError(e, 'presenceHeartbeat.beat');
          failing = true;
        }
      );
    };
    const onVisibility = () => {
      if (!tabHidden()) beat();
    };
    const onLeave = () => {
      if (stopped) return;
      signalLeave(userId);
    };

    beat();
    interval.id = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    window.addEventListener(NATIVE_RESUME_EVENT, onVisibility);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener(NATIVE_PAUSE_EVENT, onLeave);
    return () => {
      stopped = true;
      if (interval.id !== undefined) clearInterval(interval.id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      window.removeEventListener(NATIVE_RESUME_EVENT, onVisibility);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener(NATIVE_PAUSE_EVENT, onLeave);
    };
  }, [userId]);
}
