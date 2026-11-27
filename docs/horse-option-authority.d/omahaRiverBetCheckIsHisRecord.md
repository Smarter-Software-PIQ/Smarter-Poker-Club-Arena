# omahaRiverBetCheckIsHisRecord: Authority For The Live Switch

**Evidence NOT MET (the audited replay of its increment is 2 fixed / 1 newly wrong, too few changed decisions to meet the 8-to-1 bar on its own; the station probes carry the case). Default OFF, not switched on.** Built 2026-11-26 by PLO-OWNER lead-7 lane river-station (session 01TLQer8) to close the PLO5 calling-station loss that kept omahaRiverFirstToActBetIsPriced / omahaRiverCheckedToBetIsMeasured (with omahaRiverBetFoldIsHisRecord and omahaRiverBetFoldIsPeopleMeasured) out of shadow. Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game. This file does not authorize switching the option on.

## Root Cause

Instrumented probe (PLO5, 2 seats, 100 bb, 16,000 deals, seed 11, his answers served as his lifetime record): every bet the two rules added against the calling station reached a showdown (130). 122 were checked-to river bets at the pot priced as value with a called equity of 0.63; they won 36 and lost 85, -763 bb, the whole -4.86 +/- 1.16 bb/100 (the 8 first-to-act bets: +1 bb, all early bluffs before his record had weight). His fold record had already moved the curve to "he calls" (record weight 0.92, fold 0.06): the fold side and the shrink k = 75.9 were not the cause, and the record keys on the sizes the rules use (small / big, pooled into one multiplier). The cause was the EQUITY: the card-impact range model (`HorseOmahaCardImpact.ts`, the `check` step of the line) weights the top 0.7 x betCheckedTo of his range by 0.35 after each of his checks, with betCheckedTo the population's 0.477. A player who never bets checks the nuts; his checks cap nothing, and the model saw a weak range where there was none.

## What It Does

Nothing by itself. With either river rule on, the share the range model reads HIS CHECKS with, and (first to act) his chance of betting after the Horse checks, is his own lifetime public heads-up unopened turn/river bet share (OPPONENT-HUD `hudFirstWagerRecord` via `HorseMind.omahaStabDefenceRecordOf`, both streets pooled) shrunk to people's rate: `checkBetShare = betCheckedTo x ((bets + k p) / (opps + k)) / p`. His bets are still read with betCheckedTo. No record: the read object is unchanged. `HorseOmahaRiverBetFoldRecord.omahaRiverBetCheckRead`; the optional `checkBetShare` field of the card-impact read. PLO4/PLO5 cash, river, heads-up; one formula for every opponent; never PLO6.

## What Was Measured

Harness `plo-lead7-01TLQer8/river-station/src/grade4.mts` (grade3 plus his unopened-wager record served as live and the fire instrumentation). Base = the live switch rows. Horses ON minus OFF, bb/100.

Set = the two river rules + omahaRiverBetFoldIsHisRecord + omahaRiverBetFoldIsPeopleMeasured ("before") and the same + this option ("after"); 2 seats, 100 bb, 16,000 deals.

| Probe                        | Before         | After          |
| ---------------------------- | -------------- | -------------- |
| Calling station PLO5 seed 11 | -4.86 +/- 1.16 | -0.15 +/- 0.21 |
| Calling station PLO5 seed 12 | -2.16 +/- 1.17 | -0.10 +/- 0.27 |
| Calling station PLO4 seed 11 | +0.37 +/- 0.38 | +0.37 +/- 0.38 |
| Calling station PLO4 seed 12 | -0.43 +/- 0.77 | +0.07 +/- 0.09 |

Over-folder probes (PLO4/PLO5, seeds 11 and 12) and the heads-up league mirror: in the pull request body (they were still running when this file was committed). After the fix the station gets no checked-to river value bet at all and the 7 first-to-act bets left (seed 11, -44.5 bb in 16,000 deals) are early bluffs made while his record still had little weight.

- Flag-off check full set (origin/main e34a711c41d2 against 7b7dd9fa68b3): 0 differences in 28,000 decisions.
- Speed: the option adds no model call (a few multiplications on two record reads beside the rules' own card-impact model); the law's relative-cost check passes. The compiled-build speed gate was not run.

## Prior anchor

- Baseline: the rules' own betCheckedTo (0.4771) for a player who bets like people (ratio 1).
- Population weight: PEOPLE's heads-up unopened turn/river bet rate (Horses removed by profiles.is_horse; stored HUD '\*' rows not used), Nov 19 18:00Z - Nov 26 17:48Z 2026: PLO4 212 / 713, PLO5 989 / 2,684; k = 23.2 (p(1-p)/tau^2 - 1 on 19 people with at least 5 opportunities; thin, measured).
- Own record: his lifetime public counts, shrunk by n / (n + k).
- No unshown cards: public actions only; the decision reads the Horse's own cards.

## Replay

- Replay: fixed 27; newlyWrong 2; changed 30; unchanged 839; unjudged 1; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm FTAP vs off; replayed 869 of 869
- Replay: fixed 65; newlyWrong 8; changed 81; unchanged 2616; unjudged 4; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm FTAP vs off; replayed 2697 of 2697
- Replay: fixed 28; newlyWrong 3; changed 32; unchanged 837; unjudged 1; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm FTAPCR vs off; replayed 869 of 869
- Replay: fixed 66; newlyWrong 8; changed 83; unchanged 2614; unjudged 5; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm FTAPCR vs off; replayed 2697 of 2697
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm CR vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2697; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm CR vs off; replayed 2697 of 2697
- Note (2026-11-26, lead-7): this option acts only through the two river rules (omahaRiverFirstToActBetIsPriced, omahaRiverCheckedToBetIsMeasured), so its own arm CR changes nothing (rows above). Arm FTAP is the river bet set (the two rules + omahaRiverBetFoldIsHisRecord + omahaRiverBetFoldIsPeopleMeasured) and FTAPCR is that set plus this option. Its increment on the two audits: daily +1 fixed / +1 newly wrong, Nov 20-24 +1 fixed / 0 newly wrong (2 / 1 in all, 11 decisions changed, on audits built from Horse-vs-person tables where calling stations are rare); the set with it holds the bar (94 fixed / 11 newly wrong, 8.5 to 1). The case for the option is the calling-station loss it closes (PLO5 -4.86 -> -0.15, -2.16 -> -0.10 bb/100), which the audits cannot show. Scorer 5302af2ab3e, seeds 1,7,42, verdict-only.
