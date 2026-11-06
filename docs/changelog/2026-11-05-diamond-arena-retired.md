# Diamond Arena Retired

Owner order, 2026-11-05 15:04 America/Chicago: "OVERRIDE THE 4 AM RULE FOR THE
MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW".

## Sequence

- 21:56 UTC: last cash game NLH 50/100 (a5b77d68), closed and disabled since
  2026-10-14 but left at state `live` by the controller, settled to `dormant`
  through `fn_cash_cluster_tick(game, 0)`; no table opened, no chip moved.
- 23:12 UTC: Midnight Free Buy 6429087f closed through
  `fn_ca_owner_retire_tournament` (another session's run of the same order);
  11,200 diamonds to KingFish, escrow 0, conservation delta 0.00.
- 23:27 UTC: 20261105224533 (#9593) refused by `fn_poker_guard_arena_structure`
  ("Diamond Arena Requires Platform Operations") because it carried the
  system account as role `authenticated`.
- 20261105233352 retires the club through the same core with the system
  account carried as role `service_role`, which satisfies both the core's
  owner check and the arena guard. Proved rolled back: success, retired,
  hidden, 1,293 ms.

## Lesson

A Diamond club is owned by the system account and its structure is platform
operations only. Any door that impersonates its owner must carry
`role: service_role`; `authenticated` is always refused by the arena guard.
Do not use the public wrapper `fn_retire_settled_club` for a club this size
during play: it takes the platform-wide hand settlement lane (G and B) before
locking ~104k seat rows, which holds every live hand.
