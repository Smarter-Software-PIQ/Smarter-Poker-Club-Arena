# omahaSmallBetIsPriced: authority for the live switch

Built 2026-11-18 by the PLO Strategy lane (block-bet design, plo-handoff-review-01a1cbbd/blockbet-013U37/BLOCK-BET-SPEC-20261118.md). Evidence MET (2026-11-18): replay MET, league WIN on the rebased card at source aff6e088a0c, decision latency PASS (section "League evaluation of the rebased card"). Switch-on is authorized by the PLO lane lead (owner 2026-11-17 18:01 America/Chicago: this lane decides its own switch-on and switch-off; the main session flips, agents never flip) once the engine serving production (`/health` releaseSha) is a build that contains this option and this file; until then no option-switch row may name it (the 2026-11-18T15:37Z hazard: a row for an option the serving build does not know invalidates the whole switch set).

## What it does

PLO4/PLO5 cash, one board, high only, heads-up, on the turn or the river with nothing to call (the card-impact scope): the owner's check or bet is priced on the card-impact model (`server/src/engine/HorseOmahaCardImpact.ts`, the one owner of the bet-response model) beside bets of 10%, 20% and 25% of the pot (`OMAHA_SMALL_BET_SIZES`, a candidate set, not a threshold). The best small bet replaces the owner's choice only when its expected value is higher by 2% of the pot (`OMAHA_PRICED_SAMPLED_MARGIN`).

