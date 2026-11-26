# holdemTournamentTurnBluffIsPriced: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). Evidence NOT MET (the committed audited-decision scorer has no adapter for the tournament audit; the lane's grades are below). Lane grade: NOT READY. League mirror ON - OFF is positive on most tournament cards (heads-up +7.33 ± 2.75 bb/100 per seat), but it loses to the probe it fears most, a seat that raises the bets it faces (-4.55 ± 1.82 bb/100 with memory on, -8.90 ± 2.59 with memory off), and the real-hand tournament audit replay makes more new mistakes than it fixes (15 fixed, 24 newly wrong with opponent memory as of each decision; 3 fixed, 6 newly wrong without). Stays OFF; not tuned.

## What It Does

NLH tournaments (MTT, Sit & Go, Spin, heads-up), heads-up in the pot, on the turn, not facing a wager: the brain's check becomes a bluff at the legal size of highest payout-risk-weighted EV only when the hand has no value size, the bluff prices above the check (losses weighted by the Horse's pay-jump bubble factor where a pay jump is live), AND blockers or the range advantage are the Horse's. Turn missed bluffs were the third tournament leak after the flop (89 decisions, 164.4 bb, 2026-11-20..26).

Receipts: `holdem_tourney_turn_bluff_bet`, `holdem_tourney_bluff_no_edge`, `holdem_tourney_bluff_payout_unpriced`, `holdem_tourney_bluff_unpriced`.

