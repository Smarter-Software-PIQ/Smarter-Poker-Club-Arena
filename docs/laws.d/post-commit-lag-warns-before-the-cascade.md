# tests/post-commit-lag-warns-before-the-cascade.law.test.ts

fn_ca_post_commit_lag_watch() (every minute) warns per table when the 5-minute p95 from commit to post-commit completion exceeds the owner's 2 s hand-gap limit and goes critical above 15 s or for a hand pending 15 s, instead of the ten-minute stranded page that on 2026-11-17 fired hours after the lag began; it is a detector that writes financial_alerts only, one open alert per table, escalating, auto-resolving, at most 10 new per run, with one message per severity so a platform-wide stall is one incident (incident 075013fd).
