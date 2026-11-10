# Lightning joins are timed from the click to the painted cards

Owner report, 2026-11-10: "it took a very long time to load the join and even longer to buy in and even longer to start the hand and be dealt in." Dan's first hand came 18.4 s after his pool session opened (15:41:10.04Z to 15:41:28.56Z), and the browser's half of a join was never recorded, so the 18.4 s could not be split into legs.

## What was measured before this change (production, read-only)

- Session opened to pool entry, 22 non-horse Lightning joins over two days: 30 to 300 ms (Dan's: 113 ms). The purchase lands fast.
- Pool entry to first hand formed, same joins: 18 ms to 30.8 s, typically 0.5 to 2.8 s; Dan's 18.4 s (inside the 15:00Z lock storm fixed by #10368) and 30.8 s (2026-11-09 05:55Z) are the outliers.
- The matcher only seats a player whose room socket is connected (LightningClusterWorker reads the presence feed, unknown counts as disconnected), and a room's first socket triggers admission. So "pool entry to first hand" includes the browser opening the room page and connecting its socket: the legs nobody could see.
- Server time of the join doors (pg_stat_statements, cumulative): fn_lightning_rejoin_seated mean 173 ms (max 7.8 s), called on Join and again on confirm; atomic_table_buyin mean 162 to 271 ms; fn_cash_effective_buyin 1.6 ms; fn_lightning_my_session 3.1 ms.

## What changed

- **Join timing.** `src/lightning/lightningJoinTiming.ts` times one join per tab on the browser's monotonic clock: click, rejoin checked, buy-in question shown, confirm, chair held, purchase answered, seated, room open, socket connected, first snapshot, first hand, cards painted. The entry page marks its half; the room marks the rest (`useLightningJoinTiming`, and the existing RENDER_ACK moment for the paint). A join is reported once when its cards paint, or once as a timeout three minutes after a confirmed buy-in that never painted; a refused or abandoned join is never sent; a tab that was hidden is flagged.
- **Its own sink.** Migration `20261110213810` adds `client_lightning_join_timings` and `fn_report_lightning_join_timing(jsonb)` (signed-in callers only, user id from `auth.uid()`, whitelisted marks clamped to 0 to 600,000 ms, 10 a minute per player and 200 a minute in total, at most 100 rows older than 14 days pruned per write, no scheduled job), plus `fn_lightning_join_timing_report(since, until)` for service*role: per-leg n, p50, p95 and max, with the player's own time on the question kept apart from the system's. Not `fn_report_client_errors`: a timing there would count as an error in the error-rate gauges and the daily digest. Not a `lightning*\*` table: Lightning readiness requires that set to be exactly its eight gameplay tables.
- **The room's page is downloaded while the player answers the question.** The Join press now preloads the table-view chunk (`warmLightningRoom`), which the room opens on; it used to start downloading only after the purchase answered, and the matcher cannot seat a player until that page is up and connected.
- **The price question's two reads run together.** The rejoin floor (`fn_cash_effective_buyin`) and the wallet are independent reads of the same table and are now asked at once: one round trip fewer before the question appears.

Kept as they were: the rejoin door still answers before the price is read (the entry page's tests pin that a seated or frozen player's wallet is never read), and the confirm-time rejoin stays, because it is also the door that releases a busted zero-stack anchor before a fresh buy-in.

## How to read it

```sql
SELECT * FROM public.fn_lightning_join_timing_report(now() - interval '24 hours', now());
```

Legs: open_question, rejoin_check, player_decides, hold_chair, purchase, pool_session_read, route_to_room, socket_connect, first_snapshot, pool_wait_to_hand, hand_to_paint, and system (everything the player did not choose).

## Tests

- `tests/unit/lightningJoinTimingSink.pg.test.ts` installs the migration on real PostgreSQL: privileges, whitelist, clamps, refusals, per-player limit, retention and the per-leg report.
- `tests/lightning/lightning-join-timing.test.ts`: one report per join with every mark, room binding and claiming, rejoin, cancel, replace, timeout, hidden tab, the marks the database accepts, and the wiring in the entry page, the buy-in doors and the room.
