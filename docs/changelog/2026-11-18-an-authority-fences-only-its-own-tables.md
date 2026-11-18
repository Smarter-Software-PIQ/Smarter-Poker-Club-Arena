# An authority fences only its own tables (incident 075013fd, lane T, part 2)

Owner ruling, 2026-11-17: "a tournament issue must always be isolated and never
affect other tournaments or cash games." Follows
`2026-11-18-a-table-writer-never-waits-on-the-platform-lane.md` (migration
`20261118160405`). Migration
`20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql`.
Proof: `scripts/ci/test-tournament-lane-isolation.py` (52 checks). Laws:
`tests/an-authority-fences-only-its-own-tables.law.test.ts`,
`tests/a-script-never-holds-the-platform-lane.law.test.ts`.

## What was left after part 1

A global authority that only queued for the platform key G no longer paused
anything, but one that HELD the lane (G then B exclusive) still paused every
table on the platform for its whole transaction. Thirty functions took that
lane for work on one club or one or two events, and two production scripts sent
it as a bare statement.

## The lanes now

| lane | keys | pauses |
| --- | --- | --- |
| club (`fn_ca_lock_settlement_lane_for_club`) | G s, F s, F(bank scope) x, C(club) x, T x for each live event of the club (uuid order) | that club's cash hands (they take C shared) and its live events' tables |
| event, plain (`fn_ca_lock_settlement_lane_for_event(id)`) | the finish lane: G s, F s, F(scope) x, T(id) x | that event's tables |
| event, exclusive (`..._for_event(id, true)`, cancellation-shaped) | the sweep-member lane: G s, F x, T(id) x | that event's tables (and, through F, other finishes for the hold) |
| event, satellite | the satellite finish lane: G s, F x, T(satellite), T(target) in uuid order (try; 55P03 if busy) | the satellite's and the target's tables |
| global (`..._global`) | G x, B x | every table (only the two multi-event sweeps and helper fallbacks now) |

Inside any existing finish, satellite or sweep lane, or under the global lane,
the event lane does exactly what the global helper did there (re-entry), so
nested calls keep their meaning. Inside a club lane, an event lane or a
cancellation of that club's event is accepted; any other club's is refused.

## Callers moved (one md5-pinned substitution each, post-image computed read-only on production)

- Club lane: `fn_retire_settled_club`, `fn_unwind_unused_first_club_welcome_package`
  (and so `fn_remove_first_club_welcome_games`), `smarter_private.unwind_heads_up_fixture`.
  `fn_ca_retire_heads_up_fixture`'s pin on the unwind body moves with it.
- Event lane: deal review (`fn_begin/request/cancel/close_tournament_deal_review`,
  `fn_get_tournament_deal_consensus`, `fn_ca_tournament_deal_snapshot`,
  `fn_settle_final_table_deal_atomic`, `fn_settle_tournament_final_table_deal`,
  `fn_complete_tournament_terminal_proposal`, `fn_resolve_tournament_terminal_proposal_outcome`,
  `smarter_private.lock_terminal_request_lane` for proposal deals); satellites
  (`fn_award_satellite_seat`, `fn_deliver_satellite_ticket_exact`,
  `fn_ca_return_satellite_entitlement_as_ticket`, `fn_resolve_satellite_settlement_outcome`,
  `fn_settle_satellite_finish_atomic`); standalone settles (`fn_settle_tournament_places`,
  `fn_settle_tournament_rake`, `fn_finalize_bounty_pool`, `fn_mystery_bounty_settle`,
  `fn_complete_tournament_terminal_pre_seat_guard`, `fn_ca_bounty_only_pko_final_two`);
  legacy fee custody (`fn_ca_begin_legacy_fee_resolution`, `fn_ca_hold_legacy_tournament_fee`).
- Exclusive event lane (what `cancellation_lane` accepts): `fn_poker_diamond_cancel_tournament`,
  `fn_execute_managed_game_command` (tournament close), `smarter_private.f06_void_retired_mixed_custody_event`.
- Still global: `fn_backpay_unfinalised_bounty_pools` and `fn_sweep_unsettled_tournament_rake`
  (multi-event; no live caller today), `fn_ca_lock_settlement_lane_for_tournament(NULL)`.

## Scripts

`scripts/ci/certify-club-create.mjs` and `scripts/ci/reserved-terminal-welcome-fixture.mjs`
(post-deploy account cleanup) take their club lane. The global helper now refuses
to be a postgres session's bare top-level `SELECT fn_ca_lock_settlement_lane_global()`
(`GLOBAL_LANE_IS_NOT_A_SCRIPT_LOCK`, 42501), and the script law refuses any
script, workflow or service source that sends it to a real database.

## Table guard

`smarter_private.f06_table_guard` no longer tries the lane for a counter-only
update of `tables` (`current_players`, `updated_at`), which the hand commit
writes under its own T shared; the try only produced 55P03 retries. Every other
update and every delete still try it.

## Why the invariants hold

- Authority vs authority: every scoped lane takes G shared (the remaining global
  authorities still exclude it), finishes and club lanes of one bank scope
  serialise on F(scope), and satellite, sweep and exclusive event lanes hold F
  exclusively - the 2026-09-17 wallet order.
- Authority vs hand writes: an event lane holds its T exclusive; a club lane
  holds C(club) and each live event's T exclusive.
- No deadlock: order G < F < F(scope) < B < C < T everywhere; every holder of
  several T keys holds F exclusive, or is a club lane holding its F(scope)
  (one scope's club lanes serialise; different scopes have disjoint events).
  480 mixed transactions, including club, event, satellite and cancellation
  lanes: zero deadlocks.

## Still open (named)

- `smarter_private.cancellation_lane`'s standalone mode (operator/owner cancel,
  abort settlement, managed-game close outside the command door) still tries G
  and B exclusive. A try never queues, so it pauses tables only while held. Moving
  it to the event lane needs a review of every multi-event cancellation batch
  (a second event under one marker is refused today).
- The exclusive event lane and the satellite lane hold F exclusively, so other
  events' FINISHES (not their tables) wait for their hold.
- A satellite lane is try-based (55P03 when either event is busy), as it was for
  satellite finishes; standalone satellite seat and ticket calls now see that.
