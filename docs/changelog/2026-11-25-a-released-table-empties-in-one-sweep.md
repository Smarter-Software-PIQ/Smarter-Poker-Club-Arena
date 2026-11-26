# A Released Table Empties In One Sweep (2026-11-25)

Follow-up to `2026-11-24-a-horse-only-extra-table-yields-to-an-owed-main.md` (#12011) and `2026-11-25-a-draining-horse-is-never-folded-out-of-a-live-hand.md` (#12037).

## What Was Wrong

The drain stood up one Horse per 90 second cycle at the released table. A leave is cashed out by the `leave_pending` sweep in `prepareNextHand`, on the path to the next deal, so every departure lengthens the gap before the next hand. Production, last three hours, cash fold hands with no bust: with a departure the gap was 3,357 ms at the median and 6,820 ms at p95 (n 234); without one, 3,353 ms and 4,832 ms (n 5,419). One Horse per cycle made the released table pay that five or six times in a row. The Backup's hand-gap judge refused build 9c6fd56475c7 (Backup 45753629342) with its five slowest fold hands all on table 692e3a49, the PLO6 0.10/0.25 Classic feeder this drain releases.

## Why It Broke

The drain was paced like an ordinary shift departure, which spreads leaves out so a floor thins naturally. A released Horse-only table has no reason to thin slowly, and spreading the leaves multiplied the one cost every leave carries.

## The Change

**File:** `server/src/services/HorseSessionRotator.ts`
**What changed:** every Horse at the released table that is not holding cards in the hand (and owes no hands in profit or big-pot orbit) is stood up in the same cycle, so the leaves land in one sweep. Horses still in the hand follow on the next cycle, after which the table is empty and deals no further hand. A released table now costs at most one or two slow gaps and empties in about three minutes instead of nine to fifteen. Everything else is unchanged: which table is released, never a table with a person, never Main 1, never Lightning, never a table that is breaking.

## Hardening

`server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`: every Horse that can go leaves in one cycle; the Horses not in the hand go together and the ones in the hand stay; owed hands are still played first; a table where every Horse is in the hand releases nobody. Reverting the change fails the first two cases.

## Open, Not This Lane's

The cost of a departure on the deal path itself (about 1.5 to 2 seconds at p95 on every table, for people and Horses) is the engine's; the evidence went to the Hand-Gap Root-Fix lane for incident 1e532243.