- Hand and range: the card-impact sample (the Horse's exact cards, the opponent's range weighted by his line, card removal).
- Response: at every size, his continue share is the model's own level at the reference bet (60% of the pot: the pot odds scaled by his measured continue rate, `omahaCardImpactKeep`) moved on the log-odds scale by what the measured response of his kind (a person or a Horse) moves between that size and the reference; of the continuing hands, the measured share of his kind at that size raises (`server/src/engine/HorseOmahaSmallBetConstants.ts`, generated from blockbet-013U37/measure/smallbets.json, 5,379 PLO4/PLO5 cash hands with a person seated, Nov 13-17; each cell shrunk toward the two-variant pool with 6 pseudo-counts; the curve starts at a share of 0 where nothing folds). A person's response is never used for a Horse opponent, nor the reverse.
- Never: a bet into a check, a nut-class bet made smaller, an all-in changed, an owner-ruled check (out-of-position and paired-board checks) turned into a bet. The limped-pot minimum bet still acts after it.
- Not priced (owner's decision kept, receipt `omaha_small_bet_unpriced_kept`): the flop (no card-impact model), multiway, no legal small size.

Receipts: `omaha_small_bet_priced_bet`, `omaha_small_bet_resized`, `omaha_small_bet_kept`, `omaha_small_bet_unpriced_kept`, `omaha_small_bet_owner_check_kept`.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- Earlier: "THE SIZE OF THE BET SHOULD NOT MAKE OR BREAK THE DECISION".

## Known limits

The measured response is unconditional on the board and the hand; only its shape by size is used, its level is the model's. River raise shares at small sizes rest on small cells (n 20-34 per variant). The joint-policy filter of bets under 25% of the pot (HorseTournamentUtility.ts) and the defence side (small-bet range rows by bettor kind) are NOT in this option (spec parts 2.4 and B).

## Tests

`server/src/engine/HorseOmahaSmallBet.test.ts`: off byte-identical (unset, false, truthy non-boolean; same randoms, no receipts), the card-impact model unchanged without a curve, the curve's level, shape, kind split and continuity, the verdict's never-rules and margin, and decide-level reach with receipts that pass the worker validator.

## Evaluation

Bar: blockbet-013U37/PASS-BAR.md (replay on audited decisions, then one paired league evaluation), and for the rebased card `evals-013U37/omahaSmallBetIsPriced-aff6e088a0c/PASS-BAR.md`. Replay MET; league WIN; latency PASS (sections below).

## League card (rebased 2026-11-18)

League cards (HorseLeague.ts, declared): plo4_omaha_small_bet_is_priced and plo5_omaha_small_bet_is_priced: both arms carry production's live set (`OMAHA_LIVE_OPTIONS_20261118` = the 2026-11-16 live options plus omahaTurnRiverRaiseIsPriced, on since 2026-11-18 11:54Z), arm A adds omahaSmallBetIsPriced. Lead decision 2026-11-18 (PR #11286): the card as merged in #11277 (86ab7637d9e) was `{ omahaSmallBetIsPriced: true }` against `{}`; the option acts after the street plan and the card-impact rule, which are live, so the bare base measured it in a brain production does not serve. The league evaluation below ran on this card.

## League evaluation of the rebased card (source aff6e088a0c, 2026-11-18)

Declared before it ran: archive `plo-handoff-review-01a1cbbd/evals-013U37/omahaSmallBetIsPriced-aff6e088a0c/PASS-BAR.md`. Launched 2026-11-18T14:23:56Z, finished 14:47:53Z, on a detached checkout of aff6e088a0cf083618a130133ca7e504da47e071 (0 dirty files; the engine and league file sha256 equal at start and end). Arms from the league cards plo4/plo5_omaha_small_bet_is_priced: B = `OMAHA_LIVE_OPTIONS_20261118`, A = B + omahaSmallBetIsPriced. Six seats, 100 big blinds, cash, duplicate deals; seeds field mix(6330000 + i), mirror mix(6335000 + i). Results: `RESULTS.md` in that folder, per-session rows in `rows/`. A minus B, bb/100, mean over sessions and its standard error:

| cell | table                                          | sessions x pairs | A - B, bb/100 | SE    | z     | divergent pairs | inert sessions |
| ---- | ---------------------------------------------- | ---------------- | ------------- | ----- | ----- | --------------- | -------------- |
| F4   | PLO4, one Horse vs five human-calibrated seats | 400 x 500        | +7.193        | 1.031 | +6.98 | 4,292           | 0              |
| F5   | PLO5, the same                                 | 400 x 500        | +4.568        | 1.061 | +4.30 | 4,003           | 0              |
| M4   | PLO4, Horse-only, production styles            | 100 x 500        | +4.045        | 0.477 | +8.48 | 7,017           | 0              |
| M5   | PLO5, the same                                 | 100 x 500        | +1.901        | 0.628 | +3.03 | 7,127           | 0              |

Pooled: human-like +5.880 bb/100, SE 0.740 (z +7.95); Horse-only +2.973 bb/100, SE 0.394 (z +7.54). Valid: every session present, 0 illegal actions, 0 truncated streets, 0 brain exception fallbacks, 0 corrected, every session divergent, 8 processes exit 0. Verdict under the bar: WIN.

Decision latency (the bar's open check, `LATENCY.md` in the same folder; PLO5 turn and river p99 under 80 ms with the option on): PASS. Per outermost `HorseLogic.decide` call, single thread, Horse-only mirror on the same arms, 6 x 1,000 pairs per variant:

| variant | street | p99 option on | p99 option off | max option on |
| ------- | ------ | ------------- | -------------- | ------------- |
| PLO4    | turn   | 24.44 ms      | 17.50 ms       | 44.06 ms      |
| PLO4    | river  | 17.15 ms      | 13.49 ms       | 22.58 ms      |
| PLO5    | turn   | 26.63 ms      | 20.58 ms       | 62.34 ms      |
| PLO5    | river  | 21.44 ms      | 17.83 ms       | 23.69 ms      |

The option adds 3.6 to 6.9 ms at p99 on the turn and the river and nothing elsewhere. Measured on the development machine under moderate shared load (load averages 4.7 to 7.9), not on the engine host: a relative check, not a production service level.

Main since that source: the option's own files (`HorseOmahaSmallBet.ts`, `HorseOmahaSmallBetConstants.ts`, `HorseOmahaCardImpact.ts`) are byte-identical to the evaluated source; `HorseLogic.ts`, `HorseMind.ts` and `HorseLeague.ts` changed after it (#11287, the scope correction of the live option omahaOopReraisedPotStrongRange in re-raised pots, present in both arms; #11290, vpipFloorLimpOnly, default off). Not re-measured on that base.

## Evidence rows

- Mechanism, scope, receipts, tests: MET (section Tests).
- Replay on audited real decisions: MET (archive `blockbet-013U37/REPLAY-20261118.md`; fixed 15 / 29 / 14 on the three sets, newly wrong 0).
- Value (league): MET, WIN on the rebased card at aff6e088a0c (above).
- Speed: MET, PLO5 turn p99 26.63 ms and river p99 21.44 ms against 80 ms (above).
- Overall: MET. Switch-on: authorized by the PLO lane lead once the engine serving production (`/health` releaseSha) is a build that contains this option and this file; until then no option-switch row may name it (the 2026-11-18T15:37Z hazard: a row for an option the serving build does not know invalidates the whole switch set), by an option-switch row whose note cites this file and its sha256 in the serving build. Rollback: the switch row off.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

- Replay on audited real decisions (blockbet-013U37 PASS-BAR section 1): MET (fixed 15 / 29 / 14 on the three sets, newly wrong 0).
- League: WIN on the rebased card at aff6e088a0c (section "League evaluation of the rebased card"); latency PASS.
- Receipts (review R3 N2): `omaha_small_bet_priced_bet` and `omaha_small_bet_resized` are now proposed through omahaProposeReceipt against the bet as the limped-pot floor leaves it and fire only if that is the final decision; otherwise `omaha_small_bet_priced_bet_vetoed` / `omaha_small_bet_resized_vetoed`. Test: HorseOmahaSmallBet.test.ts "receipts describe the final action" (alone and with every other Omaha option on: a made receipt names a bet that stood, a replaced small bet fires only its `_vetoed` receipt; fails on the pre-fix direct fire).
- Paired boards (review R3 N3): the card-impact rule's conflict-sweep S4 guard (no bet created or enlarged on a paired turn or river with less than a full house against a measured value leader) governs the card-impact press only. This rule runs after it and may still offer a 10-25% pot bet in that spot; the S4 guard does not apply to it (a stated gap, to be priced, not gated).