Default OFF in source (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`, read `=== true`), registered (migration 20261126064723), switchable live; scoped to NLH tournaments, turn only.

## Why It Fails (Root Cause)

The bet's EV prices his fold or his call only (as the cash opening side does). On the turn a raise over the bluff forfeits the bluff's remaining draw equity and the Horse's own continuation, which the price does not see; the scripted raiser (raises any bet it faces with equity 0.35 or more, and with air on a seeded 30%) takes exactly that. HorseMind keeps no per-opponent postflop raise record (foldToBet counts folds; riverCall counts call-or-raise), so a raise branch cannot be priced from his record today: it needs a raise counter in HorseMind and the read frame first (the same finding as the cash value bet, #12033).

## How It Prices

Scope: no-limit hold'em tournaments (MTT, Sit & Go, Spin, heads-up; never All-In-Or-Fold, bomb pots, run-it-twice boards, Short Deck, fixed limit, cash tables), one board, heads-up in the pot, the Horse NOT facing a wager and the brain's answer a check. The hook sits in the reference node right after the cash opening side (`HorseLogic.holdemTournamentBluffPriced`); later graph nodes still apply. The math is the cash opening side's (`server/src/engine/HorseHoldemOpeningIsPriced.ts`, sound in chips) plus the payout risk (`server/src/engine/HorseHoldemTournamentLateIsPriced.ts`):

- His range: his public line range (`HorseLogic.holdemPricedLineRead`), read with the Horse's own two cards removed (for the Horse's equity) and with no hole card removed (for who folds: he cannot see the Horse's cards).
- His fold to a bet B into pot P: `holdemPricedFold(foldRef, B, P)`, `foldRef = (his folds + 20 x 0.337) / (his opportunities + 20)` (river: his river response record; turn: his fold to a bet).
- Who folds: the weakest f of the range read without the Horse's cards; with the Horse's cards removed the share under that cutoff is his fold given the Horse's hand (f'), the Horse's equity against the rest eqCall.
- A hand with a value size (eqCall above one half at any size) is not a bluff: it is left to the brain.
- Sizes: the cash targets (1/3, 1/2, 3/4, pot) capped at the effective stack, and the effective shove when it is at most 1.5 pots, legalized by the engine. A short effective stack has only the shove and the sizes under it (in the real-hand replay the river option shoved at 8.5 and 9.9 bb where the audit's best was the shove).
- Payout risk: EV(bet B) = f' P + (1 - f') (r eqCall (P + B') - BF (1 - r eqCall) B); EV(check) = r eq P; r = 1 on the river or in position, else 0.88 (the cash constant). BF is the Horse's bubble factor (`HorseLogic.postflopWagerPayoutPrice` reading `payJumpBubbleFactor`: the Phase 7 `IcmModel.bubbleFactor`, a bust valued at the place it pays, moved toward 1 by the share of the award paid by place), read once per decision at the largest risk a bluff candidate takes. BF = 1 (chip EV) where no pay jump is live (not in the money, not hand for hand, not near the bubble, more than max(paid + 1, 1.15 x paid) left), with two or fewer left, or with no paid place. Where a pay jump is live and the context cannot price it (no trusted context, no stacks or the Horse's identity, a satellite, a PKO, a mystery bounty) the option stands down (receipt `holdem_tourney_bluff_payout_unpriced`): unknown is not "no pay jump". No new ICM model.
- The bluff: EV(bet) > EV(check) AND (the Horse's cards remove more of his calling part than of his folding part, f' > f: blocker dependent, OR the Horse's public line range outscores his on this board: range advantage above one half). Never random; no random draw anywhere (turn equities use the hvc module's seeded private generator).

## Prior anchor

- Baseline: with no record his fold at the reference price is 0.337, so his fold to any bet equals the bettor's break-even B / (B + P) (equilibrium minimum defence): a pure bluff with no blockers is worth exactly nothing in chips, and less than nothing where a pay jump is live.
- Population weight: zero. No population rate of any kind is read; the anchor carries 20 pseudo-opportunities and nothing else.
- Own record: his own decayed counters dominate as they grow, weight n / (n + 20); with the mind off or no counters the anchor stands.
- No unshown cards: nothing was fitted; his range is read from public actions only and the only hole cards read are the deciding Horse's own. The payout state is the public tournament context (stacks, places paid, payouts).

## How To Trial It (Live Shadow Stage)

Staged in `HorseOptionShadowStage.holdemTournamentTurnBluffIsPriced_SHADOW_STAGE` (`holdemStage(['nlh_tournament'], ['turn'])`): set the switch row to `shadow` (`node scripts/ops/horse-option-switch.mjs set holdemTournamentTurnBluffIsPriced shadow`) and read the per-direction watch with `node scripts/ops/horse-option-shadow-watch.mjs holdemTournamentTurnBluffIsPriced --since <ISO>` (from a check to a wager is the only direction it takes). The acted decision is unchanged in shadow.

## Grades (chips and ICM), 2026-11-26

Harness: the lane's scratch folder `plo-lead7-01TLQer8/tourney-postflop/src` (`tmirror.mjs`, `tprobe.mjs`, `trc.mjs`, `tlatency.mjs`, contexts in `ctx.mjs`), on this branch's source, production options of `docs/horse-option-switch-state.json` (asOf 2026-11-25T23:38Z, 73 decide options) in both arms, the option added in ON. No database; jobs niced, one at a time.

League mirror (every seat a Horse on the hybrid tournament profile; each deal played twice with the ON and OFF seats swapped; one memory sandbox per pass; seed 2611; bb/100 per seat ± standard error; on the cards with a stack list the ICM change of each seat's stack is reported too):

| card                                                                | seats | depth | hands  | ON - OFF bb/100 per seat         | ICM % of prize pool per 100 hands | fires (both passes) | code                                                              |
| ------------------------------------------------------------------- | ----- | ----- | ------ | -------------------------------- | --------------------------------- | ------------------- | ----------------------------------------------------------------- |
| heads-up SNG (2 left, winner-take-all)                              | 2     | 25 bb | 12,000 | +7.33 ± 2.75                     | -                                 | 926                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| MTT far from the money (180 left, 30 paid, BB ante)                 | 6     | 30 bb | 12,000 | +1.37 ± 0.80                     | -                                 | 580                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| MTT far from the money (180 left, 30 paid, BB ante)                 | 6     | 12 bb | 12,000 | inert (0 fires: push/fold depth) | -                                 | 0                   | this code (chip EV: no pay jump live, unchanged by later commits) |
| six-max Sit & Go (6 left, 2 paid)                                   | 6     | 20 bb | 12,000 | +0.63 ± 0.32                     | -                                 | 212                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| three-max Spin (winner-take-all)                                    | 3     | 25 bb | 12,000 | +3.88 ± 1.59                     | -                                 | 574                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| Sit & Go bubble (3 left, 2 paid, stacks: bubble factor priced)      | 3     | 20 bb | 12,000 | +2.73 ± 0.90                     | +2.502 ± 1.273                    | 477                 | superseded (a factor read per size)                               |
| MTT final table in the money (6 left, stacks: bubble factor priced) | 6     | 25 bb | 12,000 | +1.63 ± 0.60                     | +0.204 ± 0.204                    | 414                 | superseded (a factor read per size)                               |
| MTT far from the money (180 left, 30 paid, BB ante)                 | 6     | 18 bb | 12,000 | -0.19 ± 0.23                     | -                                 | 144                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| MTT context on a two-seat table (180 left)                          | 2     | 40 bb | 12,000 | +7.09 ± 2.62                     | -                                 | 721                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| Sit & Go bubble (3 left, 2 paid, stacks: bubble factor priced)      | 3     | 20 bb | 12,000 | +2.32 ± 0.82                     | +1.792 ± 1.140                    | 440                 | this code                                                         |
| MTT final table in the money (6 left, stacks: bubble factor priced) | 6     | 25 bb | 12,000 | +1.43 ± 0.52                     | +0.227 ± 0.175                    | 329                 | this code                                                         |

Exploit probes (heads-up Sit & Go context, 25 bb; the script in seat 0 is the production Horse with the options OFF except: caller never folds to a postflop bet; over-folder folds every turn and river bet unless its equity is at least 0.8; bluffer bets 2/3 pot on the river with equity 0.8+ and with air on a seeded quarter; raiser raises the pot over any postflop bet it faces with equity 0.35+ and with air on a seeded 30%; plain is the production Horse; memory off holds every read at its empty prior):

| probe      | memory | pairs (seed) | Horse OFF bb/100 | Horse ON bb/100 | ON - OFF (hand by hand) | hands differing |
| ---------- | ------ | ------------ | ---------------- | --------------- | ----------------------- | --------------- |
| plain      | on     | 6,000 (2201) | -2.75 ± 6.58     | +3.55 ± 7.18    | +6.30 ± 4.57            | 752             |
| caller     | on     | 6,000 (2201) | +185.98 ± 12.29  | +185.93 ± 12.29 | -0.06 ± 0.21            | 8               |
| overfolder | on     | 6,000 (2201) | +10.02 ± 5.82    | +19.43 ± 6.18   | +9.42 ± 3.70            | 643             |
| bluffer    | on     | 6,000 (2201) | +2.88 ± 6.13     | +6.28 ± 6.93    | +3.40 ± 3.47            | 570             |
| raiser     | on     | 6,000 (2201) | +82.56 ± 11.59   | +78.01 ± 11.63  | -4.55 ± 1.82            | 107             |
| caller     | off    | 6,000 (2201) | +129.34 ± 9.80   | +127.27 ± 10.43 | -2.08 ± 2.79            | 451             |
| raiser     | off    | 6,000 (2201) | +80.58 ± 11.15   | +71.68 ± 11.44  | -8.90 ± 2.59            | 292             |

Real-hand tournament audit replay (exact tier = the deciding Horse's own cards known; every turn/river CHECK of the audit; hands pulled read-only with `complaint-extract.sql`, every other seat's hole cards removed before the state is built; each decision re-decided at its recorded public snapshot, live hybrid tournament profile, seeds 1/7/42; fixed = the option-off replay is not the audit's best action and the option-on replay is, kind and a bet within max(1 bb, 15% of the pot); memory as of each decision = every has_human hand settled before it, public columns only, learned into a private sandbox (81,230 history hands)):

| replay                              | checks placed | fixed | newly wrong | changed, still not the best | changed ok to ok | unchanged | recorded cost of fixed (bb) |
| ----------------------------------- | ------------- | ----- | ----------- | --------------------------- | ---------------- | --------- | --------------------------- |
| v2a (2026-11-20..24), memory off    | 484           | 4     | 2           | 2                           | 1                | 475       | 4.3                         |
| v2a, memory as of each decision     | 484           | 12    | 14          | 6                           | 3                | 449       | 15.5                        |
| re-run (2026-11-20..26), memory off | 886           | 3     | 6           | 8                           | 3                | 866       | 14.2                        |
| re-run, memory as of each decision  | 886           | 15    | 24          | 18                          | 5                | 824       | 30.9                        |

The audit's listed Horse strengths (preflop raises and jam calls) and every recorded turn/river bet are untouched: the option acts only on a check.

## Speed

Per-decision cost of HorseLogic.decide where the option applies (heads-up tournament league spots where the brain checked on the option's street; ICM caches emptied before every timed call, so both arms are cold):

| context                                           | depth | spots | OFF p50 / p95 / max ms | ON p50 / p95 / max ms | fires                                         |
| ------------------------------------------------- | ----- | ----- | ---------------------- | --------------------- | --------------------------------------------- |
| 200-left MTT bubble (past the bound: stands down) | 60 bb | 374   | 6.59 / 7.17 / 14.23    | 6.29 / 6.82 / 14.86   | {"bluff_payout_unpriced": 424}                |
| 200-left MTT bubble (past the bound: stands down) | 25 bb | 402   | 6.58 / 7.15 / 11.4     | 6.28 / 6.9 / 11       | {"bluff_payout_unpriced": 452}                |
| 60-left MTT bubble, stacks (factor priced)        | 60 bb | 369   | 2.55 / 2.94 / 5.03     | 4.21 / 5.46 / 6.29    | {"turn_bluff_bet": 164, "bluff_no_edge": 112} |
| 60-left MTT bubble, stacks (factor priced)        | 25 bb | 394   | 2.48 / 2.89 / 3.96     | 3.95 / 5.09 / 6.59    | {"bluff_no_edge": 85, "turn_bluff_bet": 118}  |
| three-left bubble, stacks (factor priced)         | 60 bb | 503   | 0.63 / 0.96 / 3.5      | 1.48 / 2.45 / 5.02    | {"turn_bluff_bet": 216, "bluff_no_edge": 146} |
| three-left bubble, stacks (factor priced)         | 25 bb | 536   | 0.62 / 0.91 / 1.35     | 1.44 / 2.38 / 3       | {"bluff_no_edge": 129, "turn_bluff_bet": 207} |
| heads-up, chip EV                                 | 60 bb | 486   | 0.63 / 0.98 / 2.9      | 1.44 / 2.4 / 4.7      | {"turn_bluff_bet": 210, "bluff_no_edge": 141} |
| heads-up, chip EV                                 | 25 bb | 688   | 0.64 / 1.16 / 4.09     | 1.5 / 2.49 / 6.36     | {"turn_bluff_bet": 296, "bluff_no_edge": 255} |

Stage bar: p95 <= 10 ms, max <= 25 ms. Relative-cost law: `aHoldemTournamentBluffPriceIsFast.law.test.ts` (about 4x the option-off decision on the audited nodes, limit 12x).

## With No Opponent Record

Memory off: the raiser takes -8.90 ± 2.59 bb/100 and the caller -2.08 ± 2.79. The replay without memory: 3 fixed, 6 newly wrong.

## Limits

- His raise over the bluff is not priced (see Why It Fails); this is the fix needed before any re-grade.
- Payout risk, field bound, PKO and multiway limits as holdemTournamentRiverBluffIsPriced.

## Replay

- Replay: NOT RUN (the committed scorer has no adapter for the tournament hand audit decisions.csv; the lane harness trc.mjs result is recorded in Grades: newly wrong exceeds fixed)
