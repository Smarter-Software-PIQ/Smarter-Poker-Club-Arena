# omahaFlopVerdictReadsTheBettor: authority for the live switch

Built 2026-11-19 by the HORSE DECISIONS lane (PLO4/PLO5 cash strategy; builder for session_01TLQer7JfrrxcELJZV5XHPD). **NOT EVALUATED. Evidence NOT MET. The option is OFF and stays OFF.** No league evaluation has been run. The one yardstick run so far, the replay on the 563 audited flop decisions, does NOT support it: by the committed scorer, newly wrong (4) exceeds fixed (1) (section "Replay"). Nothing in this file is an order or a reason to switch it on.

## What it does

It acts only where `omahaFlopFacingBetEv` decides (PLO4/PLO5 cash, high only, one board, the flop, facing a bet or a raise; that option is itself default OFF). With both on, the flop verdict (`server/src/engine/HorseOmahaFlopFacingBetEv.ts`) also reads THIS bettor's durable street record (`HorseMind.omahaStreetReadOf`: public actions and board cards only) through one pure function (`server/src/engine/HorseOmahaFlopBettorRead.ts`):

- RANGE. How often he bets this flop texture on this line (as the last preflop raiser his continuation-bet cell, otherwise his flop-bet cell), over the rate of players of his kind. Both the value share and the non-value share of his bet take one factor: 1 + 2 x slope x ln(ratio) / (value share + non-value share). A player who bets this flop less often than his kind has a narrower value region and fewer other holdings behind his bet; one who bets it more often has both wider. A raise has no cell and its range is not moved.
- LATER STREETS. How often he bets the turn and the river over his kind's rates (the geometric mean of the two). The share of later streets a non-value holding BETS in the verdict's realization model (`OMAHA_FLOP_RUNOUT_CHECKDOWN`) is multiplied by it.
- SAMPLE SIZE. Each rate is (hits + K x the kind's rate) / (opportunities + K). With no opportunity the ratio is exactly 1 and both factors are exactly 1; every opportunity moves it a little; there is no threshold. The cells are decayed (half-life 30 opportunities), so a cell holds at most about 44 opportunities and a rate moves at most 37 to 64 percent of the way to his own figure, by cell.
- TWO KINDS. A person is read against persons, a Horse against Horses, each with its own rates, K and slopes. A bettor whose kind the decision does not know is not read.
- Nothing is keyed to an account. The size of the bet does not enter the read (it sets the range the factor scales and the price, as before).

With the option unset or false, with the mind off, with no record for the bettor, or with a kind the decision does not know, the verdict is exactly `omahaFlopFacingBetEv`'s (tests: byte-identical decisions and receipts at every recorded node, with and without the 2026-11-16 package). Without `omahaFlopFacingBetEv` the option changes nothing and the record is never asked for.

The pooled read the verdict already uses (`HorseMind.omahaFacingBetEvReadOf`, through `omahaEvBluffShare`) is left as it is and still applies: the factor multiplies the prior that function then moves. The two reads overlap (a flop bet is also in the pooled counter). That overlap is not removed and not measured (section "Known limits").

Default OFF in source (read `=== true`). Receipt: `omaha_flop_verdict_read_the_bettor` (the verdict that answered used a record of the bettor). League cards `plo4_` / `plo5_omaha_flop_verdict_reads_the_bettor` (both arms carry `omahaFlopFacingBetEv`; the league learns the street record inside the card). The option-switch follow-up migration is NOT in this change: the lane lead generates one for the lane.

## The owner's orders it rests on

- 2026-11-16 (relayed in the lane's handoff, archive `plo-handoff-review-01a1cbbd`): a decision rests on the hand, the equity, the opponent's range and the price, never on the size of the bet alone; no blanket rule may block a correct decision.
- The lane's binding rules as given to the builder (2026-11-19): every decision priced from the Horse's exact hand and equity against the opponent's perceived range for that action, line and board, his measured tendencies, pot odds, stack depth and position; the move from the population toward one player's measured tendency scales smoothly with sample size; counterplans are behaviour-based, never keyed to one account; never tune to one player's results.

Neither is an order to switch this option on.

## The finding it answers

`plo-handoff-review-01a1cbbd/flopev3-013U37/FINDINGS.md`: of the 63 audited decisions `omahaFlopFacingBetEv` v2 changed against the audit, the ones where the option was wrong (RC2, RC3) lacked per-opponent information: the verdict priced one player's flop bets as the population's. Its recommendation 1 was a per-opponent flop range and realization read. What it asked for was his shown-down flop bets and the realized result of calls against him by class. The street record holds neither: it holds how often he bets. This option is the read that record can support (frequencies), not the one the finding described (showdowns and money).

## Measured constants

Scripts and output: archive `plo-handoff-review-01a1cbbd/flopread-01TLQer7J/calibration/` (measure.mts, an1.py, an2.py, an3.py, CALIBRATION-OUTPUT.txt, data-hashes.txt). Read-only: local exports of production hands made by earlier lane tasks (realfit-013U37, flopev2-013U37), and one read-only SELECT of the street record rows.

- Hands: 16,952 PLO4/PLO5 cash hands with a flop and a person seated, 2026-10-15 to 2026-11-18; 46 persons, 734 Horses; 11,378 first flop bets with the bettor's cards known.
- SLOPE (the one behavioural measurement): the strength percentile on the flop of the hand behind a first flop bet (0 = the strongest holding, against 300 random holdings from the unseen deck, engine evaluator), regressed on ln(the bettor's rate on that texture and line over his kind's rate), bootstrap over bettors:

| kind   | line                                       | bets  | bettors | slope  | SE    | shrunk b^3/(b^2+SE^2) | used  |
| ------ | ------------------------------------------ | ----- | ------- | ------ | ----- | --------------------- | ----- |
| person | continuation bet                           | 2,286 | 39      | +0.272 | 0.068 | 0.255                 | 0.23  |
| person | the same without the highest-volume person | 1,093 | 38      | +0.254 | 0.084 | 0.229                 |       |
| person | other first bet                            | 1,504 | 34      | +0.155 | 0.060 | 0.135                 | 0.135 |
| person | the same without the highest-volume person | 909   | 33      | +0.158 | 0.051 | 0.144                 |       |
| Horse  | continuation bet                           | 5,500 | 653     | +0.169 | 0.155 | 0.092                 | 0.09  |
| Horse  | other first bet                            | 2,088 | 503     | +0.116 | 0.053 | 0.096                 | 0.10  |

In the verdict's range (a value region V and a share q of every other holding) the mean percentile is (V + q) / 2, so a move of the mean by slope x ln(ratio) is a move of V + q by twice that. Giving both shares the same factor is a STATED split: the measurement does not say how the move divides between them.

- PERSON RATES (the street-read reducer over those hands, each person capped at 300 opportunities per cell; one person holds 46 percent of the uncapped opportunities): continuation bet paired 0.444, rainbow 0.586, two-tone 0.573, monotone 0.304; flop bet in any role 0.250, 0.349, 0.339, 0.203; turn 0.378; river 0.331. Without the highest-volume person the continuation-bet rates are 0.497, 0.647, 0.598, 0.444 (the monotone cell has 224 opportunities and is the least certain).
- HORSE RATES (the sum of the Horses' own production street records, 1,104 rows, PLO4/PLO5 cash full and short tables, read 2026-11-19T18:19Z): continuation bet 0.688, 0.692, 0.728, 0.760; flop bet 0.408, 0.411, 0.431, 0.448; turn 0.470; river 0.626.
- K (pseudo-opportunities; mean x (1 - mean) / variance of true rates between players - 1): person 25 (continuation bet), 41 (flop bet), 44 (turn), 40 (river); Horse 61, 53, 68, 73.

## What is NOT measured

- The later-street factor. It is the realization model's own mechanism (a non-value holding bets a share of later streets) with his turn and river rates in place of the population's. No measurement here shows that calls against players who bet later streets more often realize less.
- The split of the range move between the value share and the non-value share (stated: equal factors).
- Any effect on results. No league run, no production data on calls made with this read.

## Replay on the 563 audited flop decisions (the bettor's record is REBUILT)

Archive `plo-handoff-review-01a1cbbd/flopread-01TLQer7J/replay/` (REPLAY.md, the two scorer reports, scripts). The 563 journaled Horse flop decisions of the 48-hour audit (flopev3's `sel563.jsonl.gz`), re-decided on this branch's source, one niced process, offline.

- The journaled read frames of 2026-11-16/17 carry no street record (0 of 563). So the bettor's record as of each hand was rebuilt from his 2,181 earlier-and-during PLO5 cash hands with the engine reducer (only hands before the decision's hand enter its record; one record over every table size, where production keeps one per size) and installed in every arm. This is a reconstruction, not the production read at decision time.
- One journaled option (`omahaReraisedPotFlopContinueNeedsEquityShape`) is off-only today and would make the whole recorded set invalid: it is set off in every arm, as production holds it today.
- With the option on and NO record installed: 0 of 563 decisions differ from `omahaFlopFacingBetEv` alone.
- Off (= `omahaFlopFacingBetEv` alone) against on, by the committed scorer (`server/scripts/audited-decision-replay.ts`, WooWoo 48-hour audit, verdict-only): **changed 11 (3 more aggressive, 8 more passive), fixed 1, newly wrong 4, unjudged 6, unchanged 552; 0 illegal, 0 refused, 0 errors. NEWLY WRONG EXCEEDS FIXED.**
- Against today's brain (the recorded options): `omahaFlopFacingBetEv` alone changed 98, fixed 31, newly wrong 54; with the read changed 101, fixed 30, newly wrong 56.
- All 11 changes are thin: the verdict alone was within 5.4 percent of the pot of its margin on every one (median 1.0 percent; the verdict's sampling error is 1.3 percent median). One of them (59850798) moved against the direction of its own read: a different value share redraws the sample.
- Two folds the audit accepted that the verdict alone turned into calls fold again with the read (59868806 seat 4, 59872720 seat 2: regression tests). Three calls the audit rated correct or close become folds (59737660, 59789520, 59789847).
- The five flop folds of sets and nut straights the audit named: four are called with the read on, as without it (59727433, 59756252, 59806482, 59842423). **59710501 is NOT fixed: it stays a priced fold.** His two-tone continuation bets are slightly narrower than persons' (ratio 0.96), so the read does not widen his range; the option does not force the call.
- Per FINDINGS section 1 the audit's verdicts on the heads-up calls rest on a flat realization factor that the measured results of calls against this bettor contradict; that is a statement about the yardstick, not evidence for this option. This build was not tuned on these decisions, before or after the replay.

## Evidence required before any switch-on (NONE of it exists yet)

1. The league evaluation declared in `plo-handoff-review-01a1cbbd/flopread-01TLQer7J/PASS-BAR.md` (written 2026-11-19 before any run): verdict WIN. Not run.
2. `omahaFlopFacingBetEv` itself evaluated as switch-on ready on the same base: this option is only an input of that verdict.
3. A replay in which newly wrong does not exceed fixed, on decisions this build was not tuned on, or a stated reason accepted by the lane lead why the audited replay is not the yardstick.
4. The Horse rates re-read on the release that would serve (section "Known limits").

## Known limits

- The Horse rates age with the brain. The same reducer over the Horses' hands of 2026-10-15 to 2026-11-18 gives continuation bets 0.57 to 0.64, flop bets 0.27 to 0.30, turn 0.385, river 0.318, against 0.69 to 0.76, 0.41 to 0.45, 0.470 and 0.626 in today's rows. A release that changes how often Horses bet moves every Horse beside this prior at once; the later-street factor would then shift for every Horse bettor (K 68 and 73 bound it: at most about a third of the way). The league evaluation must report the mean ratios it saw (PASS-BAR.md, validity).
- Person rates rest on 46 persons, one of whom holds nearly half the opportunities (capped in the rates; the slopes are given with and without him).
- The record is frequencies only: no showdown and no money. It cannot tell a player who bets often with strong hands from one who bets often with weak ones beyond the measured average relation.
- The pooled read and this read overlap and both apply.
- A different value share redraws the verdict's sample, so near the margin a decision can flip from sampling alone.
- The replay's record is rebuilt and is one record over every table size.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: LEGACY (the replay of 2026-11-19 on the 563 audited flop decisions of the WooWoo 48-hour audit, verdict-only, off = omahaFlopFacingBetEv alone against on, FAILED: changed 11; fixed 1; newlyWrong 4; unjudged 6; unchanged 552. It is recorded in prose in the section "Replay on the 563 audited flop decisions" and in the archive plo-handoff-review-01a1cbbd/flopread-01TLQer7J/replay/REPLAY.md; it was scored before the scorer wrote rows and its replay file declares no option sets, so the scorer refuses to write a run row for it. A run row needs a new run)
