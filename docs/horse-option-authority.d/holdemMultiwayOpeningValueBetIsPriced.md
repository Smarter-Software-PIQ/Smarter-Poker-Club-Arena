# holdemMultiwayOpeningValueBetIsPriced: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). Evidence NOT MET: the real-hand replay breaks more than it fixes (0 fixed / 4 newly wrong with each opponent's record read; 2 fixed / 5 newly wrong with no memory), the league mirror shows no gain (6-max -0.37 ± 0.54 and +0.21 ± 0.22 bb/100 per seat over 20,000 and 60,000 hands; it acts in about 4 hands in 1,000), and the committed audited-decision scorer was not run. It does not show the heads-up value option's league loss; it shows nothing either way. NOT READY: stays OFF, not a shadow candidate on this evidence.

## What It Does

On the turn or the river, against two or more opponents, when nobody has bet the street: the brain's check becomes a value bet at the legal priced size of highest EV when the chips the callers add are won on balance (over every set of callers, the chance the hand beats every caller's calling part: the share of the joint calling range the hand beats) and the bet prices above the check.

Receipts: `holdem_multiway_opening_value_bet`, `holdem_multiway_opening_unpriced`.

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

Staged in `HorseOptionShadowStage.OPTION_SHADOW_STAGE` (`holdemStage(['nlh_cash', 'nlh_lightning'], ['turn', 'river'])`): set the switch row to `shadow` (`node scripts/ops/horse-option-switch.mjs set holdemMultiwayOpeningValueBetIsPriced shadow`), and read the per-direction watch with `node scripts/ops/horse-option-shadow-watch.mjs holdemMultiwayOpeningValueBetIsPriced --since <ISO>` (from a check to a wager is the only direction this option takes). The acted decision is unchanged in shadow.

## Grades (chips), 2026-11-26

Harness scripts are in the lane's scratch folder (`plo-lead7-01TLQer8/build-flopraise-nlhmw/src`: `mirror-mw.mjs`, `probe-mw.mjs`, `latency-mw.mjs`, `score.py`; BUILD.md beside them), on this branch's source, with the production options of `docs/horse-option-switch-state.json` (asOf 2026-11-26T08:05Z, 74 decide options) in both arms and the option added in ON. No database; jobs niced, one at a time. The mirror harness prints chips per 100 hands (the big blind is 2 chips): the bb/100 column is that number halved, both are shown.

League mirror (as for holdemMultiwayOpeningBluffIsPriced):

| table           | seed | deals (hands)   | ON - OFF bb/100 per seat | harness print (chips/100) | fires         |
| --------------- | ---- | --------------- | ------------------------ | ------------------------- | ------------- |
| 6-max 100 bb    | 3303 | 10,000 (20,000) | -0.37 ± 0.54             | -0.74 ± 1.08              | value_bet 73  |
| 3-handed 100 bb | 3303 | 10,000 (20,000) | +0.15 ± 0.38             | +0.31 ± 0.76              | value_bet 30  |
| 6-max 100 bb    | 4404 | 30,000 (60,000) | +0.21 ± 0.22             | +0.42 ± 0.44              | value_bet 225 |

Both options together:

| table                             | seed | deals (hands)   | ON - OFF bb/100 per seat | harness print (chips/100) | fires                                          |
| --------------------------------- | ---- | --------------- | ------------------------ | ------------------------- | ---------------------------------------------- |
| heads-up 100 bb (silent by scope) | 3303 | 2,000 (4,000)   | +0.00 ± 0.00             | +0.00 ± 0.00              | none                                           |
| 6-max 100 bb                      | 5505 | 10,000 (20,000) | +3.61 ± 0.96             | +7.22 ± 1.92              | bluff_bet 473, bluff_no_edge 552, value_bet 45 |

Exploit probes (as for holdemMultiwayOpeningBluffIsPriced):

| probe      | memory | Horses OFF bb/100 | Horses ON bb/100 | ON - OFF (hand by hand) | hands that differ |
| ---------- | ------ | ----------------- | ---------------- | ----------------------- | ----------------- |
| caller     | on     | +432.21 ± 29.27   | +435.51 ± 29.29  | +3.30 ± 1.62            | 18 of 8,000       |
| overfolder | on     | +37.88 ± 12.27    | +37.60 ± 12.27   | -0.29 ± 0.29            | 1 of 8,000        |
| mdf        | on     | +100.08 ± 18.19   | +100.84 ± 18.20  | +0.76 ± 1.22            | 15 of 8,000       |
| trapper    | on     | +35.35 ± 14.99    | +34.86 ± 14.99   | -0.49 ± 0.52            | 5 of 8,000        |

