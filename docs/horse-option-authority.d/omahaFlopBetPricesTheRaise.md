# omahaFlopBetPricesTheRaise: authority for the live switch

Owner order (verbatim, WooWoo PLO audit programme): "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS". Build: WooWoo audit lane FLOPBET-RAISE (finding FOURBET F1, archive repairs/FOURBET/FINDINGS.md section 4 and 5). Evaluation: repairs/FOURBET/EVAL-DECLARATION-F1.md (declared with its sha256 before the run) and its result file. Default OFF; evidence status is recorded in the result file, and nothing here switches it on.

## What it does

PLO4/PLO5 cash in the priced scope (`omahaPricedInScope`: one board, high only, no bomb pot, not Lightning, not fixed limit), on the flop, heads-up against a person who can still raise, with nothing to call: every bet size of the v38 EV engine (`HorseEvEngine.evaluateSpot`, called from the HorseLogic V38 block) is priced with his raise as a third branch:

EV(bet s) = f(s).P + (cont - rho).[eqBand realized called pot - s] + rho.max(callOff(s), -s)

- f(s): the engine's own fold model for that size, unchanged; cont = 1 - f(s).
- rho: the share of his whole range that raises a flop bet, taken from the top of the part that continues. No per-player raise read exists in the one read interface (`OmahaPricedRead` has no raise cell), so rho is the measured prior of its one owner, `HorseOmahaPricedSites.OMAHA_PRICED_SITES_FLOP_RAISE_SHARE` (0.15: persons raise Horse flop bets 10-21%, blockbet-013U37; in Horse 4-bet pots over 8 days 15/93 = 0.16 [0.10, 0.25], FOURBET section 4). It is a person measurement, so against a Horse or an opponent of unknown kind the bet keeps the two-branch price (`omaha_flop_bet_raise_branch_unpriced_kept`).
- the Horse's equity against the raisers: the flop facing-bet sampler's strongest rho of his holdings on this board with card removal (`omahaFlopEvCounts(...).top(rho)`).
- eqBand: the engine's continuing equity with the raisers taken out (cont.eqCont = rho.eqRaise + (cont - rho).eqBand).
- callOff(s): `HorseOmahaPricedSites.omahaPricedSitesFlopRaiseAnswer` (his raise to the pot, P + 3s, or all in; the Horse takes the better of the call and the fold; realization from the same fitted owner `omahaPricedSitesFlopRealization`), with the engine's marginal rake. The same function prices the raise branch of `omahaPricedSitesFlopBetEv` (factored out, arithmetic unchanged with rake 0).
- An all-in bet cannot be raised: no branch for it.

No size, hand-class or stack-to-pot threshold: the check or a smaller size wins only where the arithmetic says the raise costs more than it pays, and a hand that is ahead of his raises is priced to bet more.

## Receipts

omaha_flop_bet_raise_branch_priced, \_kept, \_resized, \_checked, \_bet, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaFlopBetRaiseBranch.test.ts: engine identity without the branch; the raise branch closed form; recorded spots (anonymised, decision-time information only: the Horse's own cards, board, pot, stacks) of the FOURBET named flop bets where the 75-85% bet is priced below the check or a smaller size; an AA/KK value bet ahead of his raises kept; option off, out of scope, multiway and Horse opponents unchanged; `omahaPricedSitesFlopBetEv` unchanged.

## Limits

- rho is a population prior, not a per-player read (none exists); applied to persons only.
- The sampler's raising range is the strongest share of uniformly drawn holdings on the board, not conditioned on his preflop line.
- The check's value is the engine's (it ignores his bet after the check), unchanged by this option.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
