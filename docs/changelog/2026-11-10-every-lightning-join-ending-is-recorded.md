# Every Lightning join ending is recorded, with its stage and reason

Follows `2026-11-10-lightning-joins-are-timed-from-the-click-to-the-painted-cards.md` (#10394).

Dan, 2026-11-10: "measure the complete Join-to-visible-cards path, including failed attempts and tail latency. Fix demonstrated bottlenecks." Acceptance: natural joins only (no chips spent, no manufactured joins); sample sizes per outcome (successful, failed, abandoned) and per-stage timings; any percentile without enough samples is reported as unknown, never estimated.

## What was missing

#10394 sent a join only when its cards painted or it timed out three minutes after a confirmed buy-in. A join that was refused (signed out, frozen, no seat, not enough chips), failed (a door could not be read, a purchase was not confirmed) or abandoned (the question closed, the page left, Join pressed again) sent nothing, so a door turning players away was invisible and the tail was only the tail of joins that worked.

## What changed

- **Client** (`src/lightning/lightningJoinTiming.ts`): every join that starts ends in exactly one report.
  - `painted`: cards on screen.
  - `refused`: `SIGN_IN_REQUIRED`, `NOT_TAKING_PLAYERS`, `PLATFORM_FROZEN`, or the buy-in door's own code (`INSUFFICIENT_CHIPS`, `SEAT_TAKEN`, `NO_SEAT_OPEN`, `WAITLISTED`, ...).
  - `failed`: `BUYIN_CONTEXT_FAILED`, `BUYIN_UNCONFIRMED`, `EARLIER_BUYIN_PENDING`, or a door code.
  - `abandoned`: `DIALOG_CLOSED`, `LEFT_PAGE` (only before a seat was bought), `REPLACED` (Join pressed again), `QUESTION_IDLE` (three minutes on the question without confirming), `PAGE_CLOSED` (sent on `pagehide` with `keepalive`).
  - `timeout`/`NO_PAINT`: three minutes after a confirmed buy-in or a rejoin with no cards.
  - Reason codes come from `lightningJoinReasonCode()`, which keeps only an upper-case `WORD_WORD` token from a door's error (or `PG_<sqlstate>`), never the message, an amount, an id or a name.
  - Sending now uses a plain `fetch` to the RPC (as the client error sink does), so the report can go with `keepalive` from a closing tab. `buyIntoLightning` results carry a `code`.
- **Database** (migration `20261110225742`):
  - `client_lightning_join_timings` gains `reason_code` (`^[A-Z0-9_]{1,64}$`) and `ended_at` (the last mark reached, derived in the database from the marks, never taken from the client), and accepts the three new outcomes.
  - `fn_report_lightning_join_timing` keeps its rate limits (10/min per player, 200/min total) and 14-day write-time retention; a reason that is not a code is stored as `UNSPECIFIED`; painted keeps no reason.
  - `fn_lightning_join_timing_report(since, until)` now returns, per stage: n, p50, p95, p99, max and `ended_here` (joins that did not paint and stopped in that stage). **p50 is NULL below 5 samples, p95 below 20, p99 below 100**: unknown, not estimated. Durations leave out tabs that were hidden (their paint waited for the player); `ended_here` counts them.
  - New `fn_lightning_join_outcome_report(since, until)`: sample sizes by group (successful = painted; failed = refused, failed, timeout; abandoned), outcome, stage ended in and reason, with the hidden-tab count. Both reports are service_role only.

Stages, in order: rejoin_check, price_read, player_decides, hold_chair, purchase, pool_session_read, route_to_room, socket_connect, first_snapshot, pool_wait_to_hand, hand_to_paint; spans open_question, system, click_to_cards.

Not covered: a second Confirm in the same open question after a refusal is not timed as a new join (the refusal itself is recorded).

## Measurements

Natural joins only; no chips spent and no joins manufactured. See the report section below for the production readings taken after release.

## How to read it

```sql
SELECT * FROM public.fn_lightning_join_outcome_report(now() - interval '24 hours', now());
SELECT * FROM public.fn_lightning_join_timing_report(now() - interval '24 hours', now());
```

## Tests

- `tests/unit/lightningJoinOutcomeSink.pg.test.ts`: both migrations on real PostgreSQL; refused/failed/abandoned/timeout stored with derived stage and code; free text becomes `UNSPECIFIED`; percentiles unknown below their sample floors; `ended_here` per stage; outcome group counts; rate limit and retention kept.
- `tests/lightning/lightning-join-timing.test.ts`: one report per ending, `REPLACED`, `QUESTION_IDLE` vs `NO_PAINT`, `pagehide` with keepalive, confirmed or seated joins not abandoned by a closed question or page change, reason codes never carry text or amounts, wiring.
