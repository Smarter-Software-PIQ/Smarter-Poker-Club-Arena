# omahaRiverBetFoldIsHisRecord: Authority For The Live Switch

Built 2026-11-21 by EMERG lane STAB-DEFENCE-5 (PLO-OWNER lead-3) after the stab-defence grade under AMENDMENT-4 failed its calling-station guard. Evidence NOT MET: the option is registered, default off, and not graded yet. This file does not authorize switching the option on.

## What It Does

PLO4/PLO5 cash (tables and Lightning), river, heads-up (`server/src/engine/HorseOmahaRiverBetFoldRecord.ts`). It does nothing by itself. With `omahaRiverFirstToActBetIsPriced` or `omahaRiverCheckedToBetIsMeasured` on, the answer curve those rules price a river bet with is the population's curve with its fold share multiplied by the opponent's own lifetime public fold record at a river's first wager over the population's fold rate at the same sizes, shrunk n / (n + k) with k = 75.9 river answers (measured). The raise share of his continues is unchanged; the fold share's standard error grows with the record's, and the bet must still beat the check by more than the comparison's error.

Public information only: counts of public actions; no name, account, person/Horse flag or card. With no provider or no record the price is the population curve exactly, so the option changes nothing until lifetime counts are wired and backfilled. Receipt `omaha_river_bet_fold_his_record_read` (a read, not a changed action; the changed actions keep the two river rules' receipts). Default OFF (read `=== true`), switchable live, scopable per game (`horse.omahaGameScope.omahaRiverBetFoldIsHisRecord`).

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/STAB-DEFENCE-5.md. Development only so far (bench seed 20261120): heads-up calling station, the two river rules alone +21.5 +- 13.8 bb/100 for the station; with the stab defence and this option +2.3 +- 10.4, the river rules' bets into the station falling from about 115 added called bets to 12 in 4,000 pairs. The grade and the journal replay count are not run.

- Replay: NOT RUN (the audited-set scorer was not run; a count-only journal replay with the as-of lifetime provider was run 2026-11-21 by lane LEAK-LOOKS-1 on the four-option set at 480147eb1ef4: 7,532 turn and river decisions, 484 changed, 16 with a person live from 2 persons, INSUFFICIENT under the person bar)

## Rollback

Clear the switch row (the release default is off). The two river rules then price the population curve for every opponent, as before.
