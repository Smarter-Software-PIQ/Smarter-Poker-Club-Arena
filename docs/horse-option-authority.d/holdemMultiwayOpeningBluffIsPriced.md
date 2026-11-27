# holdemMultiwayOpeningBluffIsPriced: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). Evidence NOT MET: the real-hand replay does not clearly fix more than it breaks once each opponent's own record is read (3 fixed / 3 newly wrong, and 19 more decisions changed to the audit's kind of action, a bet, at a size outside its tolerance: the option bets bigger than the audit's best size), and the committed audited-decision scorer was not run. The other bars pass: league mirror 6-max +1.49 ± 0.90, +3.58 ± 0.93 and +1.20 ± 0.47 bb/100 per seat on three seeds (100,000 hands; pooled about +1.7 ± 0.4), 3-handed +0.66 ± 0.52; no exploit probe is a significant loss with opponent memory on or off (always-caller -0.99 ± 2.19 and +2.19 ± 2.50, trapper -0.25 ± 1.77 and +0.47 ± 2.02; 3-handed, low power); decide p95 at most 4.1 ms and max 7.0 ms over 2,405 applicable spots. On the daily audit's 19 multiway missed bluffs against a person it bets 12 (10 with no opponent memory). Lane grade: a live shadow trial only, not on.

## What It Does

On the turn or the river, against two or more opponents, when nobody has bet the street: the brain's check becomes a bluff at the legal priced size of highest EV only when the hand has no value size at all (a hand that has one belongs to holdemMultiwayOpeningValueBetIsPriced, bet or not), the bluff prices above the check against the FIELD, AND either the Horse's cards remove more of the field's calling parts than of its folding parts (the joint fold given the Horse's hand above the joint fold read without it: blocker dependent) or the Horse's public line range outscores EVERY opponent's on this board (range advantage over the field, the lowest pairwise advantage above one half). With no record a pure bluff breaks even by construction, so it is the blockers, the hand's own equity when called (a draw), or the opponents' own over-folding records that make it pay; it never bluffs by a draw of a random number.

Built for the daily NLH cash hand audit of 2026-11-26 (root-cause report E): 19 of its 31 missed profitable turn and river bluffs against a person, 182 of 265 bb, are multiway, where `holdemOpeningBluffIsPriced` is silent (heads-up only).

