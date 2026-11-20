# Engine Rolling Handoff

Owner orders (Dan, 2026-11-19, Chicago time):

- 12:54: "WE NEED TO STOP REQUIRING AN ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES."
- 14:58: "FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS."

This document is the design of the rolling per-table handoff, the record of
what Phase 2 built (engine side, behind a flag that defaults OFF), what is not
built yet, and the exact step list for wiring the release pipeline to it in the
next pull request.

## The Problem

A new engine version replaces the whole running engine in one global step:
`server/scripts/engine-release-transaction.sh`, driven by
`.github/workflows/auto-deploy-hetzner.yml`, waits for the 04:00 Chicago break,
drains every table's last hand, freezes the platform, stops the old container,
starts the candidate on the same port, proves it, seals, and thaws. That single
step forces:

- booked windows and the daily 04:00 route for every change;
- a player-visible break (last-hand notice, five-minute countdown, thaw waves);
- a 285 second reserve inside a 300 second break, split between candidate proof
  (150 s) and rollback (135 s);
- whole-release failure when one slow piece eats the reserve (release `1030z`
  on 2026-11-19: the long drain used up the proof reserve).

## The Idea

Two engine instances share the host for a short time: the old one (serving)
and the new one (the certified image). Ownership of each unit moves from old to
new at that unit's own next hand boundary, through the lease rows that already
decide who may deal. There is no global freeze, no platform-wide drain and no
break. A unit that cannot move yet simply stays with the old instance and is
asked again. The old instance retires when it owns nothing.

## Units

| Unit       | Lease row                                              | Moves when                                                                                   |
| ---------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Cash table | `engine_table_leases` (one row per table)              | its hand in the air finishes and the parked boundary is durable                              |
| Tournament | `engine_tournament_leases` (one row per event manager) | every table of the event is parked between hands and durable; the level clock is not touched |

