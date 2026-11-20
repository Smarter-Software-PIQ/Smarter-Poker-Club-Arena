# omahaOpenNeedsMeasuredStrength: Authority For The Live Switch

Built 2026-11-20 by EMERG lane PREFLOP-AUDIT on the owner's orders of 2026-11-19 7:38 PM Chicago ("ITS MATH FIRST ... based on real decisions, math and all the data and statistics they have") and 2026-11-20 12:01 AM Chicago ("EVERYTHING DEPENDS ON THE MATH AND THE CONCLUSIONS YOU COME UP WITH"). This file does not authorize switching the option on: switches are made only by the lead through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash (tables and the Lightning pools), high only, one board, no bomb pot, preflop, three or more players dealt in (`server/src/engine/HorseOmahaOpenMeasured.ts`). Nobody has entered the pot (no raise, no limp), the Horse is not on the button, and the wager_rules node's final answer is a raise: the first-in open. The raise becomes a fold when the hand's two-card strength (`omahaMathCore/OmahaMathCorePreflop.ts` `preflopStrength`: equity against one random holding of the same size, an additive model fit to Monte Carlo of random holdings, no hand history input) is below the 80th percentile of random holdings (`OMAHA_OPEN_MEASURED_CUT`: 0.539794 PLO4, 0.541004 PLO5). A pair of aces and the rundowns (four ranks inside a span of five) keep the open. The button, a limped pot, a raised pot, a call, a fold and an all-in are untouched.

Inputs are public information only: the Horse's own hole cards, the public action history and the seats. The same rule against every opponent, a person or a Horse. No opponent memory, no draw from the brain's random stream. PLO6, PLO8, hold'em and tournaments are byte-identical with the option on (law `HorseOmahaOpenMeasured.law.test.ts`, which also pins the engine's strength to the offline grader's values).

Receipt: `omaha_open_measured_fold` (noteFire and the decision rule receipt, before raise, after fold). The response validator admits the fold through the node's existing PLO raise-to-fold admission.

Default OFF in source (read `=== true`). Registered in the option switch, switchable live, not off-only.

## What Was Measured

Data and method as in `omahaColdCallOutsideBigBlindIsMeasured.md`: every Horse first-in open in PLO4/PLO5 cash hands with a person at the table, 2026-10-15 to 2026-11-19 (10,017 opens), value = all-in-adjusted hand result from the open on, a fold = 0; fit = before 2026-11-15, held out = 2026-11-15 to 2026-11-19.

Value of the open by strength band (all seats): strongest 10% +2.60 +/- 1.04 bb (n 3,663); next 10% +0.61 +/- 0.89 (n 2,466); below the strongest 20% -1.60 +/- 0.59 (n 3,888). Below the strongest 20% by seat: under the gun -1.52 +/- 1.58, hijack -1.67 +/- 1.29, cutoff -3.48 +/- 1.17, small blind -0.89 +/- 0.87, button +0.50 +/- 0.88 (not acted on).

The exact rule (below the cut, not the button, three or more dealt in, not aces, not a rundown), value of folding instead of opening:

| Set                       | Opens | Total, bb        | Per Open, bb   |
| ------------------------- | ----- | ---------------- | -------------- |
| Fit (to 11-14)            | 1,678 | +4,458 +/- 1,628 | +2.66 +/- 0.97 |
| Held out (11-15 to 11-19) | 674   | +1,391 +/- 928   | +2.06 +/- 1.38 |
| Tables, fit               | 1,036 | +3,060 +/- 1,165 | +2.95 +/- 1.12 |
| Tables, held out          | 343   | +1,309 +/- 757   | +3.82 +/- 2.21 |
| Lightning, fit            | 642   | +1,399 +/- 1,139 | +2.18 +/- 1.77 |
| Lightning, held out       | 331   | +81 +/- 536      | +0.25 +/- 1.62 |
| PLO4, fit                 | 1,022 | +3,198 +/- 1,170 | +3.13 +/- 1.14 |
| PLO4, held out            | 212   | -311 +/- 291     | -1.47 +/- 1.37 |
| PLO5, fit                 | 656   | +1,260 +/- 1,133 | +1.92 +/- 1.73 |
| PLO5, held out            | 462   | +1,701 +/- 880   | +3.68 +/- 1.90 |

