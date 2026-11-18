# An unknown add-on outcome is not a new purchase

2026-11-11. Tests only. No engine behaviour, schema, client or configuration change.

## Why

The Horse session rotator presses Add Chips with `engine.addChips(userId, amount)`
and holds no operation id (`server/src/services/HorseSessionRotator.ts`). The
database half of that door is proven on PostgreSQL 17 by
`scripts/ci/probes/chip-journal-atomicity/test_addon_receipts.py` (#10528). The
engine half had cases for a caller that supplies its own id
(`AutoTopUpReplay.test.ts`) and none for the rotator's shape, and none for the
cash outcome that stays unknown after the receipt has been read.

## What is added

`server/src/engine/AnUnknownAddOnOutcomeIsNotANewPurchase.test.ts`, seven cases
on the real `ServerTableEngine.addChips` with the funding RPC and the receipt
reader mocked:

- a direct add-on that cannot be confirmed either way asks twice under one key,
  reads the original receipt, credits nothing and retires the table generation
  with `addon_direct_outcome_unknown`;
- the same when the receipt read itself fails after the lost reply;
- a queued add-on with an unknown outcome credits nothing, retires nothing and
  hands the question to the original pending owner;
- an empty wallet is a verdict: asked once, nothing retired;
- one invocation keeps one key through a lost first reply, and the next
  invocation mints a new key of the form `addon:<table>:<user>:<id>`;
- the next invocation is sized to the room the table has left and is refused at
  the maximum without calling the funding door;
- chips still queued from the earlier invocation count against that room.

## Limits

The RPC and the receipt reader are mocks; the real transaction is the #10528
case. The rotator's own pass (its seat, wallet and ledger reads) is not driven
here. No production add-on was made, and no natural 5/10 Horse top up has been
traced from operation to wallet and seat.

## Verified

Local, Node 22.23.3: 7 of 7 pass on the unchanged engine source. No defect was
found, so there is no failing-before run to show.
