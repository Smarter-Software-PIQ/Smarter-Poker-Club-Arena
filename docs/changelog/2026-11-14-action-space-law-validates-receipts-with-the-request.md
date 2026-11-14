# The Action-Space Law Validates Worker Receipts With Their Request, As Production Does

`HorseActionSpaceFreedom.law.test.ts` failed once on hosted CI (run 43552926081, Server Engine shard 4/4, first attempt) in the case `plo5 cash: 100% valid receipts, 0 gate refusals, and 100% legal accepted controller actions`: one receipt in the diamond run counted as invalid. It passed on rerun. This is the cause and the correction.

Test only: no decision, wager, think time, queue or deadline changes. No production file changes.

## Cause

- The matrix harness counted a receipt invalid with `horseDecisionReceiptIsValid(decision, variant)`, without the request. The production client validates every FAST_RESULT with the request (`horseDecision/client.ts`, `horseDecisionReceiptRefusal(decision, variant, { player, gameState })`).
- Some `wager_rules` transitions are admitted by the validator only when it has the request and can recompute them. One is the PLO4/5/6 river boat call (`callLargeRiverBoatWager` in `HorseOmahaBigBetCalls.ts`, checked by `boatRuleProducesCall` in `horseDecision/responseValidation.ts`): a raise becomes a priced call. Without the request the validator answers `policy_graph`.
- In the plo5 cash cell, hand 0 can reach a heads-up river where the hero holds sixes full of nines and faces a pot-sized bet. When the reference brain raises there, the boat rule makes it a call. The receipt is valid in production and was refused only by the law's context-free call.
- The line is reached rarely because the matrix is not deterministic run to run (identical loops of the cell made between 24 and 31 decisions; the controller stamps actions with the wall clock, which a sibling law found the decision key covers; that mechanism was not re-proven here). Reproduced locally 2 times in 1,237 loops of the plo5 cash cell pair (once with chips, once with diamonds), both the same spot and both `policy_graph`; both receipts are valid when validated with their request. Clock skew (a scaled or jumping `performance.now`) did not change the rate: it is not a pricing-budget expiry.

## What Changed

- The harness validates through one helper, `matrixReceiptRefusal`, that passes the request's player and game state, the same call shape as the production client.
- New regression in the same law: a real receipt and request captured from the reproduction (`horseDecision/fixtures/plo5-river-boat-call-receipt.json`, synthetic fixture players and cards) must be admitted by the harness helper, must be the call the production boat rule produces from that request, and is still refused as `policy_graph` without the request.

## Limits, Stated

- The context-free validator is unchanged and still refuses this transition. Retained receipts read without their request (no production caller validates this transition that way today) would be refused the same way.
- Other tests that validate worker receipts without the request can hit the same class of false refusal; they were not changed here.
- The matrix itself stays nondeterministic. This change removes the false refusal, not the run-to-run variation.
- On a live engine a refused receipt would show as the `horse_decision_refused_isolated` fire and the client's recoverable request error text `horse decision worker returned invalid policy receipt: policy_graph`. This defect cannot produce that, because the live client validates with the request.

## Regression

- `HorseActionSpaceFreedom.law.test.ts`: `validates matrix receipts with their request, as the production client does: a PLO5 river boat call is valid`. Mutation: dropping the request from `matrixReceiptRefusal` fails it with `expected 'policy_graph' to be null`.
