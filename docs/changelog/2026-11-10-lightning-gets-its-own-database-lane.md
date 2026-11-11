# Lightning Gets Its Own Database Lane

Dan, 2026-11-10 (follow-up item 2 after the Lightning session): isolate Lightning's database connections so another subsystem cannot slow it down.

## Why

On 2026-11-10 a tournament settlement lock storm (#10361) held the shared PostgREST connection pool. Lightning queued behind it: settlement averaged 979 ms against 141 ms, matching 130 ms against 59 ms, buy-ins took up to 15.4 s and fold-to-next-hand p50 reached 13 s in storm minutes. The root of that storm is fixed (#10368). The original fast fold was never affected, because since 20261020160107 it runs on its own restricted database login. This change gives the rest of Lightning's per-hand path the same protection, so the next storm in any other subsystem cannot reach it.

## What changed

- Migration `20261110213713_lightning_matcher_and_settlement_use_a_separate_restricted_s.sql`, the same shape as the fold lane:
  - a separate LOGIN role `engine_lightning_lane` (no table privileges, no service_role or postgres membership, connection limit 16, 8 s statement budget like a PostgREST service request);
  - its connection URL generated and stored in Vault inside the migration, read by the engine through the service_role-only `fn_engine_lightning_lane_session_url()`; no host secret, file or workflow input is involved;
  - one private wrapper, `smarter_private.fn_engine_lightning_lane(operation, args, actor_headers)`, owned by service_role, executable only by that login. It establishes exactly the authority a PostgREST service request has (role claims, data-actor headers, request path), runs the ordinary data-API pre-request guard, and calls one of four functions by a fixed name with typed arguments: `fn_lightning_match_and_form`, `fn_lightning_instance_begin_dealing`, `fn_lightning_bind_hand_number`, `fn_lightning_settle_hand`. Any other operation or argument key is refused. The entry big blind header the matcher reads is passed through when the engine sends it.
- Engine (`server/src/services/lightningLaneSession.ts`): a verified-TLS pool of six sockets on that login, one pipelined round trip per call (BEGIN, wrapper, COMMIT), durable only on a COMMIT command tag. The matcher (`LightningSupervisor`) and the hand backend (`LightningHandBackend`) try the lane first.
  - Lane not ready, credential absent, pool busy or acquisition over 100 ms: the call goes through PostgREST exactly as before.
  - A database refusal that rolled back: nothing happened, so the same call goes through PostgREST. A refusal raised by the wrapper or the catalog (session, privilege, missing function) also turns the lane off for the life of the process.
  - Dispatched with no knowable outcome (lost socket, request boundary): reported as the same transport failure a PostgREST error is today; every one of these functions is keyed by its own request or instance id.
- Metrics: `poker_lightning_lane_ready`, `_disabled`, `_active`, `_committed_total`, `_rolled_back_total`, `_unknown_total`, `_admission_refused_total` on `/metrics`.

## Proof before activation

- Engine: `lightningLaneSession.test.ts` (14 cases: lane selection, fallback before ready and without a credential, rolled-back refusal falls back, wrapper refusal disables, lost socket is an unknown outcome, non-COMMIT is unknown, entry big blind header, URL validation); the raw-session guard `TournamentManagerRequestFence.guard.test.ts` admits this lane by name with the fold lane's pins; server Lightning suite 55 files, 678 tests; typecheck clean.
- Database (2026-11-10 22:10Z, production, one self-aborting transaction, nothing kept): a pg_temp copy of the wrapper's dispatch, without only its session check, ran all four functions with the engine's argument shapes through the data-API guard. Each returned its ordinary answer for unknown ids (`not_found`, `hand_not_found`, `formed: 0`), and an unexpected argument key was refused with `LIGHTNING_LANE_ARGS_INVALID`.

## Activation

The migration installs on merge through the protected route (no hot-table lock). The engine half is in `server/**` and activates only at the 04:00 America/Chicago daily window. Until then, and on any engine that cannot reach the lane, behaviour is unchanged.

## Measuring it after 04:00

1. `/metrics`: `poker_lightning_lane_ready 1`, `_committed_total` rising, `_unknown_total` and `_disabled` at 0.
2. `pg_stat_activity` where `usename='engine_lightning_lane'`: six sessions per engine process.
3. Lightning latency ledger: settlement and match-to-hand p50/p95 per 10 minutes, compared with the shared pool's statement timeouts in the same minutes. During any future storm on the shared pool, Lightning settlement should stay near its quiet p50 (about 141 ms) instead of tracking the storm.
