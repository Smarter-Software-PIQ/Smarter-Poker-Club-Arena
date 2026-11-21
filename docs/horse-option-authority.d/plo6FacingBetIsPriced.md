# plo6FacingBetIsPriced: authority for the live switch

Status: built, OFF, Evidence NOT MET (2026-11-20). Mechanism, scope, receipts, validator admission, law tests and off-identity are MET; the replay of the audit's flagged folds is stated below (96 of 164 reproduced fold mistakes flip to the call); the replay bar is now RUN on the HVH48 auditor C PLO6 set with the committed scorer, off against on at seeds 1, 7 and 42, and every run row has newlyWrong at or below fixed (93/80, 94/82, 95/78); the league card is declared and not yet dealt, and this file's activation section requires it, so the evidence is not met. Nothing in this change switches anything.

## The owner's rules it rests on

- No blanket rules; every Horse decision priced by range, equity and EV; a bet size never triggers a decision by itself (HORSE DECISIONS lane brief, 2026-11-19, lead session 01TLQer7J; owner 2026-11-17 11:49, quoted in `HorseOmahaPricedRules.ts`).
- Audit: HVH48 auditor C, `agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/C-plo6/REPORT.md` (11,558 PLO6 Horse decisions against people over 48 hours; 183 fold mistakes facing a bet, 156 of them flipped by switching the six fold rules off).

## What it does

