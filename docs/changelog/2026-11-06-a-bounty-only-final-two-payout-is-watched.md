# A Bounty Only Final Two Payout Is Watched

Owner rule (2026-11-05): a bounty only PKO ends with two players and both keep the bounty on their own head (migration 20261106010426, PR #9620 and #9631).

Migration 20261106032337 adds `fn_ca_bounty_only_final_two_watch`, run every five minutes by `ca-bounty-only-final-two-watch-5m`. For every bounty only PKO finished after the rule went live (the first opening after the engine release, 12:00 UTC on 2026-11-06) it proves that the second player's `bounty_residual` paid exactly his head, the champion's completion receipt paid exactly his own head as the residual, `bounty_pool_paid` and the event's bounty wallet rows equal the pool, and no knockout of the second player was paid after the close. A completed event with two or more entrants and no close row, and a close whose event is not COMPLETED ten minutes later, are breaches too. Each breach is kept in `ca_bounty_only_final_two_breaches` and raises one critical financial alert per tournament and breach kind while it is open. Detection only; nothing moves chips.

The same migration adds `fn_ca_bounty_only_pko_final_two` to the reviewed global lane authorities in `fn_ca_settlement_lane_doctrine()`. It takes the global lane first, like `fn_finalize_bounty_pool` and the terminal finish around it, and writes one event's second place and bounty residual only; the live doctrine check refused it as unreviewed, which failed CI for every pull request once 20261106010426 was installed.

Proof: `scripts/ci/test-bounty-only-final-two-watch.py` (native PostgreSQL 17, accounting shard 1) and `tests/a-bounty-only-final-two-payout-is-watched.law.test.ts`.
