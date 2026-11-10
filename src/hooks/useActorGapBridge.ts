import { useEffect, useState } from 'react';
import { PRE_ACTION_GAP_BRIDGE_MS } from '../lib/preActionPanelGate';

/**
 * ═══ THE BRIDGE HOLDS IN THE SAME RENDER THAT OPENS THE GAP (Dan 2026-11-10) ═══
 *
 * Dan, verbatim: "the action bar on the bottom keeps glitching everytime a
 * player acts, it causes the action bar to fully reset, instead of changing
 * just the internal buttons."
 *
 * Every action at the table moves `currentPlayerSeat` through `N -> 0 -> M`.
 * The bridge that keeps the pre-action bar up across that 0 used to be
 * `useState(false)` switched on by a `useEffect`. An effect runs after its
 * render has been committed, so the first render that saw seat 0 still had
 * the bridge off: the gate went false for one commit, React unmounted the bar,
 * the effect then switched the bridge on and the bar mounted again, replaying
 * its 300ms preActionCrossFade entrance. That happened on every single action.
 *
 * The bridge is now derived during render: an in-progress hand with nobody on
 * the clock IS bridged, in the very render that shows the 0. Only its expiry
 * is on a timer, so any other silence (an all-in runout, a stalled engine)
 * still stops claiming a turn is coming after PRE_ACTION_GAP_BRIDGE_MS.
 */
export function useActorGapBridge(currentPlayerSeat: number, isHandInProgress: boolean): boolean {
  const gapOpen = isHandInProgress && !(currentPlayerSeat > 0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!gapOpen) {
      setExpired(false);
      return;
    }
    const t = window.setTimeout(() => setExpired(true), PRE_ACTION_GAP_BRIDGE_MS);
    return () => window.clearTimeout(t);
  }, [gapOpen]);
  return gapOpen && !expired;
}
