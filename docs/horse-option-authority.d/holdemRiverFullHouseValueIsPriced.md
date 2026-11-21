# holdemRiverFullHouseValueIsPriced: authority for the live switch

**State: LIVE ON (2026-11-21T01:19:04Z, audit #166, evidence #70, Horse SWITCH lane `01UxDLnM4cwZVwdaVF3xHY2s`, serving `e2140d2d1581`, 8/8 workers at +68s; default OFF in source, read `=== true`).** VERIFIER CONFIRM 2026-11-21T01:03:52Z (`session_01UxDLnLPjcC14fSouoKnY5C`, `runs/card30.jsonl`, 30 seeds x 6,000 pairs = 180,000 pairs / 360,000 hands): pooled `-0.0190 +/- 0.0643 bb/100` (`|z| = 0.30`), `272` priced-decided spots, `326` divergent pairs, `0` illegal/truncated/fallbacks (`EVEN: CONFIRMED`). +40 min live read PASS 2026-11-21T02:01:01Z: `holdem_river_full_house_lead_priced: 2`, `_check_priced: 2`, `_lead_unpriced: 1`, `0` config alarms/fallbacks/errors; confirmed picked up on `bb21dc82673` and `1a0a6047e1a`. Evidence NOT MET on the `--row` replay bar (Replay: NOT RUN; mechanism, scope, receipts, tests, off-identity, 30-seed verifier confirmation and live read are verified).

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

## Evaluation and live status

- **League evaluation (VERIFIER CONFIRM, 2026-11-21T01:03:52Z):** `nlh_river_full_house_value_is_priced` (`server/src/benchmark/HorseLeague.ts`; arm B `holdemRiverFullHouseValue`, arm A adds this option), verified by `session_01UxDLnLPjcC14fSouoKnY5C` (`runs/card30.jsonl`, 30 seeds x 6,000 pairs = 180,000 pairs / 360,000 hands): pooled `-0.0190 +/- 0.0643 bb/100` (`|z| = 0.30`), `272` priced-decided spots, `326` divergent pairs, `0` illegal/truncated/fallbacks -> `EVEN: CONFIRMED`.
- **Live activation (2026-11-21T01:19:04Z):** LIVE ON via audit `#166`, evidence `#70`, Horse SWITCH lane `01UxDLnM4cwZVwdaVF3xHY2s`, serving `e2140d2d1581`, `8/8` workers at `+68s`.
- **+40 min live read PASS (2026-11-21T02:01:01Z):** `holdem_river_full_house_lead_priced: 2`, `_check_priced: 2`, `_lead_unpriced: 1`, `0` config alarms/fallbacks/errors; confirmed picked up on `bb21dc82673` and `1a0a6047e1a`.
- **Audited-decision replay:** not run with `server/scripts/audited-decision-replay.ts --row` (recorded honestly as `Replay: NOT RUN` below).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
