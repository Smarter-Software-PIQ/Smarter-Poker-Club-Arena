# A refused decision carries its journal key, and the maniac call-down's cent call is a reference return

## What happened

In production, 1 of 789,282 eligible decisions was refused with reason
`reference_shape`: Lightning NLH 0.25/0.50, hand cc8a59bb. The horse played the
liveness fallback (fold) instead of its decision. The refusal could not be
explained. Its only record was the line
`horse decision worker returned invalid policy receipt: reference_shape`, which
names no hand. The decision journal keys a hand by
sha256(`tableId:handNumber:leaseIdentity`). The lease identity is not stored in
the database, so the refusal could not be joined to its journal decision record.

## The cause

`referenceReturnShape` (`server/src/engine/HorsePhase6Attribution.ts`) checked a
`call` on every route as `amount === min(currentBet - heroBet, heroStack)`.
On the `variant_price` route the reference's maniac call-down
(`HorseLogic maniacCallDown`) can turn the route's fold into a call. It returns
`Math.round(call * 100) / 100`. At cent stakes the subtraction is not exact. A
3-bet to 3.45 over a 1.15 open owes 2.3000000000000003, the call-down returns
2.30, and the strict equality refused the horse's own legal call. Integer-chip
tables never produce an inexact difference, so only a cent-stakes Lightning table
showed it. Every other input matched: the route gate passes, and the raw call,
fold, all-in and V53 4-bet checks were already correct.

This was found by reading the validator against each route's real returns. The
new guard test reproduces it end to end through the real `maniacCallDown` and the
real validator. It fails without the fix.

## The fix

- **Root:** on `variant_price` the shape check now also accepts exactly
  `Math.round(call * 100) / 100`, the call-down's deterministic return. Every
  other amount, and the rounded value on any other route, is still refused.
- **Diagnostic context on the existing record:** every refusal raised by
  `refuseDecision` is now a plain `Error`. The message line is unchanged, so the
  `inspect-tournament-refill.py` parser still matches it. The error also carries
  a flat `refusal` property, which Node prints next to the stack in the existing
  `horse_decision_worker_failed` / Lightning host log line:
  - `journalHandKey` / `journalTurnKey`: the exact sha256 keys that the worker
    stores this request's `decision` and `request_lifecycle` journal records
    under. A refusal now joins its journal record directly, not by time
    correlation. `journalKeyStatus` says `unavailable` rather than guessing.
  - for a Phase 6 refusal: route, returned action and amount, the expected call
    (raw and in cents), the expected V53 raise target, min/max raise, current
    bet, the hero's own bet and stack, big blind, live players, live responders,
    preflop raises, whether the raiser is all in, whether a raise is legal,
    stage, mode, variant and structure.

  The context holds only hashes and public table facts: no hole card, no
  opponent read, no user id. It is a fixed set of scalars. There is no new
  table, monitor or cron.

## Tests

- `server/src/engine/aManiacCallDownCentCallIsAReferenceReturn.guard.test.ts`:
  the live shape reproduced through the producer, the admission, exact cent
  cases, refusal of every other amount and of other routes, and the public shape
  record.
- `server/src/engine/horseDecision/refusalContext.test.ts`: the keys equal
  sha256(`tableId:handNumber:lease`) and the journal turn key; the key is
  unavailable without a lease; the message and stack line are unchanged; the
  payload is bounded and private-free.
- `server/src/engine/HorsePhase6RouteRefusal.test.ts`: the live client's
  refusal carries the context.

Engine change: it activates only in the certified 04:00 America/Chicago window.
