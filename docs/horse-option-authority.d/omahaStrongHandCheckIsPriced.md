# omahaStrongHandCheckIsPriced: Authority For The Live Switch

Built 2026-11-20 by EMERG lane STAB-DEFENCE (PLO-OWNER lead-2) on the owner's order of 2026-11-20 3:05 PM Chicago. Evidence NOT MET: HELD by the lane lead; a development build that is not graded and lost chips to a never-folding opponent in development. This file does not authorize switching the option on.

## What It Does

PLO4/PLO5 cash, turn and river, heads-up, the Horse first to act with nothing to call (`server/src/engine/HorseOmahaStrongHandCheck.ts`). A final value bet is priced beside the check: the bet on the measured answer curve moved by the opponent's own lifetime public fold record to a street's first wager, the check on his stab frequency and his measured stab size, each shrunk by its evidence. The check is taken with the probability the comparison and its standard error give. It changes only a bet into a check.

Public information only. Receipt `omaha_strong_hand_check_priced`. Default OFF (read `=== true`), scopable per game (`horse.omahaGameScope.omahaStrongHandCheckIsPriced`).

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/STAB-DEFENCE-2.md and STAB-DEFENCE-3.md (development, bench seed 20261120 only): with the option on, the never-folding probe gains more than one standard error. Not graded.

- Replay: NOT RUN (held development build; not graded)
