# A hand never transitions a tournament, books a Spin or burns a club's chips (incident 075013fd, lane H2)

2026-11-18. Lane H2 of the 075013fd hardening swarm: the tournament, Spin and
Diamond entries the live reader `public.fn_ca_hand_path_shared_writes()`
(#11281) still allowlisted on a hand's money path. Each was read against the
production function texts and measured read-only on production.

## Verdicts

| Entry (function, kind, target) | Verdict | Evidence |
| --- | --- | --- |
| `fn_ca_fund_overlay_on_lock` row_lock/write clubs, union_wallets (4) | **False positive, reader defect** | The reader followed `trg_sync_tournament_current_players` (UPDATE OF status, tournament_id) because the lease generation's `UPDATE tournament_players SET chips, table_id, seat_number WHERE ... tp.status = 'playing'` *mentions* status in its WHERE. PostgreSQL fires a column trigger only for a SET target. And `fn_sync_tournament_current_players` sets only `tournaments.current_players`, so the BEFORE UPDATE OF status guards cannot fire either. |
| `fn_guard_tournament_start_readiness` row_lock clubs, union_wallets (2) | **False positive, reader defect** | Same edge. |
| `fn_spin_book_entry` row_lock/write, `fn_spin_reserve_pool` write spin_bonus_pools (3) | **Static only, unreachable on a hand** | The hand's only `left_at` write is `fn_ca_settle_hand_stacks_absolute`'s zero-stack VACATE. `fn_sync_seat_first_player_count` books only when live seats >= max_players; a vacate strictly lowers the count from <= max_players. Production: 782 of 782 spin contributions in the 7 days to 2026-11-18 were booked before their spin's first hand commit. |
| `fn_ca_burn` row_lock/write clubs, union_wallets (4) | **Static only, unreachable for these rows** | Reachable only when a Diamond Arena BBJ credit meets an open diamond receivable (negative debt-settlement row fires the VIP allocation trigger) and an overdue Lifetime VIP lot; the expiry then calls `fn_ca_burn('diamonds', 'player', ...)`, whose branch touches only the player's profile. The club and union rows are in the CHIPS branch. Production: 0 jackpot hits ever, 0 open debts, 0 overdue lots, 0 expiry burns. |

## What changed

- `scripts/ci/hand-path-shared-writes.mjs` and the live reader (migration
  `20261118155729`, generated from the module and pinned byte for byte): an
  UPDATE OF trigger is followed only when one of its columns is a TARGET of the
  statement's SET list (plain, quoted, `SET (a, b) =`, `ON CONFLICT DO UPDATE
  SET`); a qualified `s.col = x` in WHERE is a comparison. Conservative: an
  unqualified `col = x` in WHERE still counts. Production under the new rule:
  746 functions on the path (875 before), 14 violations (23 before).
- The six fund-overlay / start-readiness entries are removed from the
  allowlist. The three seat-parent entries (`fn_refresh_club_activity_counts`,
  `fn_sync_club_table_counts`, `guard_member_club_standalone_game`) are also
  gone under the new rule; they belong to lane H1 and are left for it.
- The seven Spin and burn entries stay, re-reasoned as "STATIC ONLY" with the
  invariant, the production measurement and the native proof that holds them.

## Proof

`scripts/ci/test-hand-path-shared-writes.py` (workflow
`hand-path-shared-writes-proof.yml`):

- G1: the SET-target rule on a synthetic catalog (a mutation back to the old
  word match fails it), the reader installs through the applier's own check and
  carries its live proof.
- G3: the production texts of the seat-first count chain and the diamond
  expiry -> burn chain (md5-equal to production), with the hand's seat and
  roster statements copied verbatim from the production commit functions. A
  hand busting a seat on a full Spin table commits while a second session holds
  the spin pool, club and union wallet rows; the diamond chain retires the
  player's diamonds while the same rows are held. Positive controls: a third
  seat filling the Spin, a tournament status change and a chip burn all wait on
  those rows, so the harness is not blind.

## Open

- `fn_ca_burn`'s diamond branch takes a global `pg_advisory_xact_lock('ca_mint_ledger:diamonds')`
  and sums `ca_mint_ledger`; the reader does not count un-scoped advisory keys.
  Reachable from a hand only under the three never-observed conditions above.
- `fn_poker_diamond_jackpot_accept_hand` locks the arena's
  `poker_diamond_jackpot_pools` row on a hit inside the hand; the reader does
  not classify that table as shared (its key is `id`).
- `fn_sync_seat_first_player_count` on a tournament bust locks every live seat
  of every table of that tournament (same tournament only, not shared).
