# Omaha: the flop facing-bet verdict reads the bettor (default OFF, not evaluated)

Date: 2026-11-19. Lane: HORSE DECISIONS (PLO4/PLO5 cash strategy). One new option, off by default (read `=== true`): `omahaFlopVerdictReadsTheBettor`. Nothing is switched on by this change, and nothing here is evidence to switch it on.

## What was there

`omahaFlopFacingBetEv` (default OFF) prices a flop fold or call facing a bet as one expected-value verdict. It priced every bettor's flop bet as the same range (a value region and a non-value share set by the bet's share of the pot and the line), moved only by the pooled postflop read. The review of its audit regressions (archive `plo-handoff-review-01a1cbbd/flopev3-013U37/FINDINGS.md`) found that where it was wrong it lacked per-opponent information.

## What changed

With both options on, the verdict also reads the bettor's durable street record (public actions and board cards): how often he bets this flop texture on this line, and how often he bets the turn and the river, each beside players of his own kind (a person against persons, a Horse against Horses) and each moved from the kind's figure in proportion to his sample, with no threshold. The first gives one factor on the value share and the non-value share of his bet (slope measured on 11,378 first flop bets with the bettor's cards known); the second multiplies the share of later streets a non-value holding bets in the verdict's realization model. With no record for the bettor, the mind off or an unknown kind, the verdict is exactly as before. With the option off nothing runs and the record is never asked for.

## What it did on real decisions

Replay of the 563 audited flop decisions (the bettor's record rebuilt from his earlier hands; the journaled frames carry none): 11 decisions changed against `omahaFlopFacingBetEv` alone; by the committed scorer fixed 1, newly wrong 4, unjudged 6. Newly wrong exceeds fixed. Of the five flop folds of sets and nut straights the audit named, four are called as before and 59710501 stays a priced fold. Not tuned on these decisions. No league evaluation has been run.

## Files

- New: `server/src/engine/HorseOmahaFlopBettorRead.ts` (pure read), `HorseOmahaFlopBettorRead.test.ts`.
- Added lines: `HorseOmahaFlopFacingBetEv.ts` (an optional bettor adjustment in the verdict's context and an optional factor in the runout realization; unchanged arithmetic without them), `HorseOmahaFlopFacingBetEvRule.ts` (asks for the record, one receipt), `HorseLogic.ts` (the option and one pass-through line), `HorseDataLedger.ts`, `HorseOmahaRuleSites.ts`, `HorseReferenceDecisionSources.ts`, `benchmark/HorseLeague.ts` (two cards; the league learns the street record for this option too), the league-card law (the option's consumer), the street-read law (law 8 admits the new reader), `HorseOmahaFlopFacingBetEv.test-support.ts` (one group name).
- NOT in this change: the option-switch follow-up migration and the proof script's list (`gen-horse-option-switch-sql.ts --check` fails until the lane's migration is generated).

Authority file: `docs/horse-option-authority.d/omahaFlopVerdictReadsTheBettor.md` (NOT EVALUATED).
