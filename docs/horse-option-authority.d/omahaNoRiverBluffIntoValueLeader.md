# omahaNoRiverBluffIntoValueLeader: authority for the live switch

Lane brief of 2026-11-16 (PLO4/PLO5 defence, part 2). Evidence NOT MET: evaluation NOT RUN.

## What it does

PLO4/PLO5 cash, one board, high only, the river, nothing to call, a bet with a hand below the showdown-value line (it wins or ties against less than 0.5 of all opponent holdings, exact count), not nut class, with no nut blocker story (the v86 nut-blocker river bluff, `omahaRiverNutBlockerBluffReachable`'s path, keeps every bet it made, and a hand that blocks the nut flush on a flush board, `omahaFlushBlocker`, is left to the blocker bluffs), and a live opponent who is a measured postflop value leader (`HorseMind.omahaReadConditionalOf`: measured and valueLeader) and showed strength this hand (bet, raised or called on the flop or the turn): the bet becomes a check unless the fold-equity EV comparison (`omahaBetVsCheckEv`) says the bet is worth more than the check by 2% of the pot. In and out of position, heads-up and multiway (multiway: any live opponent such a leader; every live opponent is priced).

The comparison: each live opponent holds the strongest V of all holdings (V = 1 with no strength shown, 0.5 when he showed strength, times 0.8 per street he bet or raised and 0.9 per street he only called); his fold rate f (measured: 1 minus his river-call rate; else the population prior 0.60) is read as a threshold over all holdings, so of his own range the share min(1, (1 - f) / V) continues. EV(bet B) = F x pot + (P(win or all fold) - F) x (pot + B) - (1 - P(win or all fold)) x B, EV(check) = pot x the product of the Horse's showdown shares against each range, ranges independent, exact counts.

Precedence: an owner-ruled check (`omahaOopCheckRules`, after the older owner-ruled checks, so the pricing rules' wagers are re-checked through `omahaWagerIsChecked`), kept outermost by `omahaOwnerRuledFinal` whatever pricing option is on; one receipt per decision.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaNoRiverBluffIntoValueLeader docs/horse-option-authority.d/omahaNoRiverBluffIntoValueLeader.md sha256 <digest>`). Registered in the live switch OFF-ONLY (follow-up list migration 20261118001216 names it; HorseOptionSwitch.ts OPTION_SWITCH_OFF_ONLY): screened on 2026-11-17 against the owner's order of 11:49 America/Chicago ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."), its check is asked only against an opponent the engine labels a measured value leader, so the label decides which bluffs are priced. It cannot be switched on until it is rewritten as a priced comparison for every opponent (his measured fold to a river bet and the Horse's blockers) and that form passes its own evaluation. The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on

The owner's principles of 2026-11-15, as the lane brief of 2026-11-16 relays them (in substance, not verbatim): no blanket rules, the decision is hand, player, price and pot dependent; play defence on bad cards; an owner-ruled check or fold is final; facing a bet on the turn or the river, raise only with the nuts. No verbatim owner order names this option; the brief that ordered it is the lane's (2026-11-16).

## Recorded hands and rulings it answers

Archive pricingfix-20261115 (I6-TRACE-final.txt): in-position river bets into an opponent the engine reads as a measured value leader, states 65, 487 and 591 among them. Rebuilt with the Horse cards and line of state 65 (3dKs2h8s on 4dJd9h7cJs, the opponent bet the flop) and of 487 (6dQh3cTs on 2s9c3s2h4s): with a measured value leader read, every seed that bet now checks (test), the comparison EV(bet) -37.5 / -6.6 against EV(check) 0 at three-quarter pot.

## Receipts

omaha_no_river_bluff_into_value_leader_checked; its `_vetoed` twin omaha_no_river_bluff_into_value_leader_checked_vetoed fires when a later rule replaced the check.

## Tests

HorseOmahaMultiwayDiscipline.test.ts (16 seeds per class: a bluff into a measured value leader who showed strength checks at every seed; no read, a presumed read, a measured non-leader and the mind off unchanged; a leader who almost never calls the river keeps the bet by the comparison; no strength shown and a nut-flush blocker unchanged; byte-identical when unset or false; admitted by the receipt validator).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001, the strategy-head method: unset and all three options false both give b5031a14 / 1adfd8e3 / 5b8cac9c / f5ed6fa1, 446 / 2714 / 428 / 2844 decisions, 0 illegal, 0 fallbacks; archive defense2-20261116/fp-\*.json).
- Value, continuation, reach: NOT MET. Evaluation NOT RUN (league cards plo4/plo5 `_omaha_no_river_bluff_into_value_leader` dealt, not run).

## Limits

Stated, not measured: the showdown-value line 0.5, the shown range 0.5, the 2% margin. Measured: the river fold prior 0.60 (full sweep, heads-up Horse river bets with one pair or less, 68 of 113 everyone folded; it pools sizes and reads). The threshold reading of a fold rate is an assumption. After the check no later betting is priced (out of position he may bet), so the check is valued at showdown.
