# Engine Rolling Handoff

Owner orders (Dan, 2026-11-19, Chicago time):

- 12:54: "WE NEED TO STOP REQUIRING AN ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES."
- 14:58: "FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS."

This document is the design of the rolling per-table handoff, the record of
what Phase 2 (the protocol) and Phase 3 (the successor boot role and the client
relay) built, engine side, behind a flag that defaults OFF, and the exact step
list for wiring the release pipeline to it in the next pull request.

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

On retirement (Phase 3) it closes its own sockets with 1012, keeps its HTTP
listener and relay up (relaying everything), and runs its certified stop,
which releases the leadership row last; the successor then takes leadership in
place.

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

## What Phase 3 Built: Successor Role And Client Relay

Owner orders (Dan, 2026-11-19, Chicago time): 14:58 "FULLY BUILD, FIX AND
ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE
CLAIMING SUCCESS." 17:25 "STOP SLEEPING AND FINISH THIS!"

Both pieces exist only with `ENGINE_ROLLING_HANDOFF=on`. With the flag off
neither setting below is read, GameServer builds no relay, the router and the
WebSocket servers attach exactly as before, and `/health` carries no new
field.

### Configuration

| Setting                           | Meaning                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENGINE_ROLE=handoff-successor`   | Boot as the successor of a serving engine (`server/src/handoff/handoffSuccessorRole.ts`). Any other value, or none, is the ordinary boot.                                                                       |
| `ENGINE_HANDOFF_PEER_PORT=<port>` | Loopback port of the other engine of the pair. Old engine: the successor's port (relay target, watchdog). Successor: the old engine's port (tournament channel mirror, and the relay target if it yields back). |

Unset, malformed, out of range or equal to the process's own `PORT`: no relay,
no watchdog and no mirror (a move still works, but a moved table then answers
404 from the front door, so production must set it on both engines).

### 1. Handoff Successor Boot Role

`GameServer.performStart` runs the successor boot (`handoffSuccessorBoot`):
it skips the leadership claim and renewal and the stale-data cleanup, makes
the same dealer lanes ready, and then hands over to
`finishHandoffSuccessorBoot` instead of the leader block:

- the horse decision lane and the equity pool (a dealer's prerequisites, the
  same single call sites as a leader boot), weekly payout custody, and its own
  lease renewal supervisor;
- opens the dealer gate, so `/health` answers 200 with
  `rollingHandoff.role = "handoff-successor"` (its liveness is the dealer
  gate, not the leader discovery verdict, which would call an engine with no
  discovery dead: `EngineLivenessVerdict.handoffSuccessorDealerReady`);
- runs NO stale-data cleanup (it would cash out the serving engine's live
  seats), no break adoption, no discovery, no horse fleet, no sweep, no
  reaper, no scheduler, no projection worker and no index-owned leader
  service;
- admits a unit only while adopting it, or to restart a unit it adopted
  (`GameServer.refusesHandoffAdmission`, asked by both the cash table and the
  tournament manager admission before any lease claim;
  `RollingHandoffCoordinator.admitsAsSuccessor`);
- polls `claimLeadershipAsHandoffSuccessor` (`services/leadership.ts`) every
  2 s. That claim becomes leader ONLY on an explicit grant: an error, an empty
  answer or a named holder changes nothing, and the unknown-streak
  self-promotion of an ordinary standby never applies.

Leadership passes only after the old engine retired. On retirement the old
engine closes its own sockets (1012) and runs its ordinary certified
`GameServer.stop()`: every discovery loop, sweep, singleton job and
index-owned leader service stops, and only then, as the last step, is the
leadership row released. The successor's next claim is granted and
`takeOverLeadershipAsSuccessor` runs the leader duties IN PLACE (no restart,
so its adopted tables keep dealing) by running `performStart` again with
`handoffTakeoverInProgress` set: the exact leader boot, skipping only what it
already has (the leadership claim, its lease renewal supervisor, the dealer
gate) and the stale-data cleanup (which would cash out the live seats it
deals). Then the index-owned leader services start through
`onHandoffLeaderTakeover` (`startLeaderOwnedServices(true)` in index.ts). If the old engine dies
instead, its row goes stale after 30 s and the same claim is granted; its
units' leases go stale too and the new leader's discovery admits them.

Not moved during the window (they wait for leadership, which is at most the
length of the window): wake rows and bounty recovery for tournaments are drained
by the serving engine's subscriptions (an adopted manager drains its own rows
when it resumes), and a brand-new table or event that appears while the old
engine is yielding is admitted by the new leader's discovery after takeover.

### 2. Client Relay

`server/src/handoff/handoffRelay.ts`, built by GameServer, wired in
`server/src/router.ts` (first thing in every request) and `server/src/index.ts`
(it takes the HTTP server's `upgrade` events and re-emits the ones that stay
local to the two WebSocket servers).

- **Which requests.** A table is relayed when this engine does not deal it
  (no table engine, no Lightning room) and either the engine is yielding or
  retired, or it handed that table on (`handoffRelaysTable`). Table ids come
  from `/state/:id`, `/actions/:id/...`, `/insurance-preview?tableId=`, the
  JSON body of the 23 table POST routes (`TABLE_BODY_ROUTES`), and
  `/ws/table/:id`. A body read to decide is handed to the local handler
  unchanged (`http/body.ts prefetchRequestBody`).
- **How.** HTTP is forwarded to `127.0.0.1:<peer>` and streamed back. A
  WebSocket upgrade is spliced at the socket level (request line, headers,
  then every frame both ways), so the owner authenticates and the client gets
  the owner's own handshake, SNAPSHOT and DELTAs. Spectators use the same
  route and follow the same way.
- **Live feeds at the moment of a move.** When a unit moves, the old engine
  closes every local socket of its tables with 1012 (`closeTableForHandoff`);
  the client reconnects at once on its ordinary ladder
  (`src/services/EngineStateClient.ts`), through the same port, and lands on
  the owner with a fresh SNAPSHOT. When a unit comes back (a return), relayed
  sockets for it are closed so they reconnect to the engine that deals it.
- **After retirement** everything except `/internal/rolling-handoff/*` is
  relayed (HTTP, every upgrade including `/ws/multi` and `/ws/channel`) and
  the old engine's own remaining sockets are closed 1012 so they reconnect
  through it. The old process is then a pure proxy until the Caddy change.
- **Never from the wrong engine.** Local state is the only state an engine
  serves. A peer that cannot be reached is answered `503` with `Retry-After: 1`
  (HTTP) or a `503` handshake refusal (WebSocket), which every client retries;
  never 404 or close 4404, which would put the client on its slow "table gone"
  ladder. A request that already came through a relay
  (`x-engine-handoff-relayed`) is never relayed again.
- **Successor watchdog (old engine).** While yielding it probes the peer's
  `/internal/rolling-handoff/status` every 2 s; three failures in a row (or a
  different `instanceId` on the port, a restarted successor that adopted
  nothing) abort the yield. Units still here deal on; units the dead successor
  held go stale in 30 s and the old engine, serving again, re-admits them from
  the database through discovery.
- **Tournament channel mirror (successor).** While it is a successor its
  tournament channel broadcasts are replayed on the front door through the
  existing `POST /channels/tournament/:id/event` (internal key), so lobby and
  standings clients still connected to the old engine see moved events.
- **Mux sockets** (`/ws/multi`, off by default client-side behind
  `ca_ws_mux`) are closed 1012 when one of their tables moves; while the old
  engine is still yielding a reconnected mux socket is served by the old
  engine and a moved table on it answers TABLE_NOT_FOUND (retried) until
  retirement, after which mux is relayed whole.

### The Caddy Change The Pipeline Makes After Retirement

`server/Caddyfile`, inside the `engine.smarter.poker { ... }` block, exactly one
line changes:

```
-    reverse_proxy localhost:8080
+    reverse_proxy localhost:8081
```

then `caddy reload --config /etc/caddy/Caddyfile` (graceful: open connections
finish on the old upstream, which is the relay to 8081 anyway). Prove public
`/health` names the successor's `instanceId`, then stop the retired container.
Nothing else in the Caddyfile changes. The next rolling release swaps the two
ports' roles (the serving engine on 8081 yields to a successor on 8080, and
the line goes back), or the pipeline renames containers as in step 3 below;
either way it is one upstream line.

## Still Not Built

**Pipeline wiring** (below), including the Backup rehearsal, is the only
remaining activation blocker and belongs to the pipeline pull request. The
flag stays OFF in production until it lands and a Backup certification with
`rollingHandoff.verdict == "pass"` exists.

Lightning host tables are kept by the old instance in this phase
(`lightning_cluster_stays`); the old instance does not retire while a Lightning
host is active. A rolling window must also end before the daily 04:00 break
announcement: the successor does not run the break, so a break that begins
mid-window parks only the old engine's tables (the coordinator already refuses
to move anything during a break).

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

`server/src/handoff/rollingHandoffSuccessorAndRelay.test.ts` (10 tests): two
GameServer instances in this process, each behind its own real HTTP listener
on its own loopback port, with the real router, real EngineWebSocketServer,
a real TableStateHub each, the real coordinator and the real relay, over the
same lease database fixture; clients are real `ws` sockets and HTTP requests
aimed only at the old engine's port. Proven: a player and a spectator
connected through the old engine are closed 1012 at the move, reconnect
through the same port and keep receiving the table's SNAPSHOT and DELTAs from
the new owner; the player acts through the front door and only the new
engine applies it; a new connection and a fresh read land on the owner; a
table that stayed is served locally with its POST body intact; the successor
refuses an unhanded table (no lease written) and an unhanded tournament; the
successor's leadership claim is refused while the old engine leads, no
singleton job ever runs on both, and leadership passes only after the old
engine retired and ran its stop; after retirement the old engine relays
everything; with the flag off there is no relay, no successor phase and the
router answers byte for byte as before. Failure paths: the successor dies
mid-handoff (one table adopted, one handed but never claimed) and the relay
target is unreachable from the start: moved tables answer 503 (never served
from the old engine), the upgrade is refused and retried, the old engine's
own tables keep dealing and accepting actions, the watchdog aborts the yield
after three failed probes, and the old engine re-admits the moved tables
with every seat and stack intact; nothing throws. A source check proves both
dealer admissions ask `refusesHandoffAdmission` before claiming a lease.

`server/src/services/leadershipHandoffSuccessorClaim.test.ts`: the successor
claim becomes leader only on an explicit grant and never self-promotes on
errors, empty answers or a named holder.

## Pipeline Wiring Steps (Next Pull Request, After The Engine Window)

Do these only after the 8 PM Chicago release-input hold ends and with release
custody. Classic cutover stays the fallback for every step.

1. **Bootstrap release (classic, one time).** The serving engine must itself
   contain this code before it can yield. Ship Phase 2 plus the successor boot
   role and routing relay through one ordinary 04:00 cutover with
   `ENGINE_ROLLING_HANDOFF=on` and `ENGINE_HANDOFF_PEER_PORT=8081` in the
   engine env file. With the flag on and no
   yield requested, the only added work is one `fn_engine_handed_leases_v1` read
   per second.
2. **`server/scripts/engine-up.sh`.** Add `--successor`: start the candidate as a
   second container (`club-arena-engine-next`) on loopback port 8081 with
   `ENGINE_ROLLING_HANDOFF=on`, `ENGINE_ROLE=handoff-successor`, `PORT=8081`
   and `ENGINE_HANDOFF_PEER_PORT=8080`, without stopping `club-arena-engine`.
   Same image validation, labels and env file (the three overrides win).
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
   - success: old status `mode == "retired"`; the old engine has already
     stopped its leader jobs and released leadership by itself, and the
     successor's 8081 `/health` shows `leadership.role == "leader"` and
     `rollingHandoff.role == "serving"` within about 5 s (wait up to 60 s,
     refuse otherwise); then make the Caddy change above, prove public
     `/health` names the successor `instanceId`, rename containers
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
