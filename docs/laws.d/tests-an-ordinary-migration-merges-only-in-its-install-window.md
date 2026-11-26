# tests/an-ordinary-migration-merges-only-in-its-install-window.law.test.ts

2026-11-26: the pull-request check "An ordinary migration merges only in its install window" is red when a merge now would not install at once (the dispatcher's admission rule now and five minutes later: [cycle + 10m, cycle + 25m), 04:15-04:25 for the 04:00 anchor), naming the next window in Chicago time, and green inside it; daily-maintenance window files and pull requests with no ordinary migration are always green. It runs the default branch's script, reads the proposal as data, holds no secret, and has no timer.
