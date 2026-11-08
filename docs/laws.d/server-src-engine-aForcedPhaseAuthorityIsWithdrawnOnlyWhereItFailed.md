# server/src/engine/aForcedPhaseAuthorityIsWithdrawnOnlyWhereItFailed.law.test.ts

A Forced Phase Is Withdrawn Only Where It Failed: an owner rule that replaces an
authorised Phase 10-13 candidate after its receipt is finalized (the worker's
corrective policy and wager rules, the table door's commit correction) is not a
controller coercion. The receipt stops claiming the decision (`shadow_change`)
and records the action that left, which is how every 2026-11-07 phase withdrawal
on releases 40bc2467 and 391f7bc0 happened. A real coercion of a selected
candidate withdraws only its own `<variant>-<format>` authority domain, loudly
(a distinct receipt and a reported error), until the next boot, with no timer,
re-admission or retry. A decision whose domain cannot be named fails closed and
withdraws the whole gate.
