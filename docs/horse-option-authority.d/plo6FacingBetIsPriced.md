# plo6FacingBetIsPriced: authority for the live switch

Status: built, OFF, Evidence NOT MET (2026-11-19). Mechanism, scope, receipts, validator admission, law tests and off-identity are MET; the replay of the audit's flagged folds is stated below (96 of 164 reproduced fold mistakes flip to the call); the league card is declared and not yet dealt, and the scorer replay of 2026-11-20 on the PLO6 audit set (see Replay below) did not pass its declared bar. Nothing in this change switches anything.

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

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 93; newlyWrong 83; changed 212; unchanged 9966; unjudged 35; set HVH48 C PLO6 cash 11,558; scorer c4ab864f30f; source placed verdict-only; arm on vs off; replayed 10178 of 11558

Run 2026-11-20 by helper REPLAY-6 of the HORSE DECISIONS lane (session_01UxDLnMCzicBiaB19fA18T5). Criteria, inputs and pass bar were declared before the run: `agent-evidence/extreme-archive/horse-decisions-01UxDLnM/replay6/DECLARATION.md`, sha256 1ed85e274dd4b6fdff42c7f7b551b224c94290c770424cc2bbdc64f8e1383fbf; the scorer's reports are beside it (`runs/`, `REPORT.md`). Method: the HVH48 audit's decisions placed at their node (`server/scripts/hvh48-audit-nodes.py`; bad = severity CLEAR or LIKELY, ok = priced and not flagged, DEBATABLE and unpriced unjudged; a fix is a change to the action the audit names), each re-decided on origin/main 95dae3848e5 by `server/scripts/audited-node-option-replay.ts` (the recorded public snapshot, the Horse's own cards, the live hybrid profile, seeds 1, 7, 42, opponent memory off), arm off = the 63 production switch rows read 2026-11-20 21:12Z, the other arm = those rows plus this option; scored with `--placed`. Set C (PLO6 cash): 10,178 of 11,558 audited decisions replayed (the Horse's own cards known); the off arm reproduces the recorded action on 7,708 (75.7%); 212 changed (202 more aggressive, 10 more passive), 93 fixed, 83 newly wrong, 1 still wrong, 35 unjudged; illegal 0, refused 0, errors 0. Most frequent opponent (a person live at 143 of the changed decisions) removed: 69 changed, 37 fixed, 21 newly wrong. Against the declared bar (at least 20 changed, fixed at least twice newly wrong and at least 8, no illegal or refused action, base fidelity at least 70%, and the same ratio with the most frequent opponent removed): **FAIL: 212 changed, 93 fixed, 83 newly wrong.** The 93 fixed decisions carry 3,319.8 bb of the audit's loss. Of the 83 newly wrong, 77 are folds made calls where the audit priced the fold and did not flag it: by the audit's own figures the call is worth more than nothing in 24 of them (+37.8 bb together) and no more than nothing in 53. 143 of the 212 changes face one person; without that person 69 changed, 37 fixed, 21 newly wrong. Limits: opponent memory is off and seats are anonymised, so nothing that reads a per-opponent record acts; the tree is origin/main, not the serving build; the base arm is today's switch set, not the audit days'; the judge is the audit's verdict (no EV is claimed), and a change of a decision the audit priced and did not flag is counted newly wrong whether or not the audit would also accept the new action.
