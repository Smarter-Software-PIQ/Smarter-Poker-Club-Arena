# More NLH action through opening ranges and value 3-bets

The owner requested more action without indiscriminate calling or bluffing in six- and nine-handed cash, and improved NLH 3-betting in both cash and tournaments. This follows the statistics correction in PR #9470. The displayed VPIP is not a control input or a quota.

The six/full-ring no-ante cash RFI profile now targets SB/BTN/CO/HJ/LJ/MP/UTG+1/UTG shares of 42/45/28/21/16.5/14.5/13/11.5 percent before style adjustments. The existing ordered hand classes supply membership. Tournament, ante and short-handed opening targets remain separate. The same cash opening width reaches the opponent-width and defense-versus-3-bet calculations, so those consumers do not continue using the narrower prior range.

Facing a late open, the value component of the reference 3-bet range gains 15 percent of the reference total width, tapering to zero against the early anchor. The bluff budget is unchanged. Thus more strong calls become raises, while BB total continuation remains unchanged. Tournament BB/in-position re-steals receive a 0.02 score adjustment through the existing survival-premium function. SB already has its wider tournament 3-bet-or-fold band. Size, short-stack commitment, opponent reads, ICM, non-NLH exclusions and player-identity neutrality remain in their existing decision paths.

## Measured decisions

Combo-weighted full HorseLogic decisions, balanced style, eight seeds per class, single BTN open:

| Spot                                   | Prior 3-bet | Candidate 3-bet | Total continuation |
| -------------------------------------- | ----------: | --------------: | -----------------: |
| Cash 6-max BB, 100bb, 2.5bb open       |       9.16% |          11.05% |  60.14%, unchanged |
| Cash 9-handed BB, same price/depth     |      10.37% |          12.82% |  60.14%, unchanged |
| Cash 6-max SB, same price/depth        |      10.11% |          11.80% |  16.29%, unchanged |
| Cash 9-handed SB, same price/depth     |       9.79% |          11.48% |  15.72%, unchanged |
| MTT 9-handed BB, 50bb, BBA, 2.2bb open |      13.57% |          14.56% |  75.04%, unchanged |

These are conditional decision frequencies, not aggregate VPIP, solver certificates or live rates. Wider cash openings are chiefly late-position: the 12-seed six-max fixture opens approximately 16.2/21.0/27.1/45.4/43.8 percent from UTG/HJ/CO/BTN/SB.

## Verification and limits

- The four new end-to-end six-/nine-handed cash/tournament re-steal regressions fail against protected baseline `3cc89c90cf3a7d35a8a6ca852332dae2274aee9e` and pass after the change.
- Opening/defense/3-bet/survival and existing cash/tournament aggression suites: 78 cases pass. Range-consumer consistency, style tightening, non-target formats, garbage-hand exclusion, sizing discipline and ICM sensitivity are retained.
- Development full-hand comparison uses the same deterministic deals, rotating dealer, one hero and the unchanged NLH calibrated population, with seeds 2026110317 and 271828183, 10,000 hands per seed/context, six/nine seats, cash 40/100bb and BBA MTT 25/50bb. All hands conserve chips; no illegal actions or truncated streets. This population is development evidence, not qualified proof of profitability; nine-handed is an exploratory use of it, and several tournament cells are inert or sparse.
- A broader opening/75-percent bluff-budget candidate was rejected: six-max 100bb delta -8.68 bb/100, standard error 4.12, on the first 10,000 pairs. The final candidate keeps the original bluff budget and reduces opening expansion. Final paired results are mixed and uncertain, not proof of increased winnings. No individual populated final sample has a decline exceeding two standard errors; this does not establish equivalence or rule out a loss.
- Source tests and simulations do not establish deployment. Completion still requires a serving revision containing this change, release-bound strategy telemetry and fresh accepted-hand statistical verification. Historical statistics are not silently rewritten.
