/**
 * The signed-in player's presence heartbeat (src/lib/presenceHeartbeat.ts):
 * one beat on load, one every PRESENCE_HEARTBEAT_MS while the tab is
 * visible, one immediately when it becomes visible again, none while hidden.
 * Mounted ONCE, at the app root, as <PresenceHeartbeat /> (App.tsx,
 * src/components/common/PresenceHeartbeat.tsx).
 */
import { useEffect } from 'react';
import { PRESENCE_HEARTBEAT_MS, resumePresence, sendPresence } from '../lib/presenceHeartbeat';
import { isNativeAppActive, NATIVE_RESUME_EVENT } from '../lib/nativeResume';
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
          if (!failing) reportError(e, 'presenceHeartbeat.beat');
          failing = true;
        }
      );
    };
    const onVisibility = () => {
      if (!tabHidden()) beat();
    };

    beat();
    const timer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    window.addEventListener(NATIVE_RESUME_EVENT, onVisibility);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      window.removeEventListener(NATIVE_RESUME_EVENT, onVisibility);
    };
  }, [userId]);
}
