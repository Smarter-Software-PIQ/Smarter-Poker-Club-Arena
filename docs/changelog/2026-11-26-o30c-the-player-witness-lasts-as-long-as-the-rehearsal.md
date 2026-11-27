# O30c: The Player Witness Lasts As Long As The Rehearsal

Date: 2026-11-26 (Chicago). Lane: release custody.

## Why It Broke

The rollback rehearsal of `45b110c9d873` (run `45918356098`, 18:51 to 19:05 CST) was refused with `rollback_rehearsal_failed_to_396283f68a7f`. The O30b log showed the serving build adopted the break, thawed and resumed 31 tables, and the swap verdict passed (cause `unnamed`, no reasons). The refusal came from the player witness in `server/standby/player-reconnect.mjs`. It had a fixed 12-minute total deadline, while `trial_swap` allows the break until `t0 + 1800 s` to thaw and then 1200 s to deal. On today's 207-seat copy the last-hand drain alone took 483 s, so the witness gave up before the thaw. The earlier "rollback never thaws" refusals on 120-seat copies fit the same timing. The copies grew during the day; the witness budget did not.

The O30b log mask also hid the thaw error code, because it masked every run of 40 or more word characters.

## How It Was Fixed

- `player-reconnect.mjs`: one budget, `WITNESS_BUDGET_MS = (1800 + 1200) * 1000`, the trial's own thaw deadline plus dealing wait. No phase has a shorter cap.
- `rehearsal_engine_log`: masks JWTs and 32+ character runs that mix digits and both letter cases. Error codes and lowercase hex release SHAs stay readable.

## What Stops It Returning

`tests/a-failed-rehearsal-names-its-cause-and-spends-the-copy.law.test.ts` reads both numbers from `standby-trials.sh` and requires the witness budget to equal their sum, refuses any shorter per-phase cap, and checks that the mask keeps an error code and a release SHA.

## Verification

- The law file passes 12 of 12; `backup-cert-checks-lifecycle-logs` passes 32 of 32.
- `player-reconnect.test.mjs` fails in this cloud clone on unmodified main too (no `ws` package); CI runs it.
- Live proof: the next certification on a large copy.
