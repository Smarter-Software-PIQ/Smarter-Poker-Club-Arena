# omahaMultiwayIsPricedInTournaments: authority for the live switch

**State: OFF in source (read `=== true`), no switch row, UNEVALUATED. Do not switch on.** Evidence NOT MET: mechanism, scope, law tests on the auditor's hands and off-identity only; no replay, no league result.

Owner order it rests on, 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc." Built by the HORSE DECISIONS lane (lead session_01TLQer7JfrrxcELJZV5XHPD, builder F-FIX, 2026-11-19) from auditor F's PLO tournament audit (archive plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/F-plo-tournament/REPORT.md, classes 2 and 3).

## What it does

Omaha tournaments only (PLO4, PLO5, PLO6, PLO8 pot limit, one board, no bomb pot). Module `server/src/engine/HorseOmahaMultiwayPricedInTournaments.ts`; wired outermost in HorseLogic's `wager_rules` node (both of its returns) and on the path outside the policy graph (`omahaMultiwayIsPricedInTournamentsRule`).

1. Preflop call-off (class 2). The Horse calls (a call, or an all-in that puts in no more than the call) facing a bet (review N2, 2026-11-19: a raise or an all-in raise is worth its fold equity and its extra chips, which this call price does not see, so it is left to the rules that price raises), two or more opponents are already in the pot, and the call leaves no more than the pot after it behind. Its share of the pot is sampled jointly against one holding from each opponent's range (600 deals, card removal across every hand, a generator seeded from the cards; PLO8 splits each board hi/lo with ties split, so quartering is priced). Each range is the top width of holdings by the engine's preflop percentile, the width from the opponent's most aggressive preflop action (limp 60%, call 40%, call of a re-raise 15%, open 32%, short shove of 15 BB or less 45%, 3-bet 12%, 4-bet or more 5%). EV = share x pot - (1 - share) x call x bf, with bf the engine's pay-jump bubble factor (`payJumpBubbleFactor`; 1 where the engine plays chip EV). The continue becomes a fold when EV is below zero by more than the sample's standard error. A fold is never made a call.
2. Multiway own bet (class 3). Flop, turn or river, nothing to call, a bet, raise or all in, two or more live opponents. On the same deals: EV(check) = share against every opponent x pot; EV(bet) = the pot when every opponent folds, else the share against the opponents who continue x the pot after their calls, less the chips the Horse has matched. An opponent continues with two pair or better, a hole-card pair at or above the second board rank, a flush draw, eight or more straight outs, or in PLO8 a made low or a nut-low draw; on the turn and river his range keeps his line (on each earlier street he called, bet or raised, that street's class or a 20% float). An opponent all in from an earlier street always contests. The bet becomes a check when it is worth less than the check by 2% of the pot. A check is never made a bet.

The bet's size enters only the expected value; no size, hand class or label decides by itself. A spot the short all-in floor or the tournament crumbs floor owns is left to them.

Off (absent or false): byte-identical (the rule returns the decision object itself).

## Receipt validator (review N1, 2026-11-19)

`responseValidation.ts` admits the rule's two conversions in `wager_rules` only under the decision's own option (`HorseDecisionReceiptContext.omahaMultiwayPricedInTournaments`, built by `omahaMultiwayIsPricedInTournamentsGateCandidates` in `client.ts` as for the other gated options): the preflop call (or a raise an owner inside the node made the call) to the fold, and the postflop bet, raise or all-in facing no bet to the check, each only where the rule's own spot (`omahaMwTourneyRuleSpot`, which the rule itself reads) holds on the request (`omahaMwTourneyAdmits`). Without it the PLO8 fold (outside the paired-board fold admission) and the tournament check had no admission and the Horse would have taken the fallback action. The verdict is not re-run (the node may resize a bet before the rule prices it, and the call-off price reads the pay-jump bubble factor); a fold and a check put no chip in. Law: every decision it makes with the option on passes the validator, and a converted PLO8 fold is refused without the option.

## Fixtures (the auditor's hands, rebuilt as public spots)

`server/src/engine/HorseOmahaMultiwayPricedInTournaments.test-support.ts`; recorded cards, board, pot, price, stack, game and the number of opponents; the opponents' preflop lines are reconstructed to be consistent with the recorded pot, price and players still to act (the audit csv keeps counts, not sequences).

- Call-offs folded with it on (all six): 26481a02 (share 0.289 vs required 0.460 with bf 1.3), ab7eb573 (0.192 vs 0.344), 3333550b (0.319 vs 0.395), 83b75804 (0.278 vs 0.414), 6dade3bd (0.253 vs 0.338), 88e6c8f3 (0.203 vs 0.232).
- Bets checked with it on: b070b36b (EV check 5.90 BB vs bet 4.77 BB), f9962d3c (2.76 vs 1.83).
- 583495d0 stays a jam: with the opponents continuing by class the 3.92 BB jam into 12.5 BB is priced equal to the check (4.28 vs 4.29 BB, inside the margin); the auditor's loss came from its own response model. Recorded as not changed.

## Tests

`server/src/engine/AnOmahaTournamentMultiwayDecisionIsPriced.law.test.ts` (registered): every fixture red with the option off (the recorded call-off or bet stands) and green with it on; off and unset are the same object through the rule and through HorseLogic.decide on every fixture spot; cash spots and heads-up spots are never touched.

## Receipts

`omaha_mw_tourney_call_off_folded`, `omaha_mw_tourney_call_off_kept`, `omaha_mw_tourney_bet_checked`, `omaha_mw_tourney_bet_kept`, `omaha_mw_tourney_unpriced` (HorseDataLedger.ts).

## Evaluation (owed)

League cards declared, not run: `plo4_mtt_6max_omaha_multiway_is_priced_in_tournaments_15bb` and `plo8_...` in `server/src/benchmark/HorseLeague.ts` (both arms `OMAHA_LIVE_OPTIONS_20261118`, arm A adds this option). A PASS-BAR must be written before any run; nothing has been measured. Known limits: no individual opponent read (population widths), players still to act preflop are not counted, no re-raise after the bet and no later street in the bet model, side pots not split.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
