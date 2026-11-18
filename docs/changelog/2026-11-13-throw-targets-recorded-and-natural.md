# 2026-11-13: Throw Targets Recorded, Natural And Spread Out

Dan: build all three follow-ups to the 2026-11-12 horse throwables fix (PR #10686).

## 1. Record Who Gets Hit

`throw_usage` and `throwable_use_receipts` held thrower, item and time, never the table or the target. Migration `20261113123902_record_throw_targets.sql` adds `public.throw_targets` (one row per charged throw, keyed on the receipt) and two doors:

- `fn_record_throw_target(request, table, target seat)`: the browser, as `auth.uid()`, after the charge and broadcast (`throwableService.recordThrowTarget`, called from `useTableAnimations.handleThrowableSelect`).
- `fn_horse_record_throw_target(horse, request, table, target seat)`: the engine (`HorseTableGestures.throwItem`), service role only, binds a horse's id exactly like `fn_horse_use_throwable`.

Only a throw the caller was charged for can be recorded, once. The target player is resolved server-side from the seat. `fn_use_throwable_v2` (the charge) is untouched; a failed record never affects the throw. No foreign key to hot tables. Clients cannot read or write the table.

## 2. More Natural Annoy Targets

`pickAnnoyTarget` weights the pot winner 4, showdown players 2, anyone else seated 1 (`ANNOY_WEIGHT`). Deterministic per horse and hand. Horse or human is never read.

## 3. No Repeat Needling

A horse remembers who it threw at for `REPEAT_TARGET_WINDOW_MS` (20 minutes) and skips them while anyone else is available, for annoy throws, won-showdown throws and untargeted all-in throws. A lost-showdown throw still goes at the winner, and a lone opponent is still a target.

## Pins

- `tests/fixtures/throw-targets/*` + `scripts/dev/test-throw-targets-postgres.sh` (wired into `test-data-console-postgres-contracts.sh`): horse-to-horse, horse-to-human and human-to-horse rows, idempotence, foreign receipts and uncharged throws refused, person never bound as a horse, left seat recorded with no player, grants.
- `server/src/services/HorseTableGestures.test.ts`: target record call per throw and none on a refused charge; weight distribution; recency skip and fallback; real throws remembered.
- `tests/unit/ThrowableService.test.ts`, `tests/unit/useTableAnimationsApprovedThrow.test.tsx`: browser record call.
- `tests/a-horse-throws-at-every-player.law.test.ts`: both callers and the FK-free table.

Client and database land on merge; the engine half activates in the next 04:00 America/Chicago window.
