# The Action Bar Survives Every Action

Dan, 2026-11-10: "the action bar on the bottom keeps glitching everytime a player acts, it causes the action bar to fully reset, instead of changing just the internal buttons."

## Cause

Every action at a table moves `currentPlayerSeat` through `N -> 0 -> M`. The pre-action bar stays up across the 0 through `actorGapBridged` (2026-09-07). That bridge was `useState(false)` switched on by a `useEffect`, and an effect runs after its render is committed. The first render that showed seat 0 therefore still had the bridge off, `handStillTakingAction` was false for that commit, React unmounted the bar, and the effect then turned the bridge on and mounted a new bar, replaying its 300ms `preActionCrossFade` entrance. It happened on every action at every table, Lightning and classic.

## Fix

`src/hooks/useActorGapBridge.ts` derives the bridge during render: an in-progress hand with nobody on the clock is bridged in the same render that shows the 0. Only the expiry (`PRE_ACTION_GAP_BRIDGE_MS`, unchanged) runs on a timer, so a runout or a stalled engine still stops claiming a turn is coming. TablePage reads the hook; the gate and every other clause are unchanged. The entrance animation still plays whenever the bar genuinely appears.

## Pinned

`tests/unit/theActionBarSurvivesEveryAction.test.tsx` gates the real `PreActionBar` as TablePage does and feeds two opponent actions: one DOM node throughout while the buttons change from Check to Call 6; the replaced effect-set bridge produces a second node; the bridge still expires; TablePage uses the hook.
