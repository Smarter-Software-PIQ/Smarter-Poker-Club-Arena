# holdemRiverFullHouseValueIsPriced: authority for the live switch

**State: OFF in source (read `=== true`), no switch row, UNEVALUATED. Do not switch on.** Evidence rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md met: mechanism, scope, receipts, tests and off-identity only; no replay of the audited hands, no league result.

Owner order it rests on, 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc." Built by the Horse Switch lane (builder ROWFIX, 2026-11-18) from NLH-CASH improvement I1.

## What it does

`holdemRiverFullHouseValue` (on in production) leads a qualifying no-limit hold'em river full house (`HorseHoldemRiverFullHouseValue.holdemRiverLeadBoat`: out of position, the prior aggressor still to act, not an under-full, a trips-board boat or a board that plays) a fixed 70% of the time (`HOLDEM_RIVER_BOAT_LEAD_FREQUENCY`); nothing prices the lead against the check. With this option on as well, the boat leads exactly when EV(lead) > EV(check), with no random number (`holdemRiverBoatLeadPrice`):

    EV(lead)  = (1 - c) P + c (eq (P + 2s) - s)
    EV(check) = (1 - b) eq P + b (eq (P + 2s) - s)

- P: the pot; eq: the engine's river equity against his range;
- s: the lead the monster branch would size, at the midpoint of its mixed fraction (`max(sizeBase + 0.2, geomFrac) + 0.05`, or `sizeBase + 0.4` without a geometric size, times the exploit value-size multiplier), capped by both stacks;
- c: his share of river bets he calls or raises (`riverCall`); b: his share of spots checked to him that he bets (`betCheckedTo`). Each is the exploit layer's Beta posterior (`HorseOpponentExploit.statRead`, prior strength 6) on his decayed counters, centred on the population cell of the table's variant and size: `OPPONENT_EXPLOIT_ENVELOPE`, MEASURED 2026-10-16 from production (version `horse-population-2026-10-16`, 1,186,859 hands, 3,187,553 Horse seat-hands; nlh:short riverCall 0.4337, betCheckedTo 0.3115; nlh:hu 0.5144 and 0.2951). With no read the prior decides: at those cells it leads.

Stated assumptions, not measurements: his bet when checked to is priced at the lead's own size and hero calls it; a raise by either side is left out of both lines alike. The population cell is the HORSES' rates, not people's: against a person with no read the prior is the Horse figure. Heads-up only: with more than one opponent, or no cell for the table, nothing is priced and the boat keeps the check (receipt `holdem_river_full_house_lead_unpriced`), the line of the V11 initiative gate with the option off.

The option alone does nothing (it refines `holdemRiverFullHouseValue`). Off (absent or false): byte-identical, the 70% line and its random draw unchanged.

## Receipts

`holdem_river_full_house_lead_priced`, `holdem_river_full_house_check_priced`, `holdem_river_full_house_lead_unpriced` (with `holdem_river_full_house_lead_seen` beside every lead, as today).

## Tests

`server/src/engine/aHoldemRiverFullHouseLeadsForValue.test.ts`, describe "the priced lead": the closed form; off and unset equal the 70% line over 200 seeds and the option alone changes nothing; with no read the population cell prices the top boat into a lead on every seed; a measured barreler (bets 80% when checked to, calls 20% of river bets) gets the check and a measured calling station the lead; hands that do not qualify keep the off decision.

## Evaluation (owed)

League card declared, not run: `nlh_river_full_house_value_is_priced` (`server/src/benchmark/HorseLeague.ts`; arm B `holdemRiverFullHouseValue`, arm A adds this option). The audited-hand replay (RIVER-FULL-HOUSE-REPLAY-20261115) has not been run with it. A PASS-BAR must be written before either; nothing has been measured.
