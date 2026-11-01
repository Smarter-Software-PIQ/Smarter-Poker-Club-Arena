# 2026-11-01: the rake share proof replays at its install clock

From 23:00Z on 2026-10-31 the required check "Server Engine (typecheck +
tests)" failed on every pull request, because its accounting shard replays
`20261025030629_a_standing_rake_share_replaces_the_woowoo_cron.sql` over a
fixture and the migration's proof refused:

    the rule reports less than the cron wrote (56.25 < 54.74); nothing changed

The proof compares a seven-day window that starts at `now() - 7 days` (a
timestamp) with the cron's splits filtered from that day's UTC midnight
(`effective_on >= since7::date`). The fixture's hands are fixed at Oct 24
20:00Z, Oct 24 23:00Z and Oct 25 01:00Z, so a replay fails whenever
`now() - 7 days` falls between a fixture hand and the end of its UTC day:
23:00-00:00Z on Oct 31, then 01:00Z Nov 1 to 00:00Z Nov 2, and so on. The
production install (Oct 25 03:06Z) was correct; only the replay's clock moved.

`scripts/ci/test-player-fee-redemption.sh` now replays that section (the
migration, its lag fixture and its assertions) as of the migration's own
install moment, `2026-10-25 03:06:29+00`, by substituting `now()` in disposable
copies. The recorded migration file and every other section are unchanged.

Proof (PostgreSQL, real harness): pinned at the install moment the section
passes; pinned at 2026-10-31 23:30Z it reproduces CI's exact error; pinned at
2026-11-01 12:00Z it fails the same way. `RAKE_SHARE_REPLAY_CLOCK` exists only
to make that demonstration repeatable. `tests/unit/playerFeeRedemptionWiring.test.ts`
pins the four substitutions.
