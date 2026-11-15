# Omaha: three bets that become checks (hand 59517323)

Date: 2026-11-15. Lane: PLO Strategy. Owner complaint and rulings 2026-11-15 (America/Chicago) on hand 59517323 (PLO5 1/2 cash). Three new options, all off by default (read `=== true`): `omahaBareOverpairOopFlopCheck`, `omahaOverpairNoOopBarrelVsValueLeader`, `omahaPairedRiverNoThinLeadVsValueLeader`.

## What happened

A Horse 4-bet aces before the flop and was called by one player who had position. It bet the 5-8-9 two-tone flop (99 into 357) with the bare overpair, bet the turn (233 into 555) with the overpair and a flush draw it had picked up, and on the river that paired the board bet 256 into 1,021 with aces up. The player, who had called both streets, moved all in with a full house; the Horse called 161.9 more and lost.

## Root cause

Each bet came from an equity bar: the flop EV comparator, the turn value and barrel branches, the river out-of-position block bet. Position enters them as a frequency or realisation factor, and none asks what the hands that called are. The 2026-11-06 paired-board river check needs the board paired by the turn; the made-hand defence's river check needs an opponent who bet or raised earlier. The unconditional river fix of 2026-11-14 (`ploPairedRiverCheckAfterCalled`, never delivered) failed its evaluation against a field that calls river bets whatever the board.

## What changed

New `server/src/engine/HorseOmahaOopChecks.ts` (three public-information spots) and `omahaOopCheckRules` in `HorseLogic.ts` (wager_rules node, after the paired-board river check). PLO4 and PLO5 cash, one board, high only, nothing to call:

1. `omahaBareOverpairOopFlopCheck`: flop, an opponent still acts behind, one pair only, no flush draw and under eight straight outs, the flop two-tone or connected: the bet becomes a check. No opponent read. Receipt `omaha_bare_overpair_oop_flop_checked`.
2. `omahaOverpairNoOopBarrelVsValueLeader`: turn, heads-up, the opponent acts behind and called the flop bet, still one pair (a draw picked up does not count), a straight possible on the board: the bet becomes a check, only against a measured postflop value leader. Receipts `omaha_overpair_oop_turn_barrel_checked`, `_withheld`.
3. `omahaPairedRiverNoThinLeadVsValueLeader`: river, the final board paired, less than a full house, a live opponent called the flop or turn bet: the bet becomes a check, only when every live opponent is a measured postflop value leader. Receipts `omaha_paired_river_thin_lead_checked`, `_withheld`.

No decision facing a bet changes. With all three unset or false the brain plays exactly as before. League cards plo4/plo5 for each; evidence files in `docs/horse-default-on.d/`.

## Addition: hand 59521326

A fourth option, `omahaPairedTurnNoBarrelWithoutBoatVsValueLeader` (off by default): turn, heads-up, out of position, the flop bet or raise called, the turn card pairs the board, less than a full house: the bet becomes a check, only against a measured postflop value leader. Receipts `omaha_paired_turn_barrel_checked`, `_withheld`. In that hand the river fold of the nut straight came from the 2026-10-25 paired-board fold, which overrode the reference decision's call at a price of 0.213; that rule is unchanged here.

Two more options from the same hand, both off by default:

- `omahaPairedBoardFoldRespectsPrice`: in PLO4/PLO5 cash the 2026-10-25 paired-board fold ("IT'S A FOLD 100% OF THE TIME", `2026-10-25-plo5-plo6-no-full-house-folds-on-a-paired-board.md`) does not override the reference decision when the call price is at most 0.25 and the Horse holds a straight or a flush, or the call is for the rest of an effective stack at least 60% in. Receipt `omaha_paired_board_fold_price_respected`. It narrows a binding owner rule and needs his ruling before it is switched on.
- `omahaTurnBetNeedsRiverPlan`: a heads-up turn bet that would leave less than half the resulting pot behind becomes a check when the Horse's own paired-board fold would fold more than 35% of the rivers to an all-in for what is left (the big-bet call folds are not asked). Receipt `omaha_turn_bet_without_river_plan_checked`.

## Evaluation

Not run. To be declared in the evidence archive (`plo-handoff-review-01a1cbbd/pairedriver-20261115/`) before any graded run; the verdicts are added here when they are read.
