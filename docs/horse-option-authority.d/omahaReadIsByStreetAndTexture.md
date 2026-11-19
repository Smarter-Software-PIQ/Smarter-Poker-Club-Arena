# omahaReadIsByStreetAndTexture: authority for the live switch

Built 2026-11-18 by the PLO Strategy lane (readwire). Evidence MET, thin (2026-11-18): the league on the fixed card at source aff6e088a0c is a WIN (section "League evaluation of the fixed card"); the earlier EQUAL (fb900cf162f) and INVALID (eb30ce7a6f9) runs are superseded; the replay bar is MET (reconstructed read). Production reach needs the stored street record (migration 20261117175407, installed). Any switch-on is the PLO lane lead's decision (owner 2026-11-17 18:01 America/Chicago), and only once the engine serving production (`/health` releaseSha) is a build that contains this option and this file; until then no option-switch row may name it (the 2026-11-18T15:37Z hazard: a row for an option the serving build does not know invalidates the whole switch set); this file records the evidence for that decision. It records what the option is, what was measured and what must pass first.

## What it does

PLO4/PLO5 cash, one board, no bomb pot, on the flop, the turn and the river. The read #11215 keeps of each opponent by street and by flop texture (`HorseMind.omahaStreetReadOf`, carried into the decision from the exact profile's street record) is used for three inputs that otherwise read one pooled postflop figure for every street and board (`server/src/engine/HorseOmahaReadByStreet.ts`, installed for one decision by `HorseOmahaReadByStreetRule.ts`):

- The value-leader label (`HorseMind.omahaReadConditionalOf`, read by every value-leader rule and by the facing-bet read): a continuous per-street quantity, weight = w x E + (1 - w) x L, where L is the pooled label (0 or 1), w = opp / (opp + 6) with opp the decayed opportunities of the street's bet cell (the flop texture's cell on the flop), and E the posterior probability that on this street he bets no more often than the Horse mean, folds to a bet at least as often, and (pooled; no street cell exists) calls rivers no more often. The label is the more likely side (weight >= 0.5). With no street evidence the weight is L exactly.
- The bettor's bet rate beside the Horse mean (`HorseMind.omahaFacingBetEvReadOf`, betCheckedToRatio, the input `omahaEvBluffShare` turns into his bluff share and its 0.65 cap): his street rate shrunk toward his pooled posterior by the cell's own opportunities (`omahaPricedShrunk`), over the Horse mean. No opportunity threshold.
- The priced comparisons' fold to a bet and fold to a raise: the street-rates seam of #11212 (`omahaPricedStreetRatesOf`) supplies the decision street's cells, which `omahaPricedRead` shrinks toward the pooled figure; restored when the decision returns.

`HorseOmahaFacingBetEv.ts` is not touched; priors and the bluff factor stay with their owners. With the option unset or false, and with the option on but no street record (production until migration `20261117175407` is installed and cells fill), every decision is byte-identical.

