# tournamentUtilityStackScaledMargin (branch holdem/next-n3-short-stack-payouts-20261115; pull request number at push)

This option is DEFAULT OFF (`opts.tournamentUtilityStackScaledMargin === true`). This file is the evidence gathered so far and what is still owed.

## Mechanism

The tournament utility (`HorseTournamentUtility.evaluateCandidate`) keeps the reference action unless another candidate beats it by more than a confidence margin. One part of that margin, the equity uncertainty, was the equity standard error times the whole payout pool. For a short stack that is wider than its whole tournament equity, so the payout check could never overrule a short stack. With the option on, that part is the equity standard error times the candidate's own utility sensitivity to the Horse's showdown share (the regression slope of utility on share over the calibrated samples, bounded by the utility span), and never wider than the whole-pool figure it replaces. Folds keep a zero margin.

## Input fidelity

Reads only what the utility already has: the calibrated showdown samples, their weights and each sample's utility. No opponent read, no new input.

## Value

Not measured. Owed: a declared evaluation scored on payouts, not chips.

## Continuation

No new action. It changes how often the existing payout check may replace the reference action with a candidate it already ranks higher.

## Reach

Fixed-hand evidence (`aTournamentUtilityMarginIsScaledToTheStack.test.ts`): at the 2.1bb folded-to node of hand 59441335 seven-deuce and three-deuce offsuit jam less often, pairs, aces, K-Q and 8-5 offsuit unchanged; at the bubble call J-T suited calls a jam less often, A-8, K-T, 6-6 and A-7 unchanged, seven-deuce stays a fold. The six committed-stack law nodes are unchanged with that option absent and on, priced and mispriced. League card `mtt6_ft_utility_stack_scaled_margin_12bb`.

## Scope

Tournament decisions that run the Phase 7 utility. Cash games never run it.

## Visibility

Ledger flag `tournamentUtilityStackScaledMargin`. Receipt `tournament_utility_stack_scaled_margin_seen` counts each tournament decision selected by the utility comparison with the margin in force. The decision's existing `tournamentUtility` ledger shows the selected action and whether the baseline was retained for uncertainty.

## Limits

On the fixed hands the option only removed a shove or a call; it never turned a fold into a call or a shove. That is pinned on those hands, not proven for every node. Off is byte-identical: the sensitivity moments are accumulated only with the option on.
