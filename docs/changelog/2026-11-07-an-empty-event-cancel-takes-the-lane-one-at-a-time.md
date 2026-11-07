# 2026-11-07 - An Empty-Event Cancel Takes The Lane One At A Time

## What happened

At 20:05:12 UTC the engine sent about thirty `POST /rpc/atomic_cancel_tournament` calls in 100 ms; PostgREST answered each with 500, and Postgres logged `CANCELLATION_GLOBAL_LANE_BUSY` for every one. Single refusals followed at 20:09:22, 20:09:40, 20:11:50 and 20:12:54.

The caller is the engine's empty past-start cancel (`GameServer.launchEmptyEventCancel`, 2026-10-15): an event nobody entered, thirty minutes past start, whose horse top-up came back empty. `smarter_private.cancellation_lane` admits a cancellation only through a try-lock on the platform's exclusive terminal-settlement lane and refuses with SQLSTATE 55P03 when it is held, before writing anything. The engine launched every eligible event in the same pass, so all but one were refused by construction. Each refused event was reported as an error and parked for the full thirty-minute retry, all together, so the next round collided the same way.

The events were Midway Union Sit & Go boards (`sng-v1` with more than two seats is registration-first, so the rule applies). At 20:28 UTC 41 of them were still REGISTERING with no entrant, the oldest eight hours past start, while `tournament_cancellation_receipts` shows them cancelled at about one per pass.

## Fix

- `server/src/GameServer.ts`: `launchEmptyEventCancel` starts no second cancel while any is in flight in the process. The next eligible event goes on the next pass.
- A lane-busy refusal (`isCancellationLaneBusy`: 55P03 with `CANCELLATION_GLOBAL_LANE_BUSY` or `CANCELLATION_BARRIER_BUSY`) committed nothing, so it is logged and asked again after `EMPTY_PAST_START_LANE_BUSY_RETRY_MS` (one minute) without an error report. Every other refusal keeps the thirty-minute clock and its report.
- The database lane, the cancellation authority and the eligibility rule are unchanged.

Tests: `server/src/tournament/anEmptyPastStartEventIsCancelled.test.ts` (lane cases) and law `tests/an-empty-event-cancel-takes-the-lane-one-at-a-time.law.test.ts`.

This is an engine change. It installs through the normal engine release path at the daily 4 AM Chicago window.
