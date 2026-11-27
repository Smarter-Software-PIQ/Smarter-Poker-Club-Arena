# omahaReraisedPotFoldReraiseIsPriced: authority for the live switch

Built 2026-11-27 by PLO-OWNER lead-8 lane preflop. **Evidence NOT MET**: the option stays OFF. Its pre-registered chips bars (league mirror and scripted probes, six-max, read against a same-seed no-op run) are met and the option is inert heads-up; the audited-decision replay does not support it (0 fixed, 0 newly wrong: the audit's own best action at the decisions it changes is the out-of-position call the owner rules out), its chips grades are league self-play and scripted probes, and it has not been shadowed against people. Default off (read `=== true`), switchable live, PLO4/PLO5 cash only. This file does not authorize switching it on.

## The owner's rulings it prices

- "Calling 3-bets and 4-bets out of position is a losing play." The option never makes a call.
- No blanket rules: every threshold is a price. The answer to a 3-bet is priced on this hand, this 3-bettor's own record, the pot and the stacks.
- 2026-11-26 12:21 America/Chicago: "The stats need to be used against human players, not horses." The priors are people-only.

## What was measured (public actions, people only)

PLO4/PLO5 cash hands with a person and a Horse, 2026-11-19 23:00Z to 2026-11-27 05:00Z (PLO5 6,003 hands, PLO4 1,992; `S7/l8-preflop/stats.md`).

| people                                                | PLO5                       | PLO4                      |
| ----------------------------------------------------- | -------------------------- | ------------------------- |
| 3-bet facing an open                                  | 42.9% (2,843)              | 7.3% (953)                |
| the opener's answer to a 3-bet: fold / call / 4-bet   | 0.0% / 68.4% / 31.6% (786) | 2.1% / 85.1% / 12.8% (47) |
| the 3-bettor's answer to a 4-bet: fold / call / 5-bet | 0.0% / 72.5% / 27.5% (265) | 8.3% / 58.3% / 33.3% (12) |

The 3-bet rate is the person's, not the population's: 15 person-game cells with 30 or more opportunities run from 0% to 53% (two players re-raise half the opens they face; most others under 10%). Nobody folds to a 4-bet: 9 persons, 277 answers, one fold.

The Horses, same hands, as the opener facing a PERSON's 3-bet in PLO5: out of position fold 72.1% / call 15.8% / 4-bet 12.1% (495 decisions); in position fold 9.8% / call 62.6% / 4-bet 27.5% (712).

## The gap

Every re-raised-pot rule priced a standing fold against the CALL only (`HorseOmahaReraisedPotPricedRule`: a fold never met the re-raise). Out of position the call is priced out by the measured realization, so the fold stood without the 4-bet being asked. Of the 494 real out-of-position folds to a 3-bet (PLO5, seven days), 345 were heads-up against the 3-bettor; with his record as of the decision the option's own price (`HorseOmahaReraisedPotPriced`, the people prior, the bar below) clears at 139 of them, by 6.2 big blinds on average (PLO4: 3 of 46). That figure is the model's, not chips.

## What it does

PLO4/PLO5 cash, preflop, the Horse having made the first raise of the hand and facing exactly a cold 3-bet of it (the 3-bettor's first voluntary action: a limp-re-raise is a far stronger range than his 3-bet rate describes, and is not priced), out of position against the 3-bettor on the later streets, heads-up against him (no other live player: with a caller in or a player to act the called pot is not the two-range pot the verdict prices), the pot-size re-raise or the all-in it amounts to being legal:

the standing FOLD becomes that re-raise when EV(re-raise) > max(EV(call), 0) + deadband + the sampling error of the price,

with EV(re-raise) = F x pot + (1 - F) x [R_aggressor x equity against the top (1 - F) of his range x called pot - risk] from the existing verdict (`reraisedPotVerdict`: the same equity sampler and the same measured realization as `omahaReraisedPotCallIsPriced`), his range width = 0.9 x his 3-bet rate and F = his fold to a 4-bet, each read from HIS OWN public record and then the people prior (`RERAISED_POT_PEOPLE_PRIOR`). The sampling error is 0.5 / sqrt(360) of the called pot on the called branch (`reraisedPotFoldReraiseSamplingMargin`): the equity is a 360-draw sample and a re-raise risks many times what a call does on it.

It never makes a call; it changes no standing call or re-raise; in position (where the fold is already weighed against the call by the live `omahaPreflopReraiseDefencePricedInPosition`, and where the realization fit credits an aggressor with more than his equity on far stronger ranges), multiway and facing a 4-bet or more (people's answers to a 5-bet are 15: too thin to price a stack on) it does nothing. When it does not re-raise, the fold goes on to `omahaReraisedPotCallIsPriced` exactly as before, if that option is on.

Off (unset, false, a truthy non-boolean): every decision is byte for byte the one it was. The sibling options keep their own prior: the people prior is a parameter that defaults off.

## Prior anchor

- Baseline: the people-only person-level rates: a 3-bet rate of 0.156 (the mean over 15 person-game cells) and a fold to a 4-bet of 0.028 (the mean over 9 persons; pooled 1 of 277). The equilibrium anchor (the indifference fold of the re-raise faced, `HorsePreflopIndifferenceAnchor.indifferenceFold`, 2/3 for a pot re-raise) is kept only for the thin 5-bet cell, which this option does not act on. The first build put that anchor beside the people's fold to a 4-bet and read an unknown 3-bettor as folding 27% of the time; it lost to a scripted tight 3-bettor and was withdrawn (below).
- Population weight: the people prior carries the mass of a beta fitted by moments to the spread between persons: 2.7 pseudo-opportunities for the 3-bet rate and 3.4 for the fold to a 4-bet. Small on purpose: people differ by a factor of fifty, so the prior must give way fast. No Horse play, no HUD population row and no self-play rate enters it.
- Own record: the 3-bettor's own decayed 3-bet record (`HorseMind.currentExploitCounters` threeBet / threeBetOpp) and his own answers to a 4-bet (`HorseMind.omahaReraiseResponseOf`) are added to those masses, so a dozen opportunities outweigh the prior four to one. The same formula for every opponent, a person or a Horse; no name, no person-versus-Horse fact.
- No unshown cards: the priors are counts of public actions. The verdict reads the deciding Horse's own cards, the public table state and the opponent's public record. The realization inside the verdict is the self-play fit of `omahaReraisedPotCallIsPriced` (every card there the engine's own simulated players').

## Grades

Harnesses: league mirror `S7/plo-postflop/src/grade.mts` (duplicate deals, ON seats against OFF seats swapped every pair, Hybrid cash Horses, production's live option set in both arms); probes `S7/l8-preflop/src/probe2.mts` (seat 0 scripted, the Horses all ON or all OFF on the same deals, the Horses' result against the scripted seat). 100 bb unless stated.

### The build that is here (fourth; its bars were written before it ran, `S7/l8-preflop/BUILD.md`)

Bars: every six-max card not below zero by more than 2 SE; the two 100 bb six-max mirrors pooled not below zero by more than 1 pooled SE. Heads-up cards are run to show the option does nothing there (heads-up the opener is in position).

Every card is ON minus OFF, then minus the same harness run with a no-op option on the same seed (both harnesses carry a deterministic null offset: the two worlds are not exact duplicates; for example the PLO5 heads-up mirror seed 20261127 gives -8.53 with a no-op and with this option alike). The SE is the card's own. "not run" = no no-op run (cards whose SE is far wider than any null seen, or heads-up cards that are not bars).

| card                                                                                  | hands / deals                            | raw ON minus OFF, bb/100 (SE)                                           | same-seed no-op | corrected         | bar             |
| ------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- | --------------- | ----------------- | --------------- |
| mirror PLO5 six-max 100 bb                                                            | 12,000                                   | +0.46 (0.70)                                                            | +0.03           | +0.43 (0.70)      | PASS            |
| mirror PLO4 six-max 100 bb                                                            | 12,000                                   | +0.45 (0.38)                                                            | +0.42           | +0.03 (0.38)      | PASS            |
| the two 100 bb six-max mirrors pooled (mean)                                          | 24,000                                   |                                                                         |                 | +0.23 (0.40)      | PASS (> -1 SE)  |
| mirror PLO5 six-max 300 bb                                                            | 12,000                                   | +2.06 (0.62)                                                            | +0.88           | +1.18 (0.62)      | PASS            |
| probe: tight 3-bettor (top 4%), PLO5 six-max                                          | 12,000                                   | -0.44 (1.53)                                                            | -0.23           | -0.22 (1.53)      | PASS            |
| probe: tight 3-bettor, PLO4 six-max                                                   | 12,000                                   | -1.92 (1.58)                                                            | -1.10           | -0.82 (1.58)      | PASS            |
| probe: caller, PLO5 six-max                                                           | 12,000                                   | -0.59 (4.64)                                                            | -0.59           | 0.00 (inert)      | PASS            |
| probe: caller, PLO4 six-max                                                           | 12,000                                   | -3.53 (2.85)                                                            | -3.53           | 0.00 (inert)      | PASS            |
| probe: wide 3-bettor who never folds a 4-bet, PLO5 six-max, seeds 11-14 pooled (mean) | 48,000                                   | +9.19 (14.60)                                                           | not run         |                   | PASS            |
| probe: wide 3-bettor who never folds a 4-bet, PLO4 six-max                            | 12,000                                   | +20.39 (28.51)                                                          | not run         |                   | PASS            |
| probe: wide 3-bettor who folds every 4-bet, PLO5 / PLO4 six-max                       | 12,000 each                              | +17.52 (20.41) / +3.30 (14.33)                                          | not run         |                   | PASS            |
| mirror PLO5 heads-up 100 bb, seeds 20261127 / 101 / 102                               | 4,000 / 12,000 / 12,000                  | -8.53 / -2.42 / -4.85                                                   | identical       | 0.00 each (inert) | inert check MET |
| mirror PLO5 heads-up seeds 103 / 104; PLO4 heads-up 20261127 / 101 / 102              | 12,000 / 12,000; 4,000 / 12,000 / 12,000 | -3.81 (2.94) / +0.02 (2.85); -1.43 (2.89) / -0.93 (1.71) / +0.40 (1.56) | not run         |                   | (null-level)    |

Heads-up inertness proven directly: 5,000 heads-up PLO5 hands with the option on one seat, both button parities: 0 fold -> 4-bet and 0 "kept" receipts (the rule is never reached: heads-up the opener is the button and in position); six-max the same counter shows 1 fired and 32 kept in 1,500 hands.

### The two builds before it (withdrawn)

| build                                                                                                             | card                                                                                                                                                           | ON minus OFF, bb/100 (SE)   |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1: fold to a 4-bet anchored to the indifference fold (an unknown 3-bettor read as folding 27%)                    | probe: tight 3-bettor (top 4%), PLO5 heads-up, 12,000 deals                                                                                                    | -15.3 (5.2)                 |
| 1                                                                                                                 | probe: tight 3-bettor, PLO5 six-max                                                                                                                            | -8.8 (6.6)                  |
| 1                                                                                                                 | probe: wide 3-bettor who never folds a 4-bet, PLO5 heads-up / six-max                                                                                          | +16.7 (14.4) / +19.6 (29.5) |
| 1                                                                                                                 | mirror PLO5 heads-up / six-max, 12,000 hands                                                                                                                   | -5.31 (4.69) / -1.16 (3.28) |
| 2: the people's fold to a 4-bet alone, the sampling error in the bar, only facing a 3-bet; in and out of position | probe: tight 3-bettor, PLO5 heads-up / six-max                                                                                                                 | -7.0 (3.9) / +0.5 (0.6)     |
| 2                                                                                                                 | mirror PLO5 heads-up / six-max, 12,000 hands                                                                                                                   | -4.34 (2.91) / +1.71 (0.72) |
| 3: out of position only (also matched a limp-re-raise)                                                            | its six-max bars passed (raw: mirror PLO5 +1.71 (0.72), PLO4 +0.45 (0.38)); its heads-up cards were later shown to be the harness's no-op null, not the option |                             |

Build 1 failed its tight probe (2.9 SE). Build 2's heads-up cards, which measure the in-position fold only, both leaned negative; the out-of-position restriction of build 3 was declared with its reasons before it was run.

### Real nodes

At the real nodes of 2026-11-19 to 11-27 where a Horse faced a 3-bet (2,199 decisions replayed with the opponent's record as of the decision, 3 seeds): the option changes 146 decisions (the third build 147; 152 before the cold-3-bet restriction), all out-of-position heads-up folds that become the pot 4-bet; on the third build: PLO5 against a person 145 of 286 folds, against a Horse 4 of 67; PLO4 against a person 2 of 18, against a Horse 1 of 26.

### Audited preflop decisions (cards shown)

`S7/plo-preflop/scripts/real.ts` and `grade_real.py` on the 991 audited tier-A preflop decisions facing a raise (PLO4/PLO5 cash, 2026-11-20 to 11-25), option off against on, 5 seeds: with the persons' reads imported 15 decisions change, 0 fixed, 0 newly wrong; with no read 3 change (fourth build; 4 on the third), 0 fixed, 0 newly wrong. All are out-of-position heads-up folds to a 3-bet that become the 4-bet, and at every one the audit's best action is the CALL; where the live Horse 4-bet those same hands, the audit priced the 4-bet 3 to 12 big blinds worse than the call. The audit's model prefers the out-of-position call the owner rules out, so it cannot confirm this option; it does not refute it either (it never prices the fold against the 4-bet).

### Cost

Engine's own decide where the option applies (its receipt fires), on the COMPILED build (tsc emit of 724294975926; `S7/l8-preflop/src/speed-frc.mts`), the real heads-up nodes where a Horse faced a 3-bet at their real stacks (100 to 200 bb tables) and at 3 and 8 times those stacks, machine load about 10: 1,302 applicable decisions (421 / 440 / 441), option on p50 1.97 / p95 2.91 / max 4.49 ms (0 over 25 ms, 0 over 50 ms); the same decisions off p50 0.24 / p95 1.07 / max 1.96 ms. Bar p95 <= 10 ms, max <= 25 ms: PASS. Relative-cost law in `anOmahaReraisedPotFoldReraiseIsPriced.law.test.ts` (on / sibling price ratio 2.29, bound 4).

### Flag-off

`bash scripts/ops/horse-flag-off-check.sh origin/main HEAD --scratch <dir> --set full`, base 7c301a85a5e4, head 724294975926 (the graded code; the later merge of main brings no engine change past that base): **0 differences in 28,000 decisions** (14,000 states x 2 seeds, every game group including PLO6 and tournaments), 0 errors.

## Receipts

`omaha_reraised_pot_priced_fold_reraised` (the fold became the pot re-raise), `omaha_reraised_pot_priced_fold_reraise_kept` (priced, the fold stood).

## Tests

`server/src/engine/anOmahaReraisedPotFoldReraiseIsPriced.law.test.ts` (every change is a fold that became the largest legal re-raise at a cleared price and never a call; the answer follows the 3-bettor's record; in position, multiway, facing a 4-bet and in a tournament nothing changes; off byte-identical; the people prior and the sampling margin; the validator's admission; the relative cost) and `anOmahaReraisedPotFoldReraiseIsPriced.realHands.law.test.ts` (eleven real out-of-position folds to a person's 3-bet, no user id, the deciding Horse's own cards only).

## Evidence rows

- Mechanism, scope, receipts, tests, off-identity, flag-off, cost: MET.
- Chips in self-play and against scripted opponents: see Grades; the bars declared for this build are MET (every six-max card corrected above -2 SE; the two 100 bb six-max mirrors pooled corrected +0.23 (0.40), above -1 SE; heads-up identical to a no-op).
- Audited decisions: NOT MET (0 fixed, 0 newly wrong).
- Against people: NOT MEASURED. The option exists because of two people's 3-bet width; only a live shadow can show how often it would act against them and what the 4-bets it makes return.

## What a shadow should show before any switch

`option_shadow_omahaReraisedPotFoldReraiseIsPriced_changed_seen` at about 20 a day in hands with a person (152 in seven days), every one a fold that became a raise, none a call; `omaha_reraised_pot_priced_fold_reraise_kept` on the rest; no re-decision over 25 ms.

## Limits

The realization inside the verdict is a self-play fit; an aggressor out of position at a stack-to-pot ratio near 1.3 is credited with about 0.97 of his equity, measured on 4-bet ranges stronger than a hand that was folded. The mirror and the probes play postflop as Horses do; a person who outplays a Horse postflop in a 4-bet pot is not in them. Side pots, a 5-bet behind and callers are not modelled (the option is heads-up only). The 3-bettor's record is the engine's decayed counter, about 17 opportunities deep: a tight 3-bettor who has just 3-bet twice reads wider than he is for a while.

## Replay

Machine-read (README.md, "The Replay row"); rows written by the scorer and copied unedited (`S7/run-aud2.sh`, harness `S7/l8-preflop/src/node-replay-l8fr.ts`).

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm FR vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2697; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm FR vs off; replayed 2697 of 2697

These two sets hold no preflop fold facing a 3-bet (0 changed); the preflop audit is the tier-A replay above.

## Rollback

Set `omahaReraisedPotFoldReraiseIsPriced` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('omahaReraisedPotFoldReraiseIsPriced', 'off', '<actor>', '<reason>')`): the base brain within about 30 seconds; no data migration.
