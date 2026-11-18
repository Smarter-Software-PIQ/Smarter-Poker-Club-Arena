# omahaCheckedToBetIsPriced: authority for the live switch

Built 2026-11-18 by the WooWoo audit repair programme (lane CHECKED-TO-BET). Evidence NOT MET: the option stays OFF. This file does not authorize switching the option on: no order to switch it on is recorded here. It records what the option is, what was measured and what must pass first.

## What it does

PLO4/PLO5 cash, one board, high only, no bomb pot, not Lightning. On the river (any number of opponents) or the turn (one opponent), when every opponent has checked this street, nobody is all in and the node's answer is a check, the check is priced beside every bet size the engine considers (`server/src/engine/HorseOmahaCheckedToBet.ts`, one site in `HorseLogic.ts` wager_rules after `omahaStrongHandValue`):

- Range: each opponent's checking range, 800 hands sampled with a seed from the cards and weighted by his line this hand (the card-impact model, `HorseOmahaCardImpact.ts`). The brain's random stream is not read.
- Response: the share of that range that continues is his measured continue rate (river: his river call rate; turn: one minus his fold-to-bet rate), read through the one priced read (`HorseOmahaPricedWiring.omahaPricedReadOfUser`: a posterior mean that shrinks to the Horse population of the game and table size by the opportunity count; the per-street cells replace the pooled figure when that read is delivered through `omahaPricedStreetRatesOf`). With no read at all he continues at the pot odds, against which a bet with no equity is worth nothing. The top of the continuing share raises (the model's raise share) and the raise is priced.
- EV(bet) = P(everyone folds) x pot + P(called) x [equity against the hands that call x (pot + calls) - bet], with the raise branch, after the rake. With several opponents everyone folds with the product of their fold rates and every set of callers is enumerated.
- EV(check) = showdown share x pot after the rake on the river; on the heads-up turn the value of checking when he may still bet the river at his measured bet rate.
- The bet of highest expected value replaces the check when it is worth more than the check by more than the standard error of the difference (the error of his rate from its opportunity count, the error of the sample, the rounding of the model's shares). No hand-class, position or size rule, and nothing keyed to an account.

Precedence: it reads the node's final check where the strong-hand rule did not answer. Every later owner still judges the bet: the one-pair rules (a bet that is not a value bet is a declared bluff), the draw rules, and the outermost owner-ruled final (`omahaOwnerRuledFinal`: an owner-ruled check, the made-hand defence and the street plan stand over it; on the recorded heads-up turn spots those rules check the bet again). Outside the spot, and with the option unset or false, every decision is exactly as before.

Not built: the flop (owned by the PLO Strategy lane's flop bet model), the turn with several opponents, a spot with a player still to act behind the Horse.

Default OFF in source (read `=== true`). Registered in the option switch (follow-up migration `20261118015651_horse_option_switch_omaha_checked_to_bet_is_priced`, not installed by this lane), switchable live, not off-only. On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaCheckedToBetIsPriced docs/horse-option-authority.d/omahaCheckedToBetIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The orders it rests on

- Owner, 2026-11-17, verbatim as recorded by the audit programme: "DONT' MAKE ANY BLANKET RULES, EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
- Owner, 2026-11-17 (the flop complaint, cited by file: audit archive `woowoo-48h-audit-01BNteGYgf/repairs/FLOP-DEFENCE/SPEC.md`): a plan for offence as well as defence.

Neither is an order to switch this option on.

## The measurement it answers

Audit archive `woowoo-48h-audit-01BNteGYgf/repairs/FLOP-DEFENCE/ATTRIBUTION.md` section 3: one player folded to 140 of 177 heads-up river bets after checking; the Horses checked back air or a weak pair in 35 of 43 such spots and won 44 to 47% of those showdowns; with several opponents they bet a medium, weak or empty hand 0 of 93 times; after a checked-through flop he folded to 11 of 22 heads-up turn bets.

## Receipts

omaha_checked_to_bet_priced_bet (the check became the bet; when a rule that outranks the pricing rules checks it again, omaha_owner_ruled_check_kept fires in the same decision), omaha_checked_to_bet_priced_check_kept (priced; the check stands). A failure fires omaha_strategy_rule_failed and keeps the decision it was given. A default-off option production does not set is silent.

## Tests

`HorseOmahaCheckedToBet.test.ts` on fourteen journaled requests of the audit (`HorseOmahaCheckedToBet.fixture.json`: seats only, the deciding Horse's own cards): the spot and everything outside it; the same hand bets into a player who folds 79% and keeps the check against a calling station, the break-even rate and no read; no spot bets a hand that is not a value bet into a station; the margin grows as the opportunities shrink; the product of fold rates with several opponents; through `HorseLogic.decide` with the recorded option states, the option unset, false and a truthy non-boolean byte-identical, PLO6, tournaments, bomb pots and Lightning byte-identical.

## Evaluation

Declared before any candidate decision (audit archive `repairs/CHECKED-TO-BET/EVAL-DECLARATION.md`, sha256 73725cf430e52982c349894055d6f4a804d0d2db653ccdacfd60cbcf3b147c37): a counterfactual replay of every journaled decision of two engine builds. Its result is in `repairs/CHECKED-TO-BET/LANE-REPORT.md`. No league matchup has been run (cards `plo4_omaha_checked_to_bet_is_priced`, `plo5_omaha_checked_to_bet_is_priced`): a league result on the declared seeds, a human-like field and a Horse-only field included, must pass before any `on` row. The opponent fold rates were measured against a value-heavy Horse betting range and will fall as bluffs are added: the read is a decayed posterior, so the bets stop when he calls, and that adaptation has not been measured.

## v2 (2026-11-18, lane OFFENCE; REDESIGN-PLAN section 2)

The v1 arithmetic FAILED its declared efficacy bar (repairs/CHECKED-TO-BET/LANE-REPORT.md). v2 changes two inputs and the scope, nothing keyed to a hand class, position, size or account:

- River only. The turn is priced as a whole line by the street plan, which this arithmetic lacks; on the turn the option now returns the decision it was given.
- The showdown share in EV(check) is the card-impact share against the checking range with the opponent's KIND prior read, mapped through a logistic calibration fitted by maximum likelihood on production river spots (2026-11-01..2026-11-15, read-only export, 814 spots where a Horse acted heads-up after the check; persons n 414, Horses n 400): archive repairs/CHECKED-TO-BET/v2/FIT-TABLE.md. The slope is about 0.35: the raw model was about three times too confident in logit at both ends (model 0.0-0.1 won 25% against persons; 0.9-1.0 won 86%).
- The equity against the hands that continue (the bet's called branch) is calibrated the same way on the 144 called river bets of the same export (v2/FIT-CE.md, pooled: each kind under 100). The value flag is "calibrated continue equity above one half".
- Both fits' errors (delta method) and the model's sample error through the map join the standard error the bet must clear.
- Precedence unchanged: omahaOwnerRuledFinal still re-checks a priced bet where an owner-ruled check, the made-hand defence or the street plan checks (REDESIGN-PLAN asks for an integrator ruling; this lane made none).
- No option-switch migration on this branch (the integrator regenerates one whitelist follow-up for the batch); the v1 text above that names migration 20261118015651 is superseded.
  Evaluation: declared v2 (repairs/CHECKED-TO-BET/EVAL-DECLARATION-v2.md, sha256 4be1edb155f1...; amendment 1 sha256 734ae2dbd3df..., both before any run). Result: see the section added after the run.

## v2 evaluation result (2026-11-18 ~09:45Z; declared v2 + amendment 1 before the run; raw output archive repairs/CHECKED-TO-BET/v2/EVAL-v2-RESULTS.txt)

Verdict: **FAIL** (bars 4 and 7 fail; every other bar passes). The option stays OFF.
Candidate 22490fcc781; 2,000 journaled decisions (1,345 river + 655 turn; the same 48-h window as v1, disjoint in time from the fit window).

1. Off identity: 0 of 2,000 differ: PASS.
2. Scope: 41 changes, all river check -> bet (35 heads-up, 5 three-way, 1 five-way); 0 out of scope; RNG unchanged on every unchanged decision: PASS.
3. Preserve: 73 nuts-receipt decisions unchanged; no control bet/raise/call/fold changed: PASS.
4. Adverse cell (every checker calls 70% over 40 opportunities): 129 bets at 206 spots, **6 not value bets**: FAIL. All six are heads-up thin bets whose calibrated equity against the calling range is just under one half, carried by 16-32% folds (EV over the check +8 to +33 chips, each above its error).
5. Calibration (the input that failed in v1): persons n 99, mean(calibrated share - result) -0.001 (SE 0.052); Horses n 56, +0.059 (SE 0.071): PASS.
6. Value (model response, cards in hindsight): 41 of 41 changes, mean +40.5 chips (SE 6.2): PASS. Reported beside it: if a checker who holds the winner always calls, the mean is -4.4 (SE 10.5): the gain rests on the model's fold share being independent of who holds the winner.
7. Reach: 72 heads-up river checked-to control checks have a positive v2 edge; **35 became bets** (bar: half = 36): FAIL. Of the 37 others, 29 are inside the error and 8 were re-checked by a rule that outranks the pricing rules (precedence unchanged).
   Reported: 33 of the 41 changes are bluffs/merges, 8 value bets; reviewer verdicts on the 41 changed checks: correct 29, acceptable_close 12 (kappa 0.29, not gated).