| probe   | memory | Horses OFF bb/100 | Horses ON bb/100 | ON - OFF (hand by hand) | hands that differ |
| ------- | ------ | ----------------- | ---------------- | ----------------------- | ----------------- |
| caller  | OFF    | +265.32 ± 22.49   | +267.76 ± 22.49  | +2.44 ± 1.20            | 31 of 8,000       |
| trapper | OFF    | +47.06 ± 14.69    | +47.14 ± 14.70   | +0.09 ± 1.32            | 15 of 8,000       |

Real-hand audit replay. Set: every exact-tier (the deciding Horse's own cards known) turn or river decision with two or more opponents and nothing to call, of three NLH cash audits against people: 2026-11-20..24 (56 rows), the daily of 2026-11-25 and the daily of 2026-11-26 13:33Z (49 rows; its 19 multiway missed bluffs against a person, 181.6 bb, are in it); 112 decisions in 44 hands after removing rows the two dailies share (hands pulled read-only with `complaint-extract.sql`, which returns no person's cards). Each decision re-decided at its recorded public snapshot, live hybrid cash profile, live switch rows of 2026-11-26 14:55Z, seeds 1/7/42, harness `audit-rootcause/src/replay.mts`. Scored with the heads-up option's rule (`score.py` = `rc.mjs`): fixed = the option-off replay is not the audit's best action and the option-on replay is (kind, and a bet within max(1 bb, 15% of the pot) of the audit's best size; for a decision the audit judged correct, the recorded action); newly wrong the reverse.

| opponent memory     | fixed | newly wrong | right kind, size outside the tolerance | changed ok to ok | unchanged | of  |
| ------------------- | ----- | ----------- | -------------------------------------- | ---------------- | --------- | --- |
| OFF                 | 2     | 5           | 2                                      | 2                | 101       | 112 |
| as of each decision | 0     | 4           | 1                                      | 0                | 107       | 112 |

The newly wrong rows are checks the audit judged correct that become bets (top pair on a four-card board against two opponents, a river straight on a four-straight board): the audit, which sees the shown cards, keeps the check. FAILS the replay bar.

## Speed

Measured as for holdemMultiwayOpeningBluffIsPriced:

| table    | stacks | spots (3 / 4 / 5+ players in) | decisions the option changed | ON p50 / p95 / p99 / max ms | OFF p50 / p95 / max ms | added p50 / p95 / max ms | over 50 ms |
| -------- | ------ | ----------------------------- | ---------------------------- | --------------------------- | ---------------------- | ------------------------ | ---------- |
| 6-handed | 100 bb | 605 (448 / 106 / 51)          | 28                           | 2.29 / 2.93 / 3.32 / 3.66   | 1.45 / 1.88 / 2.23     | 0.79 / 1.27 / 1.75       | 0          |
| 6-handed | 300 bb | 600 (412 / 155 / 33)          | 27                           | 1.07 / 1.52 / 1.9 / 4.5     | 0.3 / 0.47 / 2.48      | 0.78 / 1.14 / 2.02       | 0          |
| 9-handed | 200 bb | 600 (402 / 175 / 23)          | 24                           | 2.55 / 3.26 / 3.55 / 4.1    | 1.69 / 2.12 / 3.45     | 0.83 / 1.34 / 1.83       | 0          |
| 3-handed | 100 bb | 600 (600 / 0 / 0)             | 49                           | 2.82 / 3.45 / 3.76 / 5.58   | 1.9 / 2.39 / 2.86      | 0.84 / 1.32 / 3.09       | 0          |

## Does It Fail The Way holdemOpeningValueBetIsPriced Did?

The heads-up value option failed its league grade because the opposing Horse raises the new value bets and the EV prices fold or call only (-12.4 ± 4.8 in the harness's print, -6.2 ± 2.4 bb/100). The multiway option has the same structural gap (raises are not priced). It does NOT show the same loss: 6-max -0.37 ± 0.54 bb/100 per seat over 20,000 hands (73 fires) and +0.21 ± 0.22 over 60,000 hands (225 fires), 3-handed +0.16 ± 0.38. It fires in about 4 hands in 1,000, because the brain already bets most multiway value hands, so its effect cannot be told from zero either way. It was not isolated whether the few bets it adds are raised more than they are paid. What fails is the real-hand replay.

## Limits

- It adds few bets and its measured effect is nil; the replay says the bets it adds are more often wrong than right by the audits.
- Raises by the field are not priced; side pots are priced as one pot.
- Each opponent's record is his pooled fold-to-bet counter; not split heads-up / multiway, by line or by size.
- Cash only; turn and river only; two to six opponents; nobody all in.

## Replay

- Replay: NOT RUN (the committed scorer has no adapter for the daily NLH cash audit decisions.csv; the lane harness replay.mts with score.py is recorded in Grades)