Receipts: `holdem_multiway_opening_bluff_bet`, `holdem_multiway_opening_bluff_no_edge` (priced above the check, but neither blockers nor the range advantage were the Horse's: the check stands), `holdem_multiway_opening_unpriced`.

Default OFF in source (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`, read `=== true`), registered in the option switch, switchable live; scoped to NLH cash tables and Lightning.

## How It Prices

Scope: no-limit hold'em cash, table and Lightning (never tournaments, Short Deck, fixed limit, bomb pots, all-in-or-fold tables, run-it-twice boards), one board, the turn or the river, two to six opponents still in the hand, nobody has bet the street, nobody is all in, and the brain's answer is a check. The hook sits in the reference node right after `holdemOpeningPriced` (`HorseLogic.holdemMultiwayOpeningPriced`); later graph nodes still apply. The math is `server/src/engine/HorseHoldemMultiwayOpeningIsPriced.ts`:

- Each opponent's range: his public line range (the hvc line model, `HorseLogic.holdemPricedLineRead`), read once WITHOUT the Horse's cards (he cannot see them); the Horse's two cards then only remove the combinations that hold them.
- The field's fold to a bet B into pot P. Every opponent must fold for a bluff to win. The minimum defence is shared across the field: at equilibrium the field as a whole lets a bet through B / (B + P) of the time (the bettor's break-even), so each of N opponents folds its N-th root. With `foldRef_i = (his folds + 20 x 0.337) / (his opportunities + 20)` (on the river his river response record, else his fold to a bet: the same counters as the heads-up option) and `m_i = foldRef_i / 0.337`, his fold is `f_i = (m_i x B / (B + P))^(1/N)` (m_i x price capped at 0.95). The joint fold is `B / (B + P)` times the GEOMETRIC MEAN of the m_i: one over-folder among three moves it by the cube root of his ratio. It is never a product of N heads-up fold rates, and never a product of N measured over-folds.
- Who folds: the weakest f_i of each range read without the Horse's cards (a strength cutoff). With the Horse's cards removed the share under the cutoff is his fold given the Horse's hand (f'\_i); the rest is his calling part.
- EV(bet) = F' P + the sum over every non-empty set S of callers of P(S) (r e_S (P + B_S + their calls) - B_S). F' is the product of the f'\_i; P(S) the product of (1 - f'\_i) inside S and f'\_i outside; e_S the chance the Horse's hand beats EVERY caller's calling part (the share of the joint calling range the hand beats). On the turn e_S is averaged over river cards with the product taken per river card, because the river card is shared (every unseen card, or an evenly spaced part of them under a fixed score budget of 24,000 hand scores, never fewer than 10 cards). EV(check) = r e_all P. r = 1 on the river or when the Horse acts last, else 0.88 (`HOLDEM_PRICED_REALIZATION_OOP`, the hvc constant; a stated limit).
- A value size: the chips the callers add are won on balance, the sum of P(S) (e_S x their calls - (1 - e_S) B_S) above zero (heads-up this is equity against the calling part above one half).
- Sizes: the legal priced bet sizes of the hvc module (1/3, 1/2, 3/4, pot, and all in within 1.5 pots) against the deepest opponent, legalized by the engine; the size of highest EV is taken. No random draw anywhere; the same state gives the same answer on every seed.

## Prior anchor

- Baseline: with no record each opponent's fold at the reference price is 0.337 and the FIELD's joint fold to any bet equals the bettor's break-even price B / (B + P) (the equilibrium minimum defence, shared across the field: each of N opponents folds its N-th root). A pure bluff with no blockers is worth exactly nothing; each opponent's bet share when checked to (line shape only) is anchored at one half.
- Population weight: zero. No population rate of any kind is read (not the Horse field, not people); each opponent's anchor carries 20 pseudo-opportunities and nothing else.
- Own record: each opponent's own decayed counters (river response record on the river, fold to a bet otherwise) dominate his own ratio as they grow, weight n / (n + 20); the joint fold moves by the geometric mean of the ratios. With the mind off or no counters the anchor stands.
- No unshown cards: nothing was fitted; every range is read from public actions only and the only hole cards read are the deciding Horse's own.

## How To Trial It (Live Shadow Stage)

Staged in `HorseOptionShadowStage.OPTION_SHADOW_STAGE` (`holdemStage(['nlh_cash', 'nlh_lightning'], ['turn', 'river'])`): set the switch row to `shadow` (`node scripts/ops/horse-option-switch.mjs set holdemMultiwayOpeningBluffIsPriced shadow`), and read the per-direction watch with `node scripts/ops/horse-option-shadow-watch.mjs holdemMultiwayOpeningBluffIsPriced --since <ISO>` (from a check to a wager is the only direction this option takes). The acted decision is unchanged in shadow.

## Grades (chips), 2026-11-26

Harness scripts are in the lane's scratch folder (`plo-lead7-01TLQer8/build-flopraise-nlhmw/src`: `mirror-mw.mjs`, `probe-mw.mjs`, `latency-mw.mjs`, `score.py`; BUILD.md beside them), on this branch's source, with the production options of `docs/horse-option-switch-state.json` (asOf 2026-11-26T08:05Z, 74 decide options) in both arms and the option added in ON. No database; jobs niced, one at a time. The mirror harness prints chips per 100 hands (the big blind is 2 chips): the bb/100 column is that number halved, both are shown.

League mirror (every seat a Horse on the hybrid cash profile; each deal played twice with the ON and OFF seats swapped; one memory sandbox per pass; ± standard error). Heads-up the option is silent by scope, so the cards are 3-handed and 6-max:

| table           | seed | deals (hands)   | ON - OFF bb/100 per seat | harness print (chips/100) | fires                              |
| --------------- | ---- | --------------- | ------------------------ | ------------------------- | ---------------------------------- |
| 6-max 100 bb    | 3303 | 10,000 (20,000) | +1.49 ± 0.90             | +2.97 ± 1.79              | bluff_bet 434, bluff_no_edge 480   |
| 3-handed 100 bb | 3303 | 10,000 (20,000) | +0.66 ± 0.52             | +1.31 ± 1.04              | bluff_bet 108, bluff_no_edge 215   |
| 6-max 100 bb    | 5505 | 10,000 (20,000) | +3.58 ± 0.93             | +7.15 ± 1.85              | bluff_bet 481, bluff_no_edge 557   |
| 6-max 100 bb    | 4404 | 30,000 (60,000) | +1.20 ± 0.47             | +2.39 ± 0.94              | bluff_bet 1289, bluff_no_edge 1457 |

Exploit probes (3-handed, 100 bb, 8,000 pairs per arm on the same deals; the script in seat 0, the two Horses with the option ON in one arm and OFF in the other; the script is the production Horse with the options OFF except: caller never folds to a postflop bet; over-folder folds every turn and river bet unless its equity against a random hand is at least 0.8; mdf calls every turn and river bet its equity is above the price of, and folds the rest; trapper, the one a multiway opening bet fears, checks its hands of equity 0.8+ on the turn and river and raises the pot when bet into). 3-handed the option acts in few hands (the last column), so these probes have little power:

| probe      | memory | Horses OFF bb/100 | Horses ON bb/100 | ON - OFF (hand by hand) | hands that differ |
| ---------- | ------ | ----------------- | ---------------- | ----------------------- | ----------------- |
| caller     | on     | +432.21 ± 29.27   | +431.21 ± 29.23  | -0.99 ± 2.19            | 38 of 8,000       |
| overfolder | on     | +37.88 ± 12.27    | +39.83 ± 12.25   | +1.95 ± 1.58            | 27 of 8,000       |
| mdf        | on     | +100.08 ± 18.19   | +101.63 ± 18.32  | +1.55 ± 2.52            | 75 of 8,000       |
| trapper    | on     | +35.35 ± 14.99    | +35.11 ± 15.13   | -0.25 ± 1.77            | 32 of 8,000       |

| probe      | memory | Horses OFF bb/100 | Horses ON bb/100 | ON - OFF (hand by hand) | hands that differ |
| ---------- | ------ | ----------------- | ---------------- | ----------------------- | ----------------- |
| caller     | OFF    | +265.32 ± 22.49   | +267.52 ± 22.60  | +2.19 ± 2.50            | 82 of 8,000       |
| overfolder | OFF    | +23.32 ± 11.40    | +26.38 ± 11.31   | +3.06 ± 1.47            | 28 of 8,000       |
| mdf        | OFF    | +103.34 ± 17.42   | +102.54 ± 17.48  | -0.80 ± 1.21            | 55 of 8,000       |
| trapper    | OFF    | +47.06 ± 14.69    | +47.53 ± 14.74   | +0.47 ± 2.02            | 36 of 8,000       |

Real-hand audit replay. Set: every exact-tier (the deciding Horse's own cards known) turn or river decision with two or more opponents and nothing to call, of three NLH cash audits against people: 2026-11-20..24 (56 rows), the daily of 2026-11-25 and the daily of 2026-11-26 13:33Z (49 rows; its 19 multiway missed bluffs against a person, 181.6 bb, are in it); 112 decisions in 44 hands after removing rows the two dailies share (hands pulled read-only with `complaint-extract.sql`, which returns no person's cards). Each decision re-decided at its recorded public snapshot, live hybrid cash profile, live switch rows of 2026-11-26 14:55Z, seeds 1/7/42, harness `audit-rootcause/src/replay.mts`. Scored with the heads-up option's rule (`score.py` = `rc.mjs`): fixed = the option-off replay is not the audit's best action and the option-on replay is (kind, and a bet within max(1 bb, 15% of the pot) of the audit's best size; for a decision the audit judged correct, the recorded action); newly wrong the reverse.

| opponent memory                                 | fixed | newly wrong | right kind (a bet), size outside the tolerance | unchanged | of  | fixed rows' recorded cost |
| ----------------------------------------------- | ----- | ----------- | ---------------------------------------------- | --------- | --- | ------------------------- |
| OFF (every opponent at the anchor)              | 11    | 2           | 11                                             | 88        | 112 | 73.6 bb                   |
| as of each decision                             | 3     | 3           | 19                                             | 87        | 112 | 14.5 bb                   |
| OFF, rows against a person only                 | 5     | 0           | 9                                              | 46        | 60  | 48.7 bb                   |
| as of each decision, rows against a person only | 2     | 0           | 13                                             | 45        | 60  | 9.5 bb                    |

(The base replay reproduces the recorded action kind in 94 of 112 with memory off and 97 with memory as of the decision. Memory as of each decision: every retained hand with a person settled before it learned into a private sandbox, history `chooser/hist`, public columns only, to 2026-11-26 01:17Z.)

The daily audit's 19 multiway missed profitable bluffs against a person (181.6 bb of recorded cost): with memory as of the decision the option bets 12 of them (92.7 bb of that cost), finds no blocker or range edge on 3 and is silent on 4; with memory off it bets 10 (84.1 bb). The bet is within the audit's size tolerance on 2 of the 12 (4 of the 10): the audit's best size is mostly about a third of the pot, the option's is mostly the pot. Why: with each opponent's fold proportional to the price he is laid, a bluff's EV grows with its size whenever the field folds more than the break-even, so the biggest priced size wins; the audit prices people's measured folds, which rise more slowly with the size. Which of the two is right about size is NOT settled by this replay (the scorer counts only the audit's size as right), and the league cannot settle it against people. This is the reason for Evidence NOT MET.

The 3 newly wrong rows with memory are all Horse-against-Horse turn decisions (two checks the audit judged correct that become bets, and one decision the base already bets on some seeds, where the option's bet on the other seeds is past the size tolerance). Horse strengths: the option only ever changes a check with nothing to call on the turn or river against two or more opponents; the audits' river bets, value bets already made and every facing-bet decision are untouched by construction (0 changed).

## Speed

Per-decision cost of HorseLogic.decide where the option applies (`latency2-mw.mjs`: league hands, every seat playing the production Horse; every turn or river spot with three or more players in, nothing bet and the production decision a check; OFF and ON each timed twice on the same state and the faster kept; the engine's own decide call run by tsx on this source, not the bundled build; the first 50 spots dropped as warm-up; run while the lane's league jobs were running, so the numbers are not flattered). The stage bar is p95 <= 10 ms and max <= 25 ms, nothing over 50 ms:

| table    | stacks | spots (3 / 4 / 5+ players in) | decisions the option changed | ON p50 / p95 / p99 / max ms | OFF p50 / p95 / max ms | added p50 / p95 / max ms | over 50 ms |
| -------- | ------ | ----------------------------- | ---------------------------- | --------------------------- | ---------------------- | ------------------------ | ---------- |
| 6-handed | 100 bb | 605 (448 / 106 / 51)          | 213                          | 2.52 / 3.38 / 3.78 / 4.36   | 1.43 / 1.83 / 2.25     | 1.07 / 1.75 / 2.41       | 0          |
| 6-handed | 300 bb | 600 (412 / 155 / 33)          | 216                          | 1.34 / 1.97 / 2.38 / 3.96   | 0.3 / 0.45 / 2.68      | 1.03 / 1.61 / 2.08       | 0          |
| 9-handed | 200 bb | 600 (402 / 175 / 23)          | 193                          | 2.86 / 3.68 / 4.02 / 5.03   | 1.71 / 2.14 / 2.46     | 1.09 / 1.76 / 2.72       | 0          |
| 3-handed | 100 bb | 600 (600 / 0 / 0)             | 194                          | 3.19 / 4.07 / 4.44 / 7      | 1.91 / 2.34 / 3.37     | 1.23 / 1.92 / 4.21       | 0          |

Relative-cost law `aHoldemMultiwayOpeningPriceIsFast`: the audited nodes with the option on cost about 1.9x the same decisions off (limit 12); the pricing alone against six whole ranges on the turn 2.6 ms, about 3.1x the same against two (limit 8).

## With No Opponent Record (The Equilibrium-Anchored Case)

With no record the field's joint fold to a bet B into pot P is B / (B + P), so a pure bluff is worth exactly zero and the option bets only where the Horse's cards block the field's calling parts or the hand has equity when called. The memory-OFF probe rows above are that case.

Unlike the heads-up option (which bleeds -10.5 ± 3.7 to an always-caller with no record), the multiway memory-OFF probes show no loss: always-caller +2.19 ± 2.50, over-folder +3.06 ± 1.47, mdf -0.80 ± 1.21, trapper +0.47 ± 2.02 (bb/100, 3-handed, 28 to 82 hands of 8,000 differ, so the power is low). The league numbers are against today's Horses, the field the prior must not be anchored to: it may go to a shadow trial; it does not go on from league numbers alone.

## Limits

- Size: the bet is the priced size of highest EV, usually the pot; the audits' best size is usually smaller. Not settled (see the replay).
- Each opponent's record is his pooled fold-to-bet counter (and river response record), the same counters the heads-up option reads. It is not split heads-up / multiway, by line or by size: no such per-opponent hold'em counter exists. A player's multiway folds are part of it, which the shared anchor (N-th root) and the geometric mean dampen but do not remove.
- Raises by the field are not priced (a bet prices fold or call only), and neither is a bet behind the Horse's check: the check's value is its showdown value.
- Side pots are priced as one pot; the Horse's risk against a set of callers is what the deepest of them covers.
- The opponents are treated as independent given the shared anchor, apart from the river card they share on the turn.
- The realization factor when not last to act on the turn (0.88) is the hvc module's constant.
- 3-handed probes have little power (the option acts in under 1% of hands there). No 6-handed probe was run.
- Cash only; two to six opponents; nobody all in.
- Speed was measured with tsx on the source, not on the bundled build.

## Replay

- Replay: NOT RUN (the committed scorer has no adapter for the daily NLH cash audit decisions.csv; the lane harness replay.mts with score.py is recorded in Grades)