Verdict by the lead's rule of evidence: PASS pooled (fit and held out both positive beyond one standard error). Weaker than the cold-call option: the Lightning held-out slice is inside noise and the PLO4 held-out slice is negative by 1.07 standard errors on 212 opens (PLO4 over the whole set +2.34 per open). The kept classes below the cut (aces, rundowns) grade +1.32 +/- 1.67 for folding (n 615): no evidence, so they keep the open.

Limits: the button exclusion and the kept classes were chosen after seeing the data (the all-seat version also passes: fit +1.53 +/- 0.74, held out +1.74 +/- 0.94 per open); hands with a person dealt in only; the rule removes 23 percent of the Horses' first-in opens (2,352 of 10,017), and how opponents adjust to a tighter opening range is not measured.

Evidence NOT MET for a default-on; a lead switch decision only.

## Amendment 2026-11-20 (EMERG Lane PREFLOP-2): Narrowed To The One Cell That Passes In Real Chips

The rule as first built removed 23.8% of the Horses' first-in opens and its PLO4 held-out slice was negative. Split on the same record by game and pool, value of the open against folding (below zero = folding gains), in real chips (chips to persons plus 1.9% of deductions; lead 2026-11-20 1:42 AM) and net:

| Cell               | Opens (Fit / Held Out) | Real Fit       | Real Held Out  | Net Fit        | Net Held Out   | Kept |
| ------------------ | ---------------------- | -------------- | -------------- | -------------- | -------------- | ---- |
| PLO5, tables       | 523 / 194              | -1.94 +/- 1.35 | -4.58 +/- 3.18 | -3.78 +/- 1.97 | -7.10 +/- 3.80 | yes  |
| PLO5, Lightning    | 134 / 268              | +4.55 +/- 2.85 | -0.92 +/- 1.70 | +5.32 +/- 3.48 | -1.21 +/- 1.78 | no   |
| PLO4, tables       | 514 / 149              | -0.86 +/- 0.68 | -0.12 +/- 0.88 | -2.11 +/- 1.06 | +0.46 +/- 1.08 | no   |
| PLO4, Lightning    | 508 / 63               | -1.81 +/- 1.64 | +2.57 +/- 1.55 | -4.16 +/- 2.04 | +3.85 +/- 3.85 | no   |
| PLO4, hijack alone | 232 / 33               | -1.77 +/- 1.45 | -0.06 +/- 0.63 | -3.99 +/- 1.85 | -2.64 +/- 0.98 | no   |
| As first built     | 1,679 / 674            | -1.05 +/- 0.72 | -1.47 +/- 1.16 | -2.66 +/- 0.97 | -2.06 +/- 1.38 |      |

The option now acts only in PLO5 on a table (`omahaOpenMeasuredCell`): folding those opens saves real fit +1,015 +/- 706 bb and held out +889 +/- 617 bb (net +1,976 +/- 1,029 and +1,378 +/- 737). It removes 7.2% of first-in opens instead of 23.8%; table VPIP and PFR -0.8 point (under the gun -2.4, hijack -1.7, cutoff -1.1), flops seen -0.5 point, against -1.5 and -2.9 (Lightning) for the first rule. Stated limit: inside PLO5 tables no single seat passes alone in real chips (under the gun fit +0.09 +/- 2.15 and held out -5.37 +/- 3.61; cutoff -2.27 +/- 2.07 and -3.08 +/- 2.78; hijack +0.92 +/- 2.87 and +2.21 +/- 2.30); the cell passes as a whole.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (the audited-decision scorer judges recorded complaints; this option was graded on realised all-in-adjusted results of 10,017 recorded opens, fit and held out, see above)
