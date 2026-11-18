# A Lightning Join Retry Is Its Own Attempt

Dan, 2026-11-10: "fix the known second-Confirm gap so a retry after refusal is measured correctly without duplicating the first report."

## The gap

A refused or failed purchase leaves the buy-in question open, and the player may press Confirm again. The refused attempt had already ended in its one report (#10412), so `active` was empty and the retry's `markLightningJoin('confirm')` did nothing: the second attempt, the one that often succeeds, was never timed.

## The fix (client only)

- `confirmLightningJoin(clusterId)` in `src/lightning/lightningJoinTiming.ts` replaces the entry page's `markLightningJoin('confirm')`.
  - With a join running, it is that join's `confirm` mark, exactly as before.
  - With none running (the previous attempt already reported), it starts a new attempt whose zero is the retry press: marks begin `{ confirm: 0 }`, with no `click`, and the same 3-minute timer (a retry that never paints ends once as `timeout`/`NO_PAINT`).
- The refused attempt's report is never resent or changed. Closing the question after a refusal sends nothing more.
- No database change: the sink accepts any non-empty whitelisted marks and derives the stage from them. A retry adds samples to the post-confirm stages (hold, purchase, seat read, route, socket, snapshot, pool wait, paint) and never to `player_decides`, `open_question`, `click_to_cards` or `system`, which all need a `click`.

## Tests

- `tests/lightning/lightning-join-timing.test.ts`: first Confirm is still a mark; refuse-then-retry-succeed; refuse-then-retry-refuse; refuse-then-abandon; a retry that never paints times out once. The wiring pin now names `confirmLightningJoin(clusterId)`.
- `tests/unit/lightningJoinRetrySink.pg.test.ts` (both sink migrations on real PostgreSQL): the refused attempt and its retry are two rows with their own reasons and stages; the retry counts in `hold_chair`, `purchase` and `hand_to_paint` only; eight reports from one player inside a minute (a refusal plus seven retries) are all accepted under the ten-a-minute limit.
