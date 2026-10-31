# 2026-10-31: the rake-share fixture no longer fails for a day at a time

`Accounting transactions (PostgreSQL 17) shard 2/7` went red on every branch
from 23:00 UTC on 2026-10-31 with
`the rule reports less than the cron wrote (56.25 < 54.74)`, raised by the
proof block of `20261025030629_a_standing_rake_share_replaces_the_woowoo_cron`
as `scripts/ci/test-player-fee-redemption.sh` replays it.

Cause, read from the fixture: the proof compares the cron's DAY-granular split
(`effective_on >= (now() - 7 days)::date`) with the rule's TIMESTAMP-granular
share (`hands since now() - 7 days`). Fixture hand B (2026-10-24 23:00 UTC) and
hand C (2026-10-25 01:00 UTC) are fixed in time, so once `now() - 7 days` fell
inside their day but after the hand, the split counted the day and the share
did not. That is 2026-10-31 23:00-24:00 UTC for B and 2026-11-01 01:00-24:00
UTC for C. The cast also used the session time zone, so a non-UTC runner moved
the window.

Fix (fixture only; the recorded migration bytes are unchanged):

- hand C and its attribution sit at 23:59:59.99999x on 2026-10-25, so the
  window is two microseconds; B's window is already in the past;
- the rake-share steps run with `PGTZ=UTC`, as production does.

Verified with libfaketime against PostgreSQL 16: the old fixture fails at
2026-11-01 12:00 UTC; the new one passes at 2026-11-01 01:30, 12:00 and 20:00
and at 2026-11-05.
