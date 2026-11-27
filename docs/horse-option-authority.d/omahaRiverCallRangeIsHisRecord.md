# omahaRiverCallRangeIsHisRecord: Authority For The Live Switch

**Evidence NOT MET (the audited replay of its increment fixes nothing and loses 3 audit-correct bets, 0 fixed / 0 newly wrong, so the 8-to-1 bar is not met; the probes show no significant loss). Default OFF, not switched on.** Built 2026-11-26 by PLO-OWNER lead-7 lane river-call (session 01TLQer8) to close the thin-value gap omahaRiverBetCheckIsHisRecord left against a calling station. Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game. This file does not authorize switching the option on.

## Root Cause

The card-impact range model of the two river bet rules (`HorseOmahaCardImpact.ts`; omahaRiverFirstToActBetIsPriced, omahaRiverCheckedToBetIsMeasured) narrows the opponent's range at every flop and turn CALL of his to the top pot-odds share of it (keep = pot / (pot + bet)): the population's continuing range. A player who folds far less than people continues with much weaker hands, so after his calls his range is wider and weaker than the model holds, and a river value bet is under-priced against him.

## What It Does

Nothing by itself. With either river rule on, each call step of his line keeps `1 - m x (1 - keep)` of his range instead of `keep` (clamped to 0.05..0.97), with `m` his own fold share over people's: `q = sum(opps x people's fold in that cell) / opps`, `his = (folds + k q) / (opps + k)`, `m = his / q`. His record is his lifetime public heads-up first answers to a turn or river FIRST wager (OPPONENT-HUD `x.foldToBet.small` / `.big` via `HorseMind.omahaStrongHandCheckRecordsOf`, two streets and two sizes pooled against people's rate for his own mix). His bets, raises and checks are read as before; the answer curve to the Horse's own river bet is unchanged. No record: the read object is unchanged. `HorseOmahaRiverCallRecord.omahaRiverCallRead`; the optional `callFoldRatio` field of the card-impact read. PLO4/PLO5 cash, river, heads-up; one formula for every opponent; never PLO6.

## What Was Measured

Harness `plo-lead7-01TLQer8/river-call/src/grade4.mts` (the river-station harness: his first-wager answers and unopened wagers served as his lifetime record). Base = the live switch rows. Horses ON minus OFF, bb/100, 2 seats, 100 bb, 16,000 deals. Before = the two river rules + omahaRiverBetFoldIsHisRecord + omahaRiverBetFoldIsPeopleMeasured + omahaRiverBetCheckIsHisRecord; after = the same + this option.

| Probe                        | Before          | After           |
| ---------------------------- | --------------- | --------------- |
| Calling station PLO5 seed 11 | -0.15 +/- 0.21  | +0.11 +/- 0.65  |
| Calling station PLO5 seed 12 | -0.10 +/- 0.27  | +0.46 +/- 0.49  |
| Calling station PLO4 seed 11 | +0.37 +/- 0.38  | +0.78 +/- 0.56  |
| Calling station PLO4 seed 12 | +0.07 +/- 0.09  | -0.70 +/- 0.54  |
| Over-folder PLO5 seed 11     | +20.52 +/- 4.47 | +24.89 +/- 4.37 |
| Over-folder PLO5 seed 12     | +13.71 +/- 4.14 | +12.09 +/- 4.17 |
| Over-folder PLO4 seed 11     | +11.37 +/- 2.58 | +12.09 +/- 2.59 |
| Over-folder PLO4 seed 12     | +11.83 +/- 3.04 | +11.99 +/- 2.94 |
| Balanced PLO5 seed 11        | +24.45 +/- 4.14 | +31.92 +/- 3.90 |
| Balanced PLO5 seed 12        | +20.06 +/- 4.17 | +22.13 +/- 4.29 |
| Balanced PLO4 seed 11        | +11.59 +/- 2.42 | +12.19 +/- 2.58 |
| Balanced PLO4 seed 12        | +6.59 +/- 2.29  | +8.36 +/- 2.79  |

Before rows for the station and the over-folder are the river-station runs (worktree at 234adb260ce8, the same build with this option absent; flag-off 0 differences); balanced before rows were run here. No over-folder or balanced probe loses beyond 1 standard error (largest drop: over-folder PLO5 seed 12, -1.62 against SE 4.2). Three station probes improve; the station PLO4 seed 12 probe falls from +0.07 to -0.70 (about 1.4 combined standard errors): not significant, and not a hold. The probe harness's fire instrumentation is no longer in the engine, so the bets behind that fall were not traced.

- Flag-off check full set (a10c0c2cf1b3, the station branch, against 9a0ef92f29c5, this option on it): 0 differences in 28,000 decisions.
- Speed: the option adds no model call (four record reads and a multiplication per call step beside the rules' own card-impact model); the law's relative-cost check passes (ratio 0.95 on the journaled river spots). The compiled-build speed gate was not run.
- Law (`HorseOmahaRiverCallRecord.law.test.ts`): on 305 priced sizes a station record raises the Horse's called equity by 0.056 on average and a nit record lowers it by 0.057; on the 57 real audited heads-up river nodes with each opponent's own record the option changes one decision, 22af18db, to the audit's bet (0 newly wrong, 0 audit bets lost).
- Limit found: a search of 400 substituted holdings on each of the 57 audited river states found no MEDIUM hand that this option turns into a bet against a station; the flips it makes are strong hands at the rules' margin (an ace-high flush that is not the nuts is pinned in the law). Thin value stays out because the rules price the bet with a calibrated called equity (`omahaCheckedToContinueCalibrated`) and with the population's raise share in their answer curve, neither of which this option changes.

## Prior anchor

- Baseline: the model's own pot-odds keep (the equilibrium defence share) for a player who folds like people (m = 1).
- Population weight: PEOPLE's first answer to a heads-up turn / river first wager (responders who are people only by profiles.is_horse; public actions only; stored HUD '\*' rows not used), Nov 19 18:00Z - Nov 26 17:48Z 2026, 58,874 PLO4/PLO5 hands with a turn: PLO4 turn small 47 / 186, big 111 / 211, river small 25 / 65, big 59 / 86; PLO5 turn small 114 / 467, big 289 / 566, river small 91 / 164, big 185 / 269. k = 134.2 (method of moments on 18 people with at least 5 answers, 2,009 answers, each against his own mix). Generated by `server/scripts/omaha-river-call-record-people-fit.ts` into `HorseOmahaRiverCallRecordPeople.data.ts`.
- Own record: his lifetime public counts, shrunk by n / (n + k).
- No unshown cards: public actions only; the decision reads the Horse's own cards.

## Replay

- Replay: fixed 28; newlyWrong 3; changed 32; unchanged 837; unjudged 1; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm FTAPCR vs off; replayed 869 of 869
- Replay: fixed 66; newlyWrong 8; changed 83; unchanged 2614; unjudged 5; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm FTAPCR vs off; replayed 2697 of 2697
- Replay: fixed 28; newlyWrong 3; changed 32; unchanged 837; unjudged 1; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm FTAPCRCL vs off; replayed 869 of 869
- Replay: fixed 63; newlyWrong 8; changed 80; unchanged 2617; unjudged 5; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm FTAPCRCL vs off; replayed 2697 of 2697
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm CL vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2697; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm CL vs off; replayed 2697 of 2697
- Note (2026-11-26, lead-7 lane river-call): this option acts only through the two river rules, so its own arm CL changes nothing (rows above). FTAPCR is the river bet set with omahaRiverBetCheckIsHisRecord (the two rules + omahaRiverBetFoldIsHisRecord + omahaRiverBetFoldIsPeopleMeasured + omahaRiverBetCheckIsHisRecord); FTAPCRCL is that set plus this option. Its increment: daily 2026-11-25 no decision changed; Nov 20-24 four decisions changed, three audit-correct bets became checks (f82f741d, 257850cd, cbc161eb, each 'missed bet (fold equity)' in the audit: opponents whose fold record narrows their calling range, so the bet's called branch is worth less) and one bet was resized (8093bdc0, audit CORRECT): 0 fixed, 0 newly wrong, 3 fixed lost. The increment does not meet the 8-to-1 bar (nothing fixed); the set with it holds 91 fixed / 11 newly wrong (8.3 to 1) against 94 / 11 without it. Scorer 5302af2ab3e, seeds 1,7,42, verdict-only.
