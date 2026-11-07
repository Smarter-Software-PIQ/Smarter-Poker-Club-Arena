# tests/a-lightning-window-send-is-staggered.law.test.ts

Dan, 2026-11-07: each Lightning Cluster sends its closed shadow/integrity window at its own stable offset (a hash of the Cluster id, spread over up to 60 seconds and never past half a window) after the moment the window closes, so Clusters never all call `fn_lightning_integrity_report` at once. The send rides the Cluster's next pass or its stop; there is no timer.
