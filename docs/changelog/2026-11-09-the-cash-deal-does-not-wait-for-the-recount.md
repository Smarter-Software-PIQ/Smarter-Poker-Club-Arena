# The next cash hand stops waiting for two settlement reads that cannot change it (2026-11-09)

Dan, 2026-11-05: "AS SOON AS ONE CASH GAME HAND FINISHES AT A TABLE, THE NEXT
HAND NEEDS TO START WITHIN 2 SECONDS."

## What was measured

823 live cash hands, 2026-11-09 05:03-10:20 UTC, each with the engine's own
per-step settlement timing (`/health?liveness_table_ids=`, `postHandTiming`).
Settlement ran past the end of the completion hold on 27% of hands. Measured
from that point, two round trips ran in series after everything the next hand
is dealt from was already settled:

| step                                                | p50    | p99    | what it does                                                                       |
| --------------------------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------- |
| committed stack read after the post-commit envelope | 147 ms | 800 ms | re-reads `table_seats.stack` once the envelope answers                             |
| `table_unlock` recount                              | 132 ms | 807 ms | counts seats, corrects `tables.current_players/status`, announces `table_unlocked` |

The slowest gaps also clustered in the minute after the 10-minute PostgREST
pool renewal (`postgrest-pool-renew-10m`, :x2): 26% of hands in that window
went over 2 s against 1.5% outside it. That job is deliberate (it bounds
per-connection memory) and is not changed here.

## The change

1. **The recount runs after the deal is released, on cash tables.** The
   deal barrier now releases when both lanes have reached step 15: the hand
   record, the envelope, the committed stacks, add-ons, horse funding, the
   stay clocks, departures and announced moves. Nothing the next deal reads
   comes from step 15 - it reads the seat count, writes `current_players` and
   `status` only when they disagree (never `closed`), and emits
   `table_unlocked`. It is still settlement: it is tracked by
   `trackSettlementInFlight`, so `stop()`, the drain and every
   `hasSettlementInFlight()` reader wait for it as before; and the next hand's
   recount is not sent until the previous one has answered, so recounts and
   `table_unlocked` events land in hand order. Tournament tables keep the
   whole barrier.
2. **The committed stack read is sent beside the envelope** and used only
   when nothing can have written a seat stack since: the envelope's own
   receipt resolved no add-on (its one seat writer is `resolve_pending_addon`
   over the ids this hand's commit froze; rake, BBJ, promo and insurance never
   touch `table_seats`), this engine applied the table's previous envelope
   itself (so no predecessor envelope is resolved under it), the table is chip
   cash, not halted and not on a Lightning-enabled or unread Cluster, and no
   between-hands seat credit (direct top-up, pending add-on sweep) was in
   flight when it was sent or started after. Anything else reads again after
   the envelope exactly as before.

The next hand is still dealt from its own roster read after the whole
barrier. No rule moved: the 1.8 s rest, showdown visibility, Previous Hand,
BBJ, run-it-twice, bomb pots, Lightning and feeders, must-move, time banks,
cash-out at hand end, rake and sit-out/leave all run where they did.

## The #10138 side effect

A prepared hand number dropped because the roster changed after its manifest
request keeps one `cash_hand_participant_manifests` row that no hand carries.
Every reader of that table was audited (11 database functions, no views,
policies, triggers that read it, publications, cron jobs, engine or client
readers). All reach a manifest through an accepted hand - a provenance
receipt's `manifest_id` or an accepted outcome's own table and hand number -
except `fn_union_pnl_prove_late_seat_credit`, which takes "the next hand this
occupancy was dealt" as the first later manifest holding the occupancy. A
dropped number could be picked ahead of the real next hand and refuse a
provable late credit. Migration `20261109132236` makes that lookup require the
manifest an accepted hand's receipt names. All 85 existing late-credit
resolutions name a next hand with such a receipt, so they re-prove
identically. Production count of manifests with no accepted hand: 0 among
1,138 captured since 05:27 UTC (the engine live then did not yet contain
#10138) and 0 among the 6,682 before it.

## Tests

- `server/src/engine/TheCashDealDoesNotWaitForTheRecount.test.ts`: the deal
  releases after the seats lane and before the recount; the recount stays
  settlement in flight, lands in hand order, and tournaments keep the whole
  barrier; the stack read beside the envelope is used only under the stated
  conditions; with every round trip at its measured p99 the deal barrier is
  exactly the stack read plus the recount shorter.
- `scripts/dev/probe-late-credit-dealt-next-hand-pg17.sh`: PostgreSQL 17,
  the production preimage of the late-credit prover misreads a dropped
  number; the postimage proves into the dealt hand; a replay refuses.
