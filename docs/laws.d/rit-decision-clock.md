# tests/rit-decision-clock.law.test.ts

Owner November 19: optional 1x/2x/3x decisions have a ten-second maximum clock. Once all players agree to run it multiple times, or any player declines / chooses Run Once, the countdown stops and the hand proceeds right away. The prompt opens immediately; server timing, immediate completion/refusal and paused-clock regressions run in server/src/engine/RunItTwiceClock.test.ts.