The short opening all-in below a minimum bet is counted as "no bet" in the street cells, as in the pooled counters (review note N2 of #11215, decided: kept, because the street figure shrinks toward the pooled one and both must count the same events).

Default OFF in source (read `=== true`). Registered in the option switch (follow-up migration `20261118070047_horse_option_switch_omaha_option_batch` (the option batch's one regenerated follow-up; the component's own 20261118015457 was deleted)), switchable live, not off-only. On live only by an option-switch row whose note cites this file and its sha256. Inert in production until migration 20261117175407 is installed (daily maintenance window) and an engine that reads v18 frames serves. Rollback: the switch row off.

## The owner's orders it rests on

- 2026-11-17 11:49 America/Chicago (relayed in the lane's handoff, archive `plo-handoff-review-01a1cbbd`): "there should not be any blanket rules, ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17 19:23 America/Chicago (coordination inbox 2026-11-18T01:25:11Z): finish, build, fix and enhance, fully wired in and tested before claiming success.

Neither is an order to switch this option on.

## The audits it answers

- `plo-handoff-review-01a1cbbd/rules-audit-01BNteGZ/PLO-BLANKET-RULE-AND-CONFLICT-AUDIT-20261117.md`: the pooled read (HorseOpponentExploit.ts) and the value-leader label (HorseOmahaReadConditional.ts) as one label on every street and texture; the bluff cap.
- `plo-handoff-review-01a1cbbd/audit2-01BNteGZ/`: on paired boards his bets were trips or better 60 / 77 / 72% by street; on unpaired flops more than half were draws or one pair; Horses fold to his bets 71 / 66 / 71% by street.

## Replay on real audited decisions (reconstructed read)

Archive `plo-handoff-review-01a1cbbd/readwire-013U37/` (REPLAY.md). The 2,950 audited PLO5 decisions of audit2 (the priced lane's record file and state builder), base = 2026-11-16 ON-LIST + omahaTurnRiverRaiseIsPriced, the option off vs on. His street read is RECONSTRUCTED from his 800 production PLO5 cash hands before the audit window by the engine reducer (production has no stored street record yet); his pooled read is the priced lane's replay object.

- With the pooled and street reads: 30 decisions changed (26 more aggressive, 4 more passive); 0 illegal, 0 receipt-refused; of 23 judged, 7 audited-wrong fixed, 3 newly wrong; judge EV of the changed decisions +113.8 bb over 20 priced (mean +5.69, SE 4.03).
- With the street read alone (no pooled read): 0 changed (the label and the ratio need a pooled read; the priced street cells changed no omahaTurnRiverRaiseIsPriced decision).

## Receipts

omaha_read_by_street_carried (a postflop decision with the mode on in which a live opponent carried a street record). The decisions it moves are counted by the receipts of the rules that read the moved inputs.

## Tests

`HorseOmahaReadByStreet.test.ts`: the mode and its scope; the value-leader quantity (pooled label exactly with no street evidence; the WooWoo shape flips the label off on unpaired flops and keeps it on the turn; continuous and monotone in the evidence); the bet rate and the priced cells; through `HorseLogic.decide` on the recorded facing bets: byte-identical with the option on and no record and with the option off and a record, and moved decisions with both; the priced source is never left registered. `anOpponentIsReadByStreetAndFlopTexture.law.test.ts` law 8 now admits exactly these readers.

## Evaluation

### The first league (fb900cf162f): EQUAL, superseded

Superseded by the league of the fixed card below: this run was on the source before the review R2 B1 fix (section "Batch integration").

Declared before it ran: archive `readwire-013U37/PASS-BAR.md` (written 2026-11-18T02:05Z; launched 03:07:52Z on commit fb900cf162f in a detached worktree, `RUN-SOURCE.txt`; engine file sha256 unchanged at the end). Arm A: the 2026-11-16 production list (activation-0106z/ON-LIST.txt) + omahaTurnRiverRaiseIsPriced + this option; arm B the same without it. runMatchup, duplicate deals, six seats, 100 big blinds, cash, EQUITY_GOVERNOR=off; the league learns the street read in each session's sandbox (`HorseLeagueStreetRead.ts`). Result (archive `readwire-013U37/RESULT.json`, per-session lines in `eval/`):

| cell | table                                          | sessions x pairs | A minus B, bb/100 | SE   | z     | divergent pairs |
| ---- | ---------------------------------------------- | ---------------- | ----------------- | ---- | ----- | --------------- |
| F4   | PLO4, one Horse vs five human-calibrated seats | 400 x 500        | +0.09             | 0.21 | +0.42 | 77              |
| F5   | PLO5, the same                                 | 400 x 500        | -0.54             | 0.30 | -1.84 | 90              |
| M4   | PLO4, Horse-only, production styles            | 100 x 500        | +0.15             | 0.18 | +0.85 | 634             |
| M5   | PLO5, the same                                 | 100 x 500        | +0.28             | 0.13 | +2.14 | 281             |

Pooled: human-like -0.23 bb/100, SE 0.18; Horse-only +0.22 bb/100, SE 0.11. Validity: illegal actions 0, brain exception fallbacks 0, truncated streets 0, every session present once, no inert cell. Verdict under the bar: EQUAL (no cell or pooled figure below -2 SE; the human-like pooled figure is not above +2 SE). The option is not off-only. The human-like field does not change its play by street, so the read rarely moves a label there (fewer than 1 in 2,000 pairs diverge); the replay against the measured winner's reconstructed read is the closer test of what the option is for.

## League card (fixed 2026-11-18)

League cards (HorseLeague.ts, declared): plo4_omaha_read_is_by_street_and_texture and plo5_omaha_read_is_by_street_and_texture: both arms carry the live production set (the 2026-11-16 live options, `OMAHA_LIVE_OPTIONS_20261116`, plus omahaTurnRiverRaiseIsPriced, on since 2026-11-18 11:54Z), arm A adds omahaReadIsByStreetAndTexture. This is the base the replay and the first (fb900cf162f) league above used. The card as merged in #11277 (86ab7637d9e) was arm A `{ omahaReadIsByStreetAndTexture: true }` against `{}`: the option only re-routes reads other options consume, all off in that base, so its evaluation on eb30ce7a6f9 (archive `evals-013U37/omahaReadIsByStreetAndTexture/`, 1,000 sessions) measured 0 divergent pairs in every cell and is INVALID (inert card), not a result about the option. `ADefaultOffFlagHasALeagueCard.law.test.ts` now refuses a card for this option (and the other read-only options) unless a consumer of its read is on in both arms. The league of the fixed card on the B1-fixed source is below.

## League evaluation of the fixed card (source aff6e088a0c, 2026-11-18)

Declared before it ran: archive `plo-handoff-review-01a1cbbd/evals-013U37/omahaReadIsByStreetAndTexture-aff6e088a0c/PASS-BAR.md` (WIN: no cell and neither pooled z below -2, and F4 or F5 z above +2). Launched 2026-11-18T14:02:56Z, finished 14:23:36Z, on a detached checkout of aff6e088a0cf083618a130133ca7e504da47e071 (0 dirty files; sha256 equal at start and end). Arms from the fixed cards plo4/plo5_omaha_read_is_by_street_and_texture: B = `OMAHA_LIVE_OPTIONS_20261118`, A = B + omahaReadIsByStreetAndTexture. Seeds field mix(6320000 + i), mirror mix(6325000 + i). Results: `RESULTS.md` in that folder. A minus B, bb/100:

| cell | table                                          | sessions x pairs | A - B, bb/100 | SE    | z     | divergent pairs | inert sessions |
| ---- | ---------------------------------------------- | ---------------- | ------------- | ----- | ----- | --------------- | -------------- |
| F4   | PLO4, one Horse vs five human-calibrated seats | 400 x 500        | +0.635        | 0.275 | +2.30 | 72              | 346            |
| F5   | PLO5, the same                                 | 400 x 500        | +0.086        | 0.239 | +0.36 | 72              | 342            |
| M4   | PLO4, Horse-only, production styles            | 100 x 500        | +0.484        | 0.264 | +1.84 | 972             | 8              |
| M5   | PLO5, the same                                 | 100 x 500        | +0.131        | 0.255 | +0.51 | 736             | 16             |

Pooled: human-like +0.360 bb/100, SE 0.182 (z +1.98); Horse-only +0.307 bb/100, SE 0.184 (z +1.68). Valid: every session present, 0 illegal, 0 truncated, 0 fallbacks, 8 processes exit 0. Verdict under the bar: WIN. It is thin: only F4 is above +2 SE, on 72 divergent pairs (346 of its 400 sessions inert); no cell and no pooled figure is negative. The human-like field does not change its play by street, so the option rarely moves a decision there.

Main since that source: the option's files (`HorseOmahaReadByStreet.ts`, `HorseOmahaReadByStreetMode.ts`, `HorseOmahaReadByStreetRule.ts`, `HorseLeagueStreetRead.ts`) are byte-identical to the evaluated source; `HorseLogic.ts`, `HorseMind.ts` and `HorseLeague.ts` changed after it (#11287, #11290; see omahaSmallBetIsPriced.md). Not re-measured on that base.

## Evidence rows

- Value (league): MET, thin (WIN on the fixed card at aff6e088a0c, above). The EQUAL run (fb900cf162f, before the B1 fix) and the INVALID run (eb30ce7a6f9, inert card) are superseded.
- Replay row: MET (above; reconstructed read, not the production read at decision time).
- Reach row: migration 20261117175407 (the stored street record) is installed. Production reach begins when a build that writes and reads the street record serves and its cells fill; not yet counted in production. With the option on and no street record every decision is byte-identical.
- Overall: evidence MET (thin). Switch-on is the PLO lane lead's decision, and only once the engine serving production (`/health` releaseSha) is a build that contains this option and this file; until then no option-switch row may name it (the 2026-11-18T15:37Z hazard: a row for an option the serving build does not know invalidates the whole switch set). Rollback: the switch row off.

## Limits

The league's human-like field does not change its play by street the way the measured winner does; the league learns the street read with a stand-in for the database learner. The replay uses a reconstructed read, not the production read at decision time.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

Review R2 B1 of readwire 6f5d5ff8dcf, fixed in the batch: the street bet and fold-to-bet cells were tested against ALL-STREET means and shrunk toward all-street posteriors, and a street bet rate was divided by the all-street mean, so an exactly average player flipped label and bluff share by street. Each mean and each shrink prior is now carried to the street by the population's street-to-pooled ratio (`omahaStreetScale`, from priced2's measured Horse kind prior; the envelope means are the Horse population's), in `omahaStreetValueLeader` and `omahaStreetBetRate`. Test: HorseOmahaReadByStreet.test.ts ("a population-average player reads the same on every street"). **The EQUAL league above was measured on fb900cf162f, before this fix.** The league on the fixed source (aff6e088a0c) is a WIN, thin (section "League evaluation of the fixed card").
Note N3: OMAHA_PRICED_SHRINK and priced2's OMAHA_PRICED_READ_PRIOR_STRENGTH are two shrink constants for related reads (not merged here).

## Switch-on hold: minimum-raise ladder (2026-11-19, plo-truncation-013U37)

With omahaSmallBetIsPriced and omahaTurnRiverRaiseIsPriced on (both live), this option at f3e99378ccbb produced a Horse-vs-Horse minimum-raise ladder (BLANKET-LOO-1 Horse-only cells; HORSE SWITCH lane inbox 2026-11-19T00:32:26Z). The defect was in the consumer (omahaTurnRiverRaiseIsPriced read the fold-to-raise cell as the fold to every raise size; see that file, same date). The league WIN above was measured without omahaSmallBetIsPriced in the base and before that fix: switch-on needs a build carrying the fix and a Horse-only mirror cell on the full live base with truncated 0.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: LEGACY (as of 2026-11-19 this file records a replay in prose only; it was not written by the scorer's --row, so the scorer commit and the validity of its arms' option sets are not recorded. A row needs a new run)
