# A table writer never waits on the platform lane (incident 075013fd, lane T)

Owner ruling, 2026-11-17: "a tournament issue must always be isolated and never
affect other tournaments or cash games." Migration
`20261118160405_tournament_table_writers_never_wait_on_the_platform_lane.sql`.
Native proof: `scripts/ci/test-tournament-lane-isolation.py` (workflow
`table-writer-lane-isolation.yml`). Law:
`tests/a-table-writer-never-waits-on-the-platform-lane.law.test.ts`.

## The lane, in one table

| key | name | who takes it |
| --- | --- | --- |
| G | `ca:tournament-terminal-settlement:v1` | every authority (shared); global authorities (exclusive) |
| F | `ca:tournament-finish-lane:v1` (+ `:scope:<bank>`) | finishes, satellite finishes, sweeps |
| B | `ca:hand-settlement-barrier:v1` | global authorities (exclusive, right after G); hand commits (shared) |
| T(id) | `ca:tournament-terminal-settlement:v1:<id>` | rolling authorities and finishes (exclusive); that event's table writers (shared) |

## What was wrong

Every tournament table writer took **G shared** before its own T(id):
`smarter_private.f06_wait_table_lane` (hole cards, snapshots, post-commit
obligations, projections), `fn_ca_f06_share_table_lane` (begin, finish,
continuation, hand number) and `fn_ca_share_settlement_lane_for_table` (the
hand commit, which took G shared for **cash** tables too). The two F06 hand
guards and the source guard's writer branches *tried* G shared.

Postgres queues a new shared request behind a *waiting* exclusive request. So
a global authority (G exclusive) paused every tournament table and every cash
hand for as long as it was **queued** for G, and it queues behind any other
event's slow authority that holds G shared.

## What production said (read-only, postgres log with `log_lock_waits`, 2026-11-17 12:00 to 2026-11-18 12:00 UTC)

- **Waits of 1 s or more on G by table writers: 477, in 8 episodes.** In every
  episode a G-exclusive request sat queued 3 to 14.5 s behind a slow G-shared
  holder (a `tournament_schedules` update, a hand projection waiting on its own
  locks). The G-exclusive requesters, by full log context:
  - `SELECT public.fn_ca_lock_settlement_lane_global()` sent directly by user
    `postgres` through Supavisor: the club-create certification job
    (`scripts/ci/certify-club-create.mjs`, which takes the global lane
    explicitly before `fn_remove_first_club_welcome_games` in a rolled-back
    transaction on production) - 19 of the 20 logged exclusive waits, at 12:29,
    13:40, 13:59 (14.5 s), 14:38 (13.3 s), 17:05 and 20:14;
  - `fn_retire_settled_club` once (23:45);
  - a hand-run incident script trying the cancellation lane in a loop (03:51,
    132 waiting writers).
  No tournament **settlement** took G exclusively: finishes have used the
  per-tournament finish lane since 2026-09-17.
