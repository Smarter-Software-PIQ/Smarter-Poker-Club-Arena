# omahaStrongHandSlowplayMix: authority for the live switch

Owner text of 2026-11-15 14:13 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

PLO4/PLO5 cash, pot limit, high only, one board, not bomb pot, not Lightning (HorseOmahaStrongHandSlowplayMix.ts): a strong hand does not always raise and does not always bet. Facing a bet, a raise with the nuts or the top full house becomes a call some of the time; facing no bet, a bet with a set on a very dry flop becomes a check some of the time. The share is drawn from a seeded unit for the spot, never from the brain's random stream, and moves with the opponents' measured reads. It only ever turns a raise into a call or a bet into a check: it never folds, never makes a bet where the owner-ruled checks or the made-hand defence checked, and sits inside omahaTurnRiverRaiseNeedsNuts (the outermost raise rule), so it adds no raise.

Its game gate goes through omahaStrategyGameInScope (PLO4/PLO5; PLO6 only with the PLO6 lane's omahaStrategyInPlo6). Tournaments are out for now: omahaStrategyInTournaments does not open this option.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaStrongHandSlowplayMix docs/horse-option-authority.d/omahaStrongHandSlowplayMix.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's order it rests on (verbatim, as given)

- 2026-11-15 14:13: "ITS OK FOR HORSES TO JUST CALL WITH THE NUTS, OR JUST CALL WITH TOP FULL HOUSE. THEY SHOULDN'T ALWAYS RAISE 100% OF THE TIME, AND THEY SHOULD CHECK SOMETIMES WITH A SET ON SUPER DRY BOARDS. ... IT SHOULD BE IMPLEMENTED TO SOME DEGREE FOR A BALANCED RANGE."

## Receipts

omaha_strong_hand_slowplay_call, omaha_strong_hand_slowplay_check (HorseDataLedger.ts).

## Tests

HorseOmahaStrongHandSlowplayMix.test.ts; HorseOmahaStrategyPrecedence.test.ts (it never converts an owner-ruled check, never folds, sits inside omahaTurnRiverRaiseNeedsNuts) and its tournament twin.

## Evidence rows

- Mechanism, scope, visibility, tests: MET.
- Option unset or false: decisions identical to the base.
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

The slowplay shares and the dry-board definition are the builder's constants, unmeasured.
