# Owner retirement cancels a dead generation hand (2026-11-05)

Dan: "HARD CODE FIX THIS AT ITS ROOT CAUSE SO IT STOPS HAPPENING."

## What was wrong

Six owner-retired Diamond satellites (horse-only, started October 29-31, their
targets long finished) stayed RUNNING with their stop requested. Each table held
one reserved hand from an engine generation that no longer existed, retained
for continuation:

- the abort cannot certify while that hand is pending;
- the engine does not continue a hand in an event whose stop was requested;
- the abandoned-generation door refuses a retained hand
  (`HAND_CONTINUATION_UNSETTLED`);
- the door that closes exactly this hand (`fn_ca_cancel_tournament_abort_unsettled_hand`,
  `aborted_unsettled`, credits nothing) admitted only the equal-share closure,
  which the owner's November 3 retirement order had superseded.

So the owner-retirement path could never finish these events.

## The fix

- Engine: the abort closure mode is `'equal_share' | 'owner_retirement'`; either
  one cancels the dead hand through the audited door instead of parking a hand
  that can never finish.
- Database (`20261105170409`): the door and the cancelled-boundary certificate
  admit `owner_retirement` only for an event in
  `smarter_private.owner_tournament_deletion_intents` under the owner's chat.
  Every other refusal is unchanged.
- Control: `owner_cancel_ack` is `owner_ack` asking for that closure.

No money moves in the fix. Each event then retires through the existing owner
retirement (`fn_ca_owner_retire_tournament`), exactly like the 119 before it.

Pinned by `tests/owner-retirement-cancels-a-dead-generation-hand.law.test.ts`
and the engine and control tests.