- **Waits on a tournament's OWN T(id): about 47,000** in the same 24 h, peaking
  in the incident (`Nightly 20K` 9,895 and `Prime Time Free Buy` 6,934 shared
  waits between 01:00 and 04:00). Those are writers queued behind their own
  event's exclusive authorities (`process_tournament_rebuy`,
  `fn_close_tournament_entry_window`, `fn_register_horse_for_tournament_to_target`,
  `fn_f06_discover_breaks`, moves, eliminations), which in turn queued behind
  that event's slow shared holders - writers held up 5-7 s on
  `hand-post-commit:<table>` and on the `union_wallets` row. That is the bulk
  of the 150-193 PostgREST 55P03 an hour in the incident. It is
  intra-tournament (it never crossed to another event's tables) and it is not
  changed here; the union-wallet half was removed by lane F (#11270, #11266).

So the premise "a settlement of tournament A pauses every tournament table"
was true of the global lane's *queue*, not of tournament settlement; the
measured cross-event pauses came from the certification job, club retirement
and hand-run scripts.

## Inventory of the global exclusive lane (production catalog, 2026-11-18)

G is taken exclusively only by `fn_ca_lock_settlement_lane_global()` and
`fn_ca_lock_settlement_lane_for_tournament(NULL)` (doctrine rule 1); both take
B exclusively right after it. Callers of the global helper, and the invariant
across events that each one protects:

| caller(s) | why the whole platform |
| --- | --- |
| `fn_complete_tournament_terminal_pre_seat_guard`, `fn_settle_tournament_places`, `fn_settle_tournament_rake`, `fn_finalize_bounty_pool`, `fn_mystery_bounty_settle`, `fn_settle_tournament_final_table_deal`, `fn_complete_tournament_terminal_proposal` | Inside a finish they **re-enter the per-tournament finish lane** (no G exclusive). Outside one (a direct call) they fall back to the global lane: the 2026-09-17 rule that money commits touching shared club/union/recipient wallets keep one order. |
| `fn_resolve_satellite_settlement_outcome`, `fn_settle_satellite_finish_atomic`, `fn_award_satellite_seat`, `fn_deliver_satellite_ticket_exact`, `fn_ca_return_satellite_entitlement_as_ticket`, `smarter_private.lock_terminal_request_lane` (proposal deals) | Write two events' rows (source and target); "a transaction never holds two tournaments' lanes" outside F. |
| deal review set (`fn_begin/request/cancel/close_tournament_deal_review`, `fn_get_tournament_deal_consensus`, `fn_ca_tournament_deal_snapshot`, `fn_settle_final_table_deal_atomic`, `fn_resolve_tournament_terminal_proposal_outcome`) | Reviewed 2026-09-17 as rare; a deal snapshot freezes stacks and pays from shared banks. |
| cancellation (`atomic_cancel_tournament`, `fn_ca_operator_cancel_tournament`, `fn_poker_diamond_cancel_tournament`, `smarter_private.f06_void_retired_mixed_custody_event`; `smarter_private.cancellation_lane` requires G and B exclusive) | Refund paths credit many wallets; ordered against every other money commit. |
| club scope (`fn_retire_settled_club`, `fn_unwind_unused_first_club_welcome_package` via `fn_remove_first_club_welcome_games`, `smarter_private.unwind_heads_up_fixture`, `fn_close_managed_game`, `fn_execute_managed_game_command`) | Remove or close a club's cash games and tournaments together; fence that club's cash hands too (B). |
| multi-event (`fn_sweep_unsettled_tournament_rake` #11272, `fn_backpay_unfinalised_bounty_pools`, `fn_ca_begin_legacy_fee_resolution`, `fn_ca_hold_legacy_tournament_fee`, `fn_ca_bounty_only_pko_final_two`) | Walk several events or legacy fee custody. |
| scripts | `scripts/ci/certify-club-create.mjs` (production, rolled back); incident scripts. |

Exclusive per-tournament lanes (T exclusive) are taken by rolling authorities
(`fn_ca_lock_settlement_lane_for_tournament`, 38 callers), finishes,
satellite finishes (two T keys under F) and sweep members. Each fences exactly
its own event's writers, which is the design.

## The fix

Table writers no longer name G. They take the hand barrier **B shared**, then
their own T(id) shared; cash hand commits take B only. The global helpers are
untouched: they take G then B exclusively, so B is requested only once G is
**held**. A global authority that is still waiting for G pauses nothing; while
one holds the lane, every writer still waits for it (bounded at 4 s with the
same `F06_RETRY_CANONICAL_LANE` / 55P03 sentinel), and the guards still refuse
a direct write.

| function | before | after |
| --- | --- | --- |
| `smarter_private.f06_wait_table_lane` | G s, T s (waits, 4 s) | B s, T s (waits, 4 s) |
| `fn_ca_f06_share_table_lane` | lease, G s, T s, lease, rows | lease, B s, T s, lease, rows |
| `fn_ca_share_settlement_lane_for_table` | G s, B s, T s (cash: G s, B s) | B s, T s (cash: B s) |
| `f06_aborted_hand_guard`, `f06_cancelled_preparation_writer_guard` | try G s, T s | try B s, T s |
| `f06_source_guard` (payload and zero-stack writer branches) | try G s, T s | try B s, T s |
| `fn_ca_settlement_lane_doctrine` | rules 1-4 | + rule 5 `table_writers_never_take_g` |

## Why every invariant still holds

- **Global authority vs hand writes.** G exclusive and B exclusive are only
  ever taken together (doctrine rule 1), so a global authority that holds the
  lane holds B, and every writer holds or tries B. Same fence, starting at B
  instead of G.
- **A tournament's authority vs its own hand writes.** T(id) exclusive vs T(id)
  shared, unchanged.
- **Authority vs authority** (the 2026-09-17 wallet-order rule): G, F, F(scope)
  and T are unchanged; no authority's lock set moved (the migration refuses to
  commit if any of the three helper bodies changed).
- **No deadlock.** The order everywhere is G < F < B < T. Writers take B then
  T and never G. The writer paths that do reach G (`fn_ca_resume_hand_submission`,
  `f06_prefix`) take it through an authority lane *before* B. A writer waits on
  B only while a global holds B, that is, holds G exclusively, so no other
  transaction holds T exclusively (every T-exclusive taker holds G shared first)
  and nothing that holds B shared is waiting for it.
- `fn_ca_hand_path_shared_writes()` (#11281): the change adds no blocking write,
  `FOR UPDATE` or exclusive advisory lock to the hand path (B shared is a
  shared lock on a platform key, not a union/club/pool row).
- No new money RPC (`fn_ca_money_rpc_writes_balances` is false for all seven
  bodies), so no `ca_money_rpc_registry` row is needed.

## Proof

`scripts/ci/test-tournament-lane-isolation.py`, PostgreSQL 16 locally (CI: 17),
exact production pre-images, 31 checks, all passing:

- Before, a global authority queued behind another event's slow rolling
  authority: tournament B's hole-card writer is refused after 4.04 s, a cash
  hand commit is paused 4.09 s, B's direct guarded write is refused.
- After, the same interleaving: all five writer shapes complete in 0.03-0.09 s.
- Tournament A's settlement (finish lane) holds 10 s: B's writer 0.10 s, B's
  hand commit 0.04 s, a cash commit 0.07 s; A's own writer waits and is
  refused at its 4 s bound; with a 1.5 s settlement A's writer waits and writes.
- A global authority that HOLDS the lane still refuses direct guarded writes
  and a direct payload seat update, and a writer waits for it then writes; a
  global authority cannot take the lane over an open writer; a rolling
  authority still pauses only its own event's writer.
- Doctrine rule 5 names a writer that takes G again; a drifted pre-image
  refuses the whole migration.
- 480 mixed transactions (writers, resume-shaped writers, rolling authorities,
  finishes, global authorities that then take a tournament lane) across 12
  sessions: zero deadlocks, zero errors.

## Install

One transaction, `CREATE OR REPLACE FUNCTION` on seven functions through exact
md5-pinned substitutions: no table or row lock, no install window, one schema
cache reload. One declared stale pin: `original_hand_correction_sources_match()`
pins the old `fn_ca_share_settlement_lane_for_table` body and already answers
false on production, so its outcome does not change. Rollback is the reverse
substitution (each `$new$` back to its `$old$`; the migration proves each is
reversible).

## Still open (named, not hidden)

- **The global lane's hold still pauses every table.** Once a global authority
  holds G and B, every writer waits for it, as before - for the hold, no longer
  for the queue. The certification job holds the lane for its whole rolled-back
  transaction (several seconds, up to six times a day) and
  `fn_remove_first_club_welcome_games` runs 1.5 s on average (max 9.8 s) under
  it. The next step is a club-scoped lane (a club key that writers take shared
  and club operations take exclusively instead of B) for the welcome-package,
  retirement and managed-game callers and the certification job, and a
  tournament-scoped declaration for the deal-review, cancellation and satellite
  callers. That needs edits to those bodies (and to
  `fn_ca_retire_heads_up_fixture`, which pins the unwind body) and is left for
  its own reviewed change.
- **Intra-tournament convoys** (the bulk of tonight's 55P03): a tournament's
  writers queue behind its own exclusive authority, which queues behind that
  event's slow writers (`hand-post-commit:<table>` waits of 5-7 s,
  `fn_project_hand_side_effects` with no bound). Isolated to one event, but
  real; owned by the hand-delay lane.
- `smarter_private.f06_table_guard` (on `public.tables`) still *tries* G via
  `f06_try_lane` when a hand commit changes `tables.current_players`; while a
  global authority is queued that try now refuses (55P03, engine retries)
  where the writer used to wait at its top. That path also tries T exclusive,
  which already refuses whenever a sibling table is mid-hand.
