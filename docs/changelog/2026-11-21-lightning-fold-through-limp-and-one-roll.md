# Lightning fold-through: no release for an unraised limp, and one roll per early look

Date: 2026-11-21. Option: `lightningEarlyFoldNeedsFoldThrough` (default OFF, read `=== true`; nothing changes with it off or unset).

The authority file `docs/horse-option-authority.d/lightningEarlyFoldNeedsFoldThrough.md` ("Why those limps and weaker entries occur in NLH") named two mechanisms through which the fold-through re-ask added weak entries. Both are fixed at their source in `HorseLogic.decide` and `HorseLightningFoldThrough.ts`.

## 1. An unraised limp no longer releases an early fold

The fold-through frame folds the seats before the Horse. For an unopened small blind that makes the frame blind-vs-blind (`HorsePreflop.decidePreflopV7`: `bvb`, `oppsLeft === 1`), where a 75% complete mix runs down to `sbLimpFloor` (0.22, or the V70 floor). The early fold was released for that complete, and on the real turn the Horse completed with a bottom-quartile hand.

Rule (`lightningFoldThroughFrameIsUnraisedLimp`): when the frame's answer is a preflop `call` into a street with no voluntary aggression (a first-in limp, an over-limp or a small-blind complete), the early fold stands (receipt `lightning_fold_through_limp_kept`), unless the answer carries a strength-gated Lightning cheap entry branch (`lightning_cheap_entry_sb_complete`, `lightning_cheap_entry_over_limp`), which is its own default-off option with its own price bar. Raises, calls facing a raise, all-in answers and every postflop answer are unchanged.

Why this rule and not a rewrite of the frame's blind-vs-blind state: the real table can fold to the small blind, so the frame's `bvb` is a spot the Horse can reach. What was wrong was releasing for the mixed complete. The early look exists so a Horse does not press a fold that its real turn would reverse for strength reasons (owner, 2026-10-24: "HORSES SHOULD FOLD RIGHT AWAY IF THEY WERE ALREADY FOLDING"), and the standing Lightning rule forbids meeting the VPIP floor with indefensible entries.

## 2. The frame ask replays the first ask's roll

The frame ask drew from the shared `fastRandom` stream where the first ask had left it, so `decidePreflopV7Glue` took a second, independent `strengthJitter` and a mixed border hand got two chances to survive the early look. The stream position is now saved before the first ask (`saveFastRandom`), restored before the frame ask, and put back to where the first ask left it after the frame ask (in a `finally`, so a throwing frame restores it too). A border hand gets one roll. The option also no longer consumes any draw that the option-off decision would not, so the stream after the decision is the same with the option on or off.

## Tests

`server/src/engine/HorseLightningFoldThrough.test.ts`, six new tests (all six cases fail on the code before this change; checked by running them against it):

- an unopened small blind whose frame answer is a complete keeps the early fold, and fires `lightning_fold_through_limp_kept`;
- a button first-in limp keeps it, and a raise still releases it;
- a call facing a raise, and a cheap entry complete, still release;
- the predicate covers only preflop unraised calls;
- the frame ask's first draw equals the first ask's, and the stream ends where the option-off ask leaves it;
- a frame ask that throws still restores the stream.

`HorseLightningCheapEntry.test.ts` (21), `anEarlyFoldNeedsTheFoldThrough.regression.test.ts` (6) and `HorseDataLedger.test.ts` (11) pass unchanged.

## Not done here

No evaluation was run. The five-cell reading of 2026-11-20 and the declared NLH half of 2026-11-21 both measured the code before this fix. The declared paired Lightning evaluation must be re-run on a revision that contains it. No switch row was written.
