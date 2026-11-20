# omahaReraisedCallVsRaisePriced: authority for the live switch

Built 2026-11-18 for the call-or-raise follow-up of finding F-06 of the WooWoo 48-hour decision audit (archive `woowoo-48h-audit-01BNteGYgf/repairs/F-06-hotfix/`: CALL-VS-RAISE.md is the analysis, CALL-VS-RAISE-BUILD.md the build report). This file does not authorize switching the option on: no owner order names it and its value evidence is a fixed-input counterfactual on one table population (see Evidence rows).

## What it does

PLO4/PLO5 cash tables, high only, one board, no bomb pot, not Lightning, not a tournament, preflop, facing two or more raises with the re-raiser not all in. Before this option no preflop step could turn a call into a raise and EV(raise) was never computed.

With the option on, the decision left standing by the re-raised-pot rules is priced when it is a call (or a call or fold those rules made of a reference raise): EV(call) by the calling rule's `omahaReraisedCallEv` (the same function and constants, not copied) against

EV(raise) = P(fold) x pot + P(call) x [realization at the stack-to-pot ratio left x equity against his calling band x final pot x (1 - rake) - chips added] + P(re-raise) x max(-chips added, EV of continuing),

with the three rates from the re-raiser's own answers to a raise of his re-raise (his fold share is his own folds only; the prior gives call and re-raise shares) (`HorseOmahaReraiseResponse`, `horse_exact_profiles.reraise_response`) as a posterior against a measured population prior, and the equities against his range and its bands on one run of the calling rule's sampler (`server/src/engine/HorseOmahaReraisedRaisePriced.ts`). It raises only when EV(raise) > 0 and EV(raise) beats the standing action by more than twice its standard error, which counts the equity sampling, the uncertainty of his rates (his counts plus the prior's mass) and the uncertainty of the realization's depth cost (REALIZATION.md). It never lowers a decision. Nothing is keyed to a hand class, a position, a bet size or an account.

Other players in the hand (2026-11-19, the root fix of review item B1). When anyone besides the Horse and the re-raiser is still in the hand (has called the re-raise, is still to act, or is all in), the spot is priced with them in it (`omahaReraisedRaiseMultiwayPriced`): each holds a hand from the band of his own line (the calling rule's `HorseMind.bandFor`; any hand if he has made no voluntary action), drawn together with the re-raiser's hand; each folds the bottom share of that band and continues with the rest, the share being the measured answer of players in his situation to such a raise (he had called the re-raise; he had raised earlier and not yet answered; neither); every sample is one whole outcome, settled with main pot and side pots, money of a player who folds staying in the pot and what nobody can match returned. No per-player record of a third player's answer exists and the engine does not know whether he is a Horse, and the measured groups differ widely (a Horse that called a 3-bet folds to a 4-bet 55 times in 91, a person 7 in 45), so the spot is priced twice on the same samples, at the lowest and at the highest measured share, and it raises only when both clear the bar; the bar also carries the variance of each measured share. A player whose band cannot be read leaves the spot unpriced. Measurement: production hands with a person at the table, 2026-10-15 to 2026-11-17 00:00Z (`repairs/CALL-OR-RAISE-2/` in the audit archive).

Boundary with `omahaPreflopReraiseDefencePricedInPosition` (ON in production since 2026-11-19): a call that option made of a fold (the Horse opened, one person's 3-bet, heads-up, acting after him) is that option's verdict and is not priced here. Every other standing call facing a re-raise is.

Default OFF in source (read `=== true`). Registered in the option switch through the batch whitelist follow-up migration the integrator regenerates for the cutover (this branch carries no switch migration of its own), switchable live, not off-only. On live only by an option-switch row whose note cites this file.

## Dependencies

- It prices what the re-raised-pot rules leave standing, so it does nothing useful without `omahaOopReraisedPotStrongRange` and the two re-raise range options.
- The opponent's record needs migration `20261118023000` installed (the column and the accepted-hand learner). Without it every opponent is priced on the population prior alone (fold 0.014 to a 4-bet, 0.087 to a 5-bet): the option still runs, on no personal read.

## The owner's orders it rests on

- 2026-11-17, relayed by the audit owner: when a fix turns a Horse's fold into a call, investigate whether the spot should have been a raise, in how many spots, and what in the math or code makes the difference.
- 2026-11-17 15:30 America/Chicago: "DONT' MAKE ANY BLANKET RULES, EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".

Neither is an order to switch this option on.

## Receipts

`omaha_reraised_raise_priced_raise`, `omaha_reraised_raise_priced_call` (every priced decision fires one), `omaha_reraised_raise_priced_reference_raise_kept`. The decision carries `omahaReraisedRaise`: the spot, the per-band samples, both EVs, the edge and its standard error.

## Tests

`HorseOmahaReraisedRaisePriced.test.ts` (42 anonymised recorded spots: 24 of the 26 raise-better raise, none of the 12 call-better does; the tight-opponent cell does not raise; the arithmetic), `HorseOmahaOopReraisedPot.test.ts` "omahaReraisedCallVsRaisePriced in the decision" (unset and false byte-identical; on never lowers a decision and draws no random number; PLO6, a tournament, Lightning and a bomb pot byte-identical), `HorseOmahaReraiseResponse.test.ts`, `aReraiseResponseThroughTheWorker.test.ts`, and the PostgreSQL parity proof `scripts/ci/test-horse-exact-public-memory.py`.

## Evidence rows

- Other players priced in the hand (review item B1 at its root): unit tests `HorseOmahaReraisedRaisePriced.test.ts` "other players in the hand are priced in it" and "main pot and side pots", and `HorseOmahaOopReraisedPot.test.ts` "OTHER PLAYERS IN THE HAND ARE PRICED IN IT". The third evaluation is declared in the audit archive, `repairs/CALL-OR-RAISE-2/EVAL-DECLARATION.md` (hashed before its run); its result is `EVAL-RESULTS.md` beside it. Until that result is a PASS and an owner order names this option, it stays OFF.

- Mechanism, scope, receipts, tests: MET.
- Option unset or false byte-identical: MET (unit tests; 2,022 of 2,022 journaled decisions identical to the base in replay).
- Value: two fixed-input counterfactuals over the 2,022 journaled decisions facing a 3-bet or more. The first (`CALL-VS-RAISE-EVAL-DECLARATION.md`, two amendments) passed its bars but was rejected by review (REVIEW-59ea78d08f3.md: other players priced as folding, a prior fold share, a sampling-only bar, one-day records). The second, after those fixes (`CALL-VS-RAISE-EVAL-DECLARATION-2.md`, records rebuilt from production hands since 2026-10-15): **INSUFFICIENT** (13 of the 22 heads-up raise-better decisions raise; bar 17). NOT MET.
- The opponent records in that counterfactual were reconstructed from 1,625 earlier hands of one table population; the live learner had not run then. Since migration 20261118023000 installed, the learner writes the record (production 2026-11-19 20:22Z: 757 of 28,478 exact profiles hold one, about 965 aged opportunities after a 3-bet faced a 4-bet and 68 after a 4-bet faced a 5-bet); on main it is carried into every Omaha decision frame (observerReads, HorsePooledPublicBootstrap) and read by omahaPreflopReraiseDefencePricedInPosition; this option reads it only on its own branch. Live reach: NOT MET. A live read is owed after any activation.

## Limits

No PLO5 solver exists; these are equity, price and EV verdicts against stated ranges. The realization constants are the calling rule's (the out-of-position depth cost is not pinned by any measurement to better than a standard error of 0.15 to 0.30) and realization is capped at 1, which favours getting the money in at small stack-to-pot ratios. With other players in the hand: a third player who continues is priced as calling (his own re-raise is not a separate branch), his answer is a population share by situation and not his own record, thin cells are thin (a 5-bet or later: 2 to 31 spots a cell), dead money sits in the main pot and one rake share serves every outcome. A range is a slice by the engine's percentile, which cannot see domination. The prior rests on 23 players (211 spots) for a 4-bet faced and 23 spots for a 5-bet faced. The priced decision costs one 1,600-sample equity run (about 35 ms more on the replay host under load; with other players in the hand one joint run of the same size, about 70 to 170 ms of processor time).

## Rollback

`fn_ca_horse_option_switch_set('omahaReraisedCallVsRaisePriced', 'off', ...)`: the re-raised-pot rules' own verdict stands again.

## Redesign status (2026-11-18, REDESIGN-PLAN.md section 5)

Ships dark (default OFF). No change to the arithmetic: the value bar of evaluation 2 priced his re-raise share at the prior 0.24 while the option reads his own record (about 0.08), so it could not be met by an honest model. The replacement evaluation is declared fresh (`repairs/F-06-redesign/EVAL-DECLARATION.md`, hashed): heads-up priced spots from hands after migration `20261118023000` is installed and the learner is live; value = EV(raise) - EV(call) against the holding actually held with his later-measured answers, mean > 0 with CI lower > 0; calibration of predicted fold/call/re-raise within 2 SE; the hard safety bars of declaration 2. Not run: the data does not exist yet (about 2-4 weeks of live counters). Activation waits on that result.

## Replay

- Replay: NOT RUN (as of 2026-11-19 the replay below is recorded as verdict-only authority lines, not as a scorer --row run row)

Third evaluation (archive `repairs/CALL-OR-RAISE-2/EVAL-DECLARATION.md`, run after the CUTOVER-4 seal, 2026-11-19 21:20-21:45Z): verdict FAIL as declared (B2: 25 fast-table and 15 kept decisions of the held-out set differ from the unset arm in the decision digest only; cause: the opponent records were injected in the on arm only, amendment A1 re-judges with injection in every arm) and B0 INSUFFICIENT (690 records the worker runtime cannot replay). The option stays OFF. Scorer lines, the regression set R (2,022 journaled decisions of 2026-11-16/17), arms off = the candidate with the option unset and on = the option on, copied unedited from `npx tsx scripts/audited-decision-replay.ts --woowoo decisions-full.csv --woowoo-findings decision-to-finding.csv --replay replay-R.jsonl --base off --line <arm>`:

Authority replay line (off): woowoo (verdict-only; 17407 audited decisions, 2726 judged bad; joined by node: 2022 replayed, 15385 not replayed, base reproduces the recorded action on 1810): arm off absent
Authority replay line (on): woowoo (verdict-only; 17407 audited decisions, 2726 judged bad; joined by node: 2022 replayed, 15385 not replayed, base reproduces the recorded action on 1810): arm on changed 41 (41 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 6, newly wrong 16, still wrong 0, ok to ok 0, unjudged 19; judged bad left unchanged 177; no bb (the audit declares no EV model); per receipt: omaha_maniac_reraise_width_measured 38 changed / 6 fixed / 15 newly wrong; omaha_oop_reraised_call_kept 35 changed / 6 fixed / 12 newly wrong; omaha_reraise_by_position_called 1 changed / 0 fixed / 1 newly wrong; omaha_reraised_call_in_position_caller_pending_seen 4 changed / 0 fixed / 2 newly wrong; omaha_reraised_call_priced_call 18 changed / 1 fixed / 0 newly wrong; omaha_reraised_call_priced_call_after_own_raise 16 changed / 1 fixed / 0 newly wrong; omaha_reraised_call_priced_in_position 4 changed / 0 fixed / 0 newly wrong; omaha_reraised_call_priced_multiway_equity 2 changed / 0 fixed / 0 newly wrong; omaha_reraised_call_priced_out_of_position 14 changed / 1 fixed / 0 newly wrong; omaha_reraised_raise_priced_raise 41 changed / 6 fixed / 16 newly wrong; omaha_reraised_raise_priced_reference_raise_kept 1 changed / 0 fixed / 1 newly wrong; v38_preflop_allin_price 38 changed / 6 fixed / 15 newly wrong; v53_pressure_three_bet_priced 11 changed / 1 fixed / 3 newly wrong.

The held-out set H (2026-11-17 18:30Z to 11-19 01:17Z) is after the audited window: the scorer joins none of its nodes (0 replayed).