PLO6 runs on the categorical Omaha path; every priced Omaha option is PLO4/PLO5 only (`omahaStrategyInPlo6` is held off). Facing a bet a PLO6 Horse folded by: the random-hand river fold (`plo6RiverNutDiscipline`, V58/V59: a river call over 10% of the pot folds when one random six-card hand beats the Horse 15% / 30% of the time, whatever the bettor's range and the price; its other arm turns raises into calls), the class ceilings on the equity (V15, V40, V87), the paired-board fold (below a full house, any bet of a quarter of the stack), and the paired-river check (below a full house, the river is checked after a called turn bet on a paired board).

With `plo6FacingBetIsPriced` on, in PLO6 cash (a table or Lightning; never a tournament, a bomb pot, All-In-Or-Fold, hi-lo or more than one board), facing a bet or a raise, the answer is priced on the Horse's exact six cards against the bettor's line range (`server/src/engine/HorsePlo6FacingBetIsPriced.ts`):

- Turn and river: the exact counts of `HorseOmahaFacingBetEv` with six cards (every holding counted with the engine's evaluator, the Horse's cards, the board and known dead cards removed; on the turn every river card). The bettor's range is a value region from his bet's share of the pot and his line, plus the measured population bluff share; the field must be beaten too. EV(call) against the exact price, net of the marginal rake, over the one margin. On the river a raise to each legal size is priced as `omahaPricedRaise` prices it; the raise is the answer when EV(raise) beats the call and the fold by that rule's margin.
- Flop: the seeded six-card sample of `HorseOmahaFlopFacingBetEv` (holdings drawn from the unseen cards, two-card runouts walked evenly, the field on the same runouts, its realization model for chips behind).
- The value region at the same hand strength (`server/src/engine/HorsePlo6ValueShare.ts`): the value shares were set on four- and five-card holdings; the strongest V of six-card holdings is a much higher bar on the same board (on a paired board it is all quads). The six-card region is taken at the strength of the top V of four-card holdings on this board, sampled with a seed from the cards. STATED, not measured.
- No random-hand share decides anything: the SPEC-A 3.12 six-card fold guard (`plo6FacingBetEvFoldStands`) is passed off; the verdict reads no option, no opponent memory and no priced-mode state, so the receipt validator re-runs it on the request.

Where it acts (`HorseLogic.ts`):

1. `plo6RiverNutDiscipline` does not run in this scope (receipt `plo6_facing_bet_priced_river_nut_rule_not_run`).
2. `pairedBoardFold`: where the call is priced the fold stands aside; a flop or turn raise it would have folded becomes the call (`plo6_facing_bet_priced_paired_fold_priced_out`).
3. `pairedBoardRiverCheck`: the bet is priced beside the check (`omahaPricedBet`, the card-impact model, population figures); where EV(bet) is at least EV(check) the bet stands (`plo6_facing_bet_priced_paired_river_bet_kept`), else the check stands by price (`plo6_facing_bet_priced_paired_river_check_priced`).
4. Outermost in the `wager_rules` node (`plo6FacingBetIsPricedRule`): on the flop and the turn a fold becomes the call where the call is priced, so no class ceiling decides a fold (`plo6_facing_bet_priced_called`); a call or raise the brain made is left. On the river the answer is the priced fold, call or raise (`plo6_facing_bet_priced_folded`, `_called`, `_raise_to_call`, `_raised`).

Validator: `responseValidation.ts` admits the PLO6 fold (or paired-folded raise) to call in `wager_rules` only where the call is priced for the exact chips, re-run on the request with no rake and either position (`plo6FacingBetPricedAdmitsCall`; a superset of what the rule can call), and since review N4 (2026-11-19) only under the decision's own option (`HorseDecisionReceiptContext.plo6FacingBetIsPriced`, `plo6FacingBetIsPricedGateCandidates` in `client.ts`), so a PLO6 fold to call from any other cause is not admitted by this superset. The river raise to call is the existing `plo6RiverRaiseToCall` admission; folds and wagers are admitted as before.

Default OFF in source (read `=== true`). Off (unset, false, a truthy non-boolean) every decision is the one it was, byte for byte (law test).

## Measurement (replay through the serving brain, 2026-11-19)

The auditor's replay harness (`hvhC_replay.ts`, `HorseComplaintReplay.stateAt` + `HorseLogic.decide`, the live cash profile, seeds 1, 7, 42, opponent memory off, the production switch set of the audit day), this branch off against on:

- The 183 flagged folds (POTODDS-FOLD 160, ALLIN-FOLD-PRICED 23): 164 reproduce the fold in 2 or 3 seeds off. On, 96 flip to the call (3,053.1 bb of the audit's loss; river 48, flop 28, turn 20; POTODDS-FOLD 80, ALLIN-FOLD-PRICED 16). The other 68 stay folds and every one is a priced fold (the verdict's EV(call) under its margin): river 44, flop 12, turn 12. Among them #59974302 (aces full on 6-9-2-2-2 facing a river raise: the raise's value region is quads) and #59973335 (fours full facing a pot-size triple barrel on a paired board).
- River raise cases (#60074744, #60077887, #59973335, #60069935): the raise is priced and is not above the call by the margin (#60074744: EV raise 13.51 against call 13.34; #60077887: 8.77 against 10.05), so the answer is the call; it is the priced call, never the random-hand flattening.
- Regression probe: 1,471 PLO6 postflop facing-bet decisions the audit did not flag CLEAR or LIKELY: 1,228 unchanged, 144 not reproduced off, 99 changed: 94 folds became calls (42 with positive call EV under the auditor's pricing, +103.6 bb raw showdown EV; 52 negative, -296.1 bb raw showdown EV with no realization, mostly small flop and turn margins), 3 river all-in raises became calls, 1 became a smaller raise, 1 river call became a fold (auditor equity 0.77 against 0.31: newly wrong).

Raw outputs: `agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/plo6price-01TLQer7J/` (BUILD.md and the replay lines).

## Not covered

- PLO6 own bets into ranges that only continue with better (audit class 2), preflop (classes 6 and 8), and turn and flop raises (left as the brain makes them).
- The field shares (a caller, an earlier all-in, a player behind) and the bluff priors are the PLO4/PLO5 figures; the value-share translation is STATED. The raise model's fold-to-raise is the minimum-defence population figure (no per-opponent read: the verdict reads no memory so the validator can re-run it).
- The ceilings (V15/V40/V87) still compute inside the brain and shape its call or raise; with the option on they cannot decide a fold.

## Receipts

`plo6_facing_bet_priced_called`, `plo6_facing_bet_priced_folded`, `plo6_facing_bet_priced_raise_to_call`, `plo6_facing_bet_priced_raised`, `plo6_facing_bet_priced_river_nut_rule_not_run`, `plo6_facing_bet_priced_paired_fold_priced_out`, `plo6_facing_bet_priced_paired_river_bet_kept`, `plo6_facing_bet_priced_paired_river_check_priced` (all in `HorseDataLedger.ts`). With the option on, `v58_plo6_river_fold`, `v59_plo6_river_unpaired_fold` and their raise-to-call receipts do not fire in this scope.

## Tests

`server/src/engine/Plo6FacingBetIsPriced.law.test.ts` (registered in `docs/laws.d/`), on the audit's own hands anonymised (`Plo6FacingBetIsPriced.fixture.json`): red off, green on for #59974054, #59972261, #60060560, #59973455, #60040999, #60067736, #60093920; the river answer is the verdict's for #59974302, #59973335, #60069935, #60074744, #60077887, with no V58/V59 receipt; no facing-bet fold that is not the priced fold over the fixtures and re-dealt river spots (V58/V59 fire on the same spots off); off byte-identical; the receipt validator admits every on decision.

## League

Card `plo6_facing_bet_is_priced` (PLO6, six seats, production personas, 6,000 pairs; a: the option on, b: today's brain). Not yet dealt.

## What the activation row must contain

`option = 'plo6FacingBetIsPriced'`, `state = 'on'`, note `authority: plo6FacingBetIsPriced docs/horse-option-authority.d/plo6FacingBetIsPriced.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` after the follow-up option-switch migration of this change is installed, and only once its league card and replay evidence are recorded here as MET. The maintained rollback (the row off, about 30 s) restores today's brain exactly.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited. The three rows below are the scorer's output for this file, unedited.

- Replay: fixed 93; newlyWrong 80; changed 211; unchanged 9967; unjudged 38; set HVH48 auditor C PLO6 seed 1; scorer 17902e71ecf; source plo6 verdict-only; arm on vs off; replayed 11558 of 11558
- Replay: fixed 94; newlyWrong 82; changed 212; unchanged 9966; unjudged 36; set HVH48 auditor C PLO6 seed 7; scorer 17902e71ecf; source plo6 verdict-only; arm on vs off; replayed 11558 of 11558
- Replay: fixed 95; newlyWrong 78; changed 208; unchanged 9970; unjudged 35; set HVH48 auditor C PLO6 seed 42; scorer 17902e71ecf; source plo6 verdict-only; arm on vs off; replayed 11558 of 11558

The run (2026-11-20, coordinator session 01UxDLnH, on the operations Mac). The engine and the scorer are the same checkout, commit 17902e71ecf (PR #11533). The harness is a copy of the auditor's `hvhC_replay.ts` (`HorseComplaintReplay.stateAt` + `HorseLogic.decide`, the live cash profile, opponent memory off), run once per seed and twice per node: arm off is the audit day's switch set (`switch.json` of the audit, 61 rows) with `plo6FacingBetIsPriced` off, arm on the same set with it on. Both sets are declared on the replay's meta line and today's registry accepts them. The seven style options of that set (`styleFoldBluff` and six more) belong to the separate style switch, not the option registry, so they cannot be declared; the harness hands them to the brain as the audit day held them (on) and reports them under `sanitized`. The copy keeps only voluntary actions in `actionHistory` (the open `stateAt` defect copies the forced posts in); a check run at seed 1 with the posts kept moves the base reproduction by 2 nodes and the on arm by 1 change (93 fixed, 81 newly wrong), so the defect does not decide this result. `refusal` is `horseDecisionReceiptRefusal` on the decision's own request under its own option flags; `legal` is the action against the node's legal actions and raise bounds.

Reproduction. 1,380 of the 11,558 decisions cannot be replayed: they are the audit's `unpriced` rows, whose hole cards the audit did not keep (counted as errors, never judged). Of the other 10,178 the base arm reproduces the recorded action on 7,614 / 7,655 / 7,651 (seeds 1 / 7 / 42; 74.8 to 75.2%): postflop 4,389 / 4,462 / 4,455 of 5,116 (85.8 to 87.2%), preflop 3,225 / 3,193 / 3,196 of 5,062 (the live VPIP-floor state and opponent memory are not in the recorded node, as the auditor found). Of the 142 decisions in the final csv flagged `POTODDS-FOLD` or `ALLIN-FOLD-PRICED` at `CLEAR` or `LIKELY`, 135 / 136 / 135 reproduce the fold and 80 of those flip with the option on at each seed (73 to the call, 7 to all-in).

Receipt split of the on arm (changed, fixed, newly wrong; seeds 1 / 7 / 42): `plo6_facing_bet_priced_called` 144/45/68, 142/45/70, 134/45/63; `plo6_facing_bet_priced_river_nut_rule_not_run` 61/47/8, 63/47/8, 64/47/9; `plo6_facing_bet_priced_paired_fold_priced_out` 16/11/4 on every seed; `plo6_facing_bet_priced_paired_river_bet_kept` 10/8/1, 11/9/1, 14/10/3; `plo6_facing_bet_priced_raise_to_call` 5/1/3; `plo6_facing_bet_priced_raised` 4/3/1; `plo6_facing_bet_priced_folded` 4/1/1; `plo6_facing_bet_priced_paired_river_check_priced` 0. No change is illegal or refused. The newly wrong count sits almost entirely in flop and turn folds made calls (`plo6_facing_bet_priced_called`): the scorer is verdict-only, so a change away from a decision the auditor priced and found no mistake in counts newly wrong, which matches the regression probe above (52 of 94 unflagged folds made calls had negative call EV under the auditor's pricing). The river (`river_nut_rule_not_run`) is 47 fixed against 8 or 9 newly wrong. Raw outputs (no card): `/Volumes/SmarterWork/agent-work/shared-capacity/coord-plo6-replay-01UxDLnH/` (`score-seed*.out`, `score-seed*.json`, the replay files and the harness `plo6_arm_replay.ts`).

How the row is produced (run from server/ on the operations Mac; `C` is `/Volumes/SmarterWork/agent-work/shared-capacity/hvh48-audit-01TLQer7J/C`, the audit's decisions.csv, meta.jsonl and hands.jsonl; the layout and the verdict mapping are in README.md, "The PLO6 audit set").

1. `npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-meta $C/meta.jsonl --plo6-hands $C/hands.jsonl --emit-nodes plo6-nodes.jsonl`
2. The auditor's harness (`hvhC_replay.ts`) re-decides every emitted node (it finds the action by `hand` and `actionIndex`) with the production switch set of the audit day and writes, per seed, one file: a first line `{"meta": {"arms": {"off": {"options": {..., "plo6FacingBetIsPriced": "off"}}, "on": {"options": {..., "plo6FacingBetIsPriced": "on"}}}}}` and one line per node `{"hand", "seat", "street", "k", "arms": {"off": {"action", "amount", "receipts"}, "on": {...}}}`.
3. Per seed (1, 7, 42): `npx tsx scripts/audited-decision-replay.ts --plo6 $C/decisions.csv --plo6-meta $C/meta.jsonl --plo6-hands $C/hands.jsonl --replay plo6-replay-seed1.jsonl --line on --row on --set "HVH48 auditor C PLO6 seed 1"`, and the printed `- Replay:` row is copied here unedited.
