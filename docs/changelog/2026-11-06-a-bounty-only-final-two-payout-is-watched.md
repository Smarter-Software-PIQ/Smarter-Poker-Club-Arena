# A Bounty Only Final Two Payout Is Watched

Owner rule (2026-11-05): a bounty only PKO ends with two players and both keep the bounty on their own head (migration 20261106010426, PR #9620 and #9631).

Migration 20261106032337 adds `fn_ca_bounty_only_final_two_watch`, run every five minutes by `ca-bounty-only-final-two-watch-5m`. For every bounty only PKO finished after the rule went live (the first opening after the engine release, 12:00 UTC on 2026-11-06) it proves that the second player's `bounty_residual` paid exactly his head, the champion's completion receipt paid exactly his own head as the residual, `bounty_pool_paid` and the event's bounty wallet rows equal the pool, and no knockout of the second player was paid after the close. A completed event with two or more entrants and no close row, and a close whose event is not COMPLETED ten minutes later, are breaches too. Each breach is kept in `ca_bounty_only_final_two_breaches` and raises one critical financial alert per tournament and breach kind while it is open. Detection only; nothing moves chips.

Proof: `scripts/ci/test-bounty-only-final-two-watch.py` (native PostgreSQL 17, accounting shard 1) and `tests/a-bounty-only-final-two-payout-is-watched.law.test.ts`.