A tournament manager owns all of its tables under one lease (hand commits on a
tournament table check the tournament lease), so an event moves as one unit.
Its level clock is the durable `tournaments.level_started_at`, which a resumed
manager already reads back mid-level (`TournamentManagerBase`, "resume the level
clock MID-LEVEL"); a move neither freezes nor restarts it.

## How One Unit Moves

```
OLD INSTANCE (yielding)                      NEW INSTANCE (adopting)
1. park after the hand in the air
   (pauseForMaintenance: the same park the
   restart census already trusts)
2. wait until the boundary is durable:
   between hands, parked, no F06 preparation,
   no stopped bank custody, no accounting in
   flight, park write durable
3. one atomic CAS on the lease row:
   (old, gen A, fresh) -> (new, gen B, fresh)
   fn_engine_hand_off_lease_v1
4. retire the local dealer without releasing
   the lease (it is no longer ours)           5. fn_engine_handed_leases_v1 lists the move
                                             6. claim with exactly gen B
                                                (claim_table_lease_v2 / claim_tournament_lease_v2
                                                grant it as a renewal; no lease function changed)
                                             7. start the engine HELD at arrival (cash tables)
                                             8. compare the boundary fingerprint
                                             9. match: release the hold, settle "adopted"
                                                mismatch or failed start: hand it straight back
```

### Why No Hand Can Be Split

- The CAS runs only while the park holds and the boundary check says no card is
  in the air. The park is a polled next-hand lock; nothing on the old instance
  opens a hand after it.
- `fn_engine_hand_off_lease_v1` takes `FOR UPDATE` on the lease row. Every hand
  commit holds that row `FOR KEY SHARE`, so the move waits behind any settlement
  still in flight and can never land inside one.
- After the CAS the old generation can commit nothing: every hand commit
  (`fn_ca_commit_hand_settlement_exact_before_obligations`) re-checks the exact
  instance and generation.
- A move is never attempted while the platform break is active (its resume
  waves lift every maintenance park, which is the park a move stands on).

### What Survives Exactly

| State                          | How it survives                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Seat numbers and players       | `table_seats` rows are never touched; the adopter loads them; the fingerprint compares seat, player and stack for every seat                |
| Stacks                         | committed by the last hand on the old instance before the boundary; compared exactly                                                        |
| Time banks                     | the park writes the parked banks (`persistPresenceForRestart('parked')`) and the adopter reads them on start, the restart path in use today |
| Pending sit-out, add-on, leave | applied at the boundary (post-hand tasks finish before the park counts) or stored in their rows (`table_pending_addons`, `leave_pending`)   |
| Hand numbers                   | allocated from the database; they continue, never restart                                                                                   |
| Tournament level clock         | durable `level_started_at`; compared with a one second rounding tolerance (a level is at least five minutes)                                |

### Rollback

- **Adoption fails to start.** The adopter hands the lease straight back as a
  `return` move (`kind = 'return'`, linked to the original). If the adopter's own
  failed-start recovery already released the row, the return re-creates it for
  the old instance; if anybody claimed it meanwhile, that claim stands. The old
  instance adopts the return exactly like any move and deals on.
- **Fingerprint mismatch on a cash table.** The table was held at arrival, so it
  has dealt nothing on the new instance: it is retired there and returned.
- **Fingerprint mismatch on a tournament.** A manager starts dealing at once
  (no arrival hold yet), so handing it back could split a hand. It stays, and
  the mismatch is reported loudly, exactly as a crash-recovered event would be.
- **A failed return** is never bounced again: it is settled `abandoned` and left
  to ordinary recovery, because two instances trading a sick table is worse
  than one crash recovery.
- **The CAS answer is lost.** The request is replayed with the same generation;
  the SQL answers the committed move again (`replayed: true`) and never moves
  twice. Still unknown after every replay: the old dealer retires anyway (it may
  no longer own the table); if the row did not move, it goes stale after 30
  seconds and the successor's ordinary discovery admits the table.
- **A unit never reaches a boundary** within `DEFAULT_BOUNDARY_DEADLINE_MS`
  (180 s): its park is released, it is `kept`, and it deals on the old instance.
  Nothing is ever forced.

### Retirement

The old instance retires (`mode: 'retired'`) only when all of these are true:
it deals no unit, no yield is in flight, no adoption is in flight, no Lightning
host is active, and `fn_engine_open_lease_handoffs_v1` says zero moves from or
to it are still unsettled (until its moves are adopted, a failure may still
come back to it). An unreadable count never retires it.

## Feature Flag

`ENGINE_ROLLING_HANDOFF=on` (exactly `on`; any other value is OFF). With the
flag off GameServer never constructs the coordinator, every new guard is an
optional chain on `null`, and the `/internal/rolling-handoff/*` routes do not
exist (the request falls through to the same 404 as before). Proven in
`server/src/GameServerRollingHandoff.test.ts`.

## What Phase 2 Built

| Piece                                   | File                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flag                                    | `server/src/handoff/rollingHandoffFlag.ts`                                                                                                                                                                                            |
| Protocol (yield, adopt, return, retire) | `server/src/handoff/RollingHandoffCoordinator.ts`                                                                                                                                                                                     |
| Database store, fail-closed parsing     | `server/src/handoff/leaseHandoffStore.ts`                                                                                                                                                                                             |
| Database functions and audit table      | `supabase/migrations/20261119211200_an_engine_hands_a_table_on_at_its_own_hand_boundary.sql`                                                                                                                                          |
| GameServer port and guards              | `server/src/GameServer.ts` (search `ROLLING HANDOFF`)                                                                                                                                                                                 |
| Engine reads                            | `ServerTableEngine.describeHandoffBoundary()`, `TournamentManagerBase.describeHandoffClock()`                                                                                                                                         |
| Host-local control routes               | `server/src/router.ts`: `GET /internal/rolling-handoff/status`, `POST /internal/rolling-handoff/yield` `{ "successorInstanceId": "..." }`, `POST /internal/rolling-handoff/abort` (internal key, loopback only, no forwarded headers) |
| Tests                                   | `server/src/handoff/RollingHandoffCoordinator.test.ts`, `server/src/GameServerRollingHandoff.test.ts`                                                                                                                                 |

GameServer guards (all inert with the flag off):

- cash admission refuses to start a dealer while yielding (`owned_elsewhere`),
  except for a unit being adopted;
- a newly constructed engine of a unit being adopted starts held
  (`setMaintenanceLock(true)`) until its fingerprint matches;
- the cash recovery path does not re-admit a unit that moved or is moving;
- tournament admission refuses while yielding;
- a lease lost because it was moved on purpose is fenced without a
  `table_lease_lost` / `tournament_lease_lost` report;
- the adoption loop starts and stops with the server.

Database functions (all `SECURITY DEFINER`, `search_path public, pg_temp`,
`service_role` only):

- `fn_engine_hand_off_lease_v1(scope, lease_key, from_instance, from_generation, to_instance, to_version, to_generation, fingerprint, kind, parent_id)`
- `fn_engine_handed_leases_v1(to_instance)`
- `fn_engine_open_lease_handoffs_v1(instance)`
- `fn_engine_settle_lease_handoff_v1(handoff_id, instance, outcome, detail)`
- table `engine_lease_handoffs` (no foreign key to any hot relation).

## What Is Not Built Yet (Activation Blockers)

The flag must stay OFF in production until all three are done. Each is safe to
leave undone: with the flag on and any of them missing, nothing moves or every
move comes back, but players would not be served correctly in the routing case.

1. **Successor boot role.** A second instance boots today as a leadership
   STANDBY (`services/leadership.ts`): it claims nothing and never publishes its
   dealer prerequisites, so every adoption it tries fails and is returned
   (safe, but nothing moves). The successor needs a boot role "handoff
   successor": publish dealer prerequisites and start the per-hand services a
   dealer needs (hand projection worker, outbox listener, live horse compute)
   without discovery and without leader-only jobs, then take leadership through
   `requestLeadershipHandOff` when the old instance retires.
2. **Client routing.** Clients reach `engine.smarter.poker` through Caddy to one
   port. A table that moved is served by the other process, which today answers
   404 or WebSocket close 4404 (`services/leadership.ts`, incident 2026-08-23),
   and the old process's room for that table goes silent after
   `tableStateHub.dropTable`. The routing layer: during the window the old
   instance stays the front door and relays every request and WebSocket room
   for a table it yielded to the successor over loopback (REST by table id,
   `/ws/table/:id` by path, `/ws/multi` per subscribed room); when the old
   instance retires, Caddy is reloaded to the successor's port, and the old
   instance then closes its remaining sockets with a reconnect close code so
   every client resubscribes to the successor, which owns everything. One
   reconnect per client, after the last move, with a fresh SNAPSHOT.
3. **Pipeline wiring** (below), including the Backup rehearsal.

Lightning host tables are kept by the old instance in this phase
(`lightning_cluster_stays`); the old instance does not retire while a Lightning
host is active.

## Tests

`server/src/handoff/RollingHandoffCoordinator.test.ts` (19 tests): two engine
instances over one database whose lease and handoff rules mirror the
migration, with hands that commit only under their exact lease. Proven: every
table and tournament moves at a hand boundary; no hand is split, dealt without
its lease, or moved with cards in the air; hand numbers continue; seats,
players and stacks are identical; the tournament clock is preserved; a failed
adoption and a fingerprint mismatch roll back to the old instance, which deals
again (and a held arrival never dealt); a table that cannot reach a boundary is
kept, never forced; a refused CAS keeps the table; a lost answer is replayed
and moves nothing twice; an aborted yield moves nothing; retirement waits for
every move to be adopted and never happens on an unreadable count; the flag is
off unless exactly `on`; the PostgREST store fails closed.

`server/src/GameServerRollingHandoff.test.ts` (6 tests): the real GameServer
port and guards. With the flag unset or `true` no coordinator is built, and
`on` builds one; with the flag off the routes 404 and the cash recovery path
re-admits exactly as before; two GameServer instances sharing one lease
database move a cash table and a tournament through the real port (maintenance
park, wait for a durable park write, CAS, retire without release, adopt with
the handed generation, arrival hold then release, retirement); a table inside
the platform break, on Lightning, or without a verified lease never moves; the
boundary reasons are named exactly.

The migration was installed and exercised on a local PostgreSQL 17 with stub
lease tables: the probes ran, a stranger and a wrong generation are refused,
the holder moves the row, an exact replay answers `replayed` with one row, the
successor's claim through the `claim_table_lease_v2` body recorded in
migration 20260912111633 is granted only with the handed generation and the old instance's reclaim is refused, a return
after a released row re-creates it for the old instance, a second return is
refused, a stale tournament lease is refused, and `anon` has no access.

## Pipeline Wiring Steps (Next Pull Request, After The Engine Window)

Do these only after the 8 PM Chicago release-input hold ends and with release
custody. Classic cutover stays the fallback for every step.

1. **Bootstrap release (classic, one time).** The serving engine must itself
   contain this code before it can yield. Ship Phase 2 plus the successor boot
   role and routing relay through one ordinary 04:00 cutover with
   `ENGINE_ROLLING_HANDOFF=on` in the engine env file. With the flag on and no
   yield requested, the only added work is one `fn_engine_handed_leases_v1` read
   per second.
2. **`server/scripts/engine-up.sh`.** Add `--successor`: start the candidate as a
   second container (`club-arena-engine-next`) on loopback port 8081 with
   `ENGINE_ROLLING_HANDOFF=on` and `ENGINE_BOOT_ROLE=handoff-successor`, without
   stopping `club-arena-engine`. Same image validation, labels and env file.
3. **`server/scripts/engine-release-transaction.sh`, rolling mode** (selected by
   a new `RELEASE_MODE=rolling` input; classic remains the default):
   - keep: `validate_actor`, engine lock, `require_backup_certificate` (now also
     requiring the certificate's `rollingHandoff.verdict == "pass"`),
     `create_image_lease`, `validate_candidate_image`, `prewarm_candidate_image`,
     the seal and its receipts;
   - skip in rolling mode: `daily_cutover_clock`, `maintenance_certificate`,
     `legacy_checkpoint_countdown`, `persist_break_deadline` /
     `assert_break_proof_time`, `request_recovery_window`, the Lightning break
     hold, and the 285 s reserve arithmetic (no break exists);
   - replace the cutover (`ENGINE_UP` call at the "candidate replacement" step)
     with: `engine-up.sh --successor`; wait for 8081 `/health` with
     `releaseSha == SHA`; read its `instanceId`; prove its database heartbeat
     (`engine-release-database-proof.py --instance-id <successor>`);
     `POST http://127.0.0.1:8080/internal/rolling-handoff/yield`
     `{"successorInstanceId": "<successor>"}`; poll
     `/internal/rolling-handoff/status` on both ports every 5 s; re-POST yield
     for `kept` units every 3 minutes; deadline 30 minutes;
   - success: old status `mode == "retired"`; then reload Caddy to 8081
     (`server/Caddyfile` upstream becomes the successor port, graceful reload),
     prove public `/health` names the successor `instanceId`, rename containers
     (`club-arena-engine` to `club-arena-engine-retired`, `club-arena-engine-next`
     to `club-arena-engine`), stop the retired container, seal;
   - rollback before the seal: `POST http://127.0.0.1:8081/internal/rolling-handoff/yield`
     naming the OLD instance (the protocol is symmetric), wait for the successor
     to retire, stop `club-arena-engine-next`, keep the old container, record the
     refusal. `recover_on_exit` gains this path for rolling mode.
4. **`.github/workflows/auto-deploy-hetzner.yml` and `stage-engine-release.yml`.**
   Add `release_mode: rolling | classic`; in rolling mode drop the 04:00 gating,
   the 03:58 last-hand notice and the booking files from the receiver
   preflight, keep the Backup certificate gate and the single-flight engine
   lock. `release-inputs-hold.yml` keeps its classic-mode meaning.
5. **Backup certification (`server/standby/standby-engine.sh` `cmd_certify` and
   `server/standby/standby-trials.sh`).** Add `trial_rolling_handoff` after the
   existing swap rehearsal: on the Backup copy, run the serving SHA and the
   candidate side by side with `ENGINE_ROLLING_HANDOFF=on`, with horses dealing
   cash tables and at least one running tournament; yield old to candidate and
   assert from the Backup database: every `engine_lease_handoffs` row
   `adopted`; no hand row whose commit instance differs from its deal instance;
   a `table_seats` snapshot taken at each move equal before and after; every
   moved tournament's `level_started_at` unchanged; old status `retired`. Then
   rehearse rollback: yield back with a Backup-only fault
   (`ENGINE_ROLLING_HANDOFF_FAIL_ADOPT=<table id>`, accepted only when the
   standby marker is present) and assert the `return` row is adopted by the
   other side and that table deals again. Write
   `rollingHandoff: { verdict, moved, returned, kept, durationMs }` into
   `club-arena-standby-certificate/v1` and refuse the certificate on any
   failure.
6. **Observability.** Export `poker_rolling_handoff_units{state}` and
   `poker_rolling_handoff_moves_total{kind,outcome}` from the coordinator
   status, page on any `return_unconfirmed` or `fingerprint_mismatch`, and
   classify a claim conflict whose holder is the named predecessor as
   `handoff_pending` rather than a split-brain warning while a yield is open.
7. **Runbook.** Add a "Rolling Release" section to
   `docs/ENGINE-RELEASE-RUNBOOK.md` with the status fields above and the
   verification checklist (old retired, successor owns every lease, no open
   moves, public `/health` names the successor, hands dealing).
