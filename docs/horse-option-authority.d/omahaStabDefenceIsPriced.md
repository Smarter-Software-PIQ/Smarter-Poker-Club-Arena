# omahaStabDefenceIsPriced: Authority For The Live Switch

Built 2026-11-20 by EMERG lane STAB-DEFENCE (PLO-OWNER lead-2) on the owner's orders of 2026-11-20 3:05 PM and 3:15 PM Chicago. Evidence NOT MET: the option is registered, default off, and not graded yet. This file does not authorize switching the option on.

## What It Does

PLO4/PLO5 cash (tables and Lightning), turn and river (`server/src/engine/HorseOmahaStabDefence.ts`). Where the facing-bet verdict prices the first wager of the street (never a raise), the bettor's non-value share is priced from his own lifetime public frequency of first wagers on unopened action of that street (per game, street, heads-up or multiway) against the population's, shrunk n / (n + k) with the measured k of the cell. One provider and one formula for every opponent (`HorseMind.setOmahaLifetimeStreetRecordProvider`; the opponent HUD's lifetime counts through `HorseOmahaLifetimeHudAdapter.ts`).

Public information only: counts of public actions; no name, account, person/Horse flag or card. With no provider or no record the price is the population prior exactly, so the option changes nothing until lifetime counts are wired and backfilled. Receipt `omaha_stab_defence_priced`. Default OFF (read `=== true`), switchable live, scopable per game (`horse.omahaGameScope.omahaStabDefenceIsPriced`).

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/STAB-DEFENCE.md, STAB-DEFENCE-2.md and STAB-DEFENCE-3.md. Criteria: CRITERIA-STAB-DEFENCE.md with amendments 1, 2 and 3 (declared before any grade run). Development only so far (bench seed 20261120); the grade and the journal replay count are not run.

- Replay: NOT RUN (the audited-set scorer was not run; a count-only journal replay with the as-of lifetime provider was run 2026-11-21 by lane LEAK-LOOKS-1 on the four-option set at 480147eb1ef4: 7,532 turn and river decisions, 484 changed, 16 with a person live from 2 persons, INSUFFICIENT under the person bar)
