# 2026-11-18 - The bets sweep is held only when it plays (hand delay, lane D2)

Owner requirement (Dan, 2026-11-17 22:22 CT): "hand delay" is the time to
finish one hand, move the button and start the next; under a second, two
seconds at most.

## What the gap is made of (production, hand_history, 2026-11-18)

`ended_at` is stamped when settlement starts at HAND_COMPLETE
(`acceptedHandEndedAt`, ServerTableEngineSettlement.ts), i.e. BEFORE the
completion hold; `started_at` is the next hand's HAND_START. So the measured
gap is `hold + rest + post-rest deal work`.

| Classic cash / tournament, 45 min | n    | p50    | p95    |
| --------------------------------- | ---- | ------ | ------ |
| cash, no showdown                 | 420  | 3.35 s | 3.50 s |
| cash, showdown                    | 124  | 6.25 s | 7.04 s |
| tournament, no showdown           | 1172 | 3.85 s | 4.09 s |
| tournament, showdown              | 749  | 7.29 s | 8.61 s |

- Fold: sweep 500 + pot push 1100 + muck 250 (hold 1850) + rest 1500 = 3350.
  Cash engine overhead after the rest is about 5 ms.
- Showdown: read 1400 + display 1500 (2000 all-in) + 1850 + rest 1500 = 6250
  (6750 all-in).
- Tournaments carry about 0.5 s more after the rest: the F06 hand-number state
  read, `fn_f06_begin_hand` and the seq-0 `fn_f06_retain_hand_continuation`
  write run serially between the rest and HAND_START.
- Lightning tables share one `table_id` across concurrent pooled hands, so a
  same-table gap there is negative half the time. That is where the
  "bimodal" cash numbers came from; it is not a delay.

## The change

`handCompletionHoldMs` counted BETS_SWEEP_MS on every hand. TablePage plays the
sweep only when chips are still on the felt at pot_win (`betsStillOnFelt`).
On a showdown whose river carried no chips, an all-in run out or a river
checked through, nothing is on the felt: the river's collect ran when it was
dealt and pot_win comes 1.4 s after WINNERS. The hold sat 500 ms after the muck
with no animation playing. 97% of tournament showdowns and 70% of cash
showdowns were measured in that state.

- `HandCompletionOpts.betsSweepOwed` (both spec mirrors): `false` drops the
  sweep from the hold; default true; ignored on run-it-multiple hands.
- `server/src/engine/ShowdownSweepOwed.ts` proves it from the hand's own
  record and keeps the sweep for anything it cannot prove (fold wins, RIT,
  short board, non flop-game streets, any river chip).
- The engine hold passes it (ServerTableEngineDealing.ts).

No animation is shortened: the float still lands exactly one muck before the
table is free (`tests/the-next-deal-follows-the-pushed-pot.law.test.ts`). The
rest (Rabbit Hunt window), the rebuy pause and every display beat are
untouched. Nothing reads a horse marker.

Expected: tournament showdown p50 7.29 -> about 6.80 s, p95 8.61 -> about 8.12 s;
no change on fold wins.
