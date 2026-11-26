# holdemTournamentRiverBluffIsPriced: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). Evidence NOT MET (the committed audited-decision scorer has no adapter for the tournament audit; the lane's grades are below). Lane grade: READY for a live shadow trial only, not for on: league mirror ON - OFF non-negative on every tournament card (heads-up +6.86 ± 2.64 and +8.48 ± 2.17 bb/100 per seat, every multi-handed card within noise of zero or positive), exploit probes with opponent memory on show no significant loss (caller 0.00, raiser -2.24 ± 1.16 and +0.21 ± 0.61 on a second seed), the real-hand tournament audit replay fixes 18 and newly breaks 2 with opponent memory as of each decision (recorded cost of the fixed decisions 75.4 bb), but with no opponent record it bleeds to an always-caller (-2.26 ± 0.78 bb/100) exactly as the cash opening-side bluff does.

## What It Does

NLH tournaments (MTT, Sit & Go, Spin, heads-up), heads-up in the pot, on the river, not facing a wager: the brain's check becomes a bluff at the legal size of highest payout-risk-weighted EV only when the hand has no value size, the bluff prices above the check (losses weighted by the Horse's pay-jump bubble factor where a pay jump is live), AND either the Horse's cards remove more of his calling part than of his folding part (blocker dependent) or the Horse's public line range outscores his (range advantage). It never bluffs at random. The top tournament leak after the flop in the audit (river missed bluffs: 161 decisions, 537.7 bb, first in every format and every stack depth, 2026-11-20..26).

Receipts: `holdem_tourney_river_bluff_bet`, `holdem_tourney_bluff_no_edge` (priced above the check, but neither blockers nor the range advantage were the Horse's: the check stands), `holdem_tourney_bluff_payout_unpriced` (a live pay jump the context cannot price, or a field past the ICM compute bound: the option stands down), `holdem_tourney_bluff_unpriced`.

Default OFF in source (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`, read `=== true`), registered (migration 20261126064723), switchable live; scoped to NLH tournaments, river only. Its turn twin is `holdemTournamentTurnBluffIsPriced` (NOT READY).

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

Staged in `HorseOptionShadowStage.holdemTournamentRiverBluffIsPriced_SHADOW_STAGE` (`holdemStage(['nlh_tournament'], ['river'])`): set the switch row to `shadow` (`node scripts/ops/horse-option-switch.mjs set holdemTournamentRiverBluffIsPriced shadow`) and read the per-direction watch with `node scripts/ops/horse-option-shadow-watch.mjs holdemTournamentRiverBluffIsPriced --since <ISO>` (from a check to a wager is the only direction it takes). The acted decision is unchanged in shadow.

## Grades (chips and ICM), 2026-11-26

Harness: the lane's scratch folder `plo-lead7-01TLQer8/tourney-postflop/src` (`tmirror.mjs`, `tprobe.mjs`, `trc.mjs`, `tlatency.mjs`, contexts in `ctx.mjs`), on this branch's source, production options of `docs/horse-option-switch-state.json` (asOf 2026-11-25T23:38Z, 73 decide options) in both arms, the option added in ON. No database; jobs niced, one at a time.

League mirror (every seat a Horse on the hybrid tournament profile; each deal played twice with the ON and OFF seats swapped; one memory sandbox per pass; seed 2611; bb/100 per seat ± standard error; on the cards with a stack list the ICM change of each seat's stack is reported too):

| card                                                                | seats | depth | hands  | ON - OFF bb/100 per seat         | ICM % of prize pool per 100 hands | fires (both passes) | code                                                              |
| ------------------------------------------------------------------- | ----- | ----- | ------ | -------------------------------- | --------------------------------- | ------------------- | ----------------------------------------------------------------- |
| heads-up SNG (2 left, winner-take-all)                              | 2     | 25 bb | 12,000 | +6.86 ± 2.64                     | -                                 | 513                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| MTT far from the money (180 left, 30 paid, BB ante)                 | 6     | 30 bb | 12,000 | +0.57 ± 0.34                     | -                                 | 110                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| MTT far from the money (180 left, 30 paid, BB ante)                 | 6     | 12 bb | 12,000 | inert (0 fires: push/fold depth) | -                                 | 0                   | this code (chip EV: no pay jump live, unchanged by later commits) |
| six-max Sit & Go (6 left, 2 paid)                                   | 6     | 20 bb | 12,000 | +0.13 ± 0.11                     | -                                 | 19                  | this code (chip EV: no pay jump live, unchanged by later commits) |
| three-max Spin (winner-take-all)                                    | 3     | 25 bb | 12,000 | +1.12 ± 0.84                     | -                                 | 131                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| Sit & Go bubble (3 left, 2 paid, stacks: bubble factor priced)      | 3     | 20 bb | 12,000 | +0.53 ± 0.46                     | +0.283 ± 0.639                    | 68                  | superseded (a factor read per size)                               |
| MTT final table in the money (6 left, stacks: bubble factor priced) | 6     | 25 bb | 12,000 | -0.05 ± 0.24                     | -0.088 ± 0.082                    | 26                  | superseded (a factor read per size)                               |
| MTT far from the money (180 left, 30 paid, BB ante)                 | 6     | 18 bb | 12,000 | +0.10 ± 0.05                     | -                                 | 11                  | this code (chip EV: no pay jump live, unchanged by later commits) |
| MTT context on a two-seat table (180 left)                          | 2     | 40 bb | 12,000 | +8.48 ± 2.17                     | -                                 | 411                 | this code (chip EV: no pay jump live, unchanged by later commits) |
| Sit & Go bubble (3 left, 2 paid, stacks: bubble factor priced)      | 3     | 20 bb | 12,000 | +0.15 ± 0.44                     | -0.114 ± 0.616                    | 52                  | this code                                                         |
| MTT final table in the money (6 left, stacks: bubble factor priced) | 6     | 25 bb | 12,000 | +0.05 ± 0.22                     | -0.062 ± 0.080                    | 19                  | this code                                                         |

Exploit probes (heads-up Sit & Go context, 25 bb; the script in seat 0 is the production Horse with the options OFF except: caller never folds to a postflop bet; over-folder folds every turn and river bet unless its equity is at least 0.8; bluffer bets 2/3 pot on the river with equity 0.8+ and with air on a seeded quarter; raiser raises the pot over any postflop bet it faces with equity 0.35+ and with air on a seeded 30%; plain is the production Horse; memory off holds every read at its empty prior):

| probe      | memory | pairs (seed)  | Horse OFF bb/100 | Horse ON bb/100 | ON - OFF (hand by hand) | hands differing |
| ---------- | ------ | ------------- | ---------------- | --------------- | ----------------------- | --------------- |
| plain      | on     | 6,000 (2201)  | -2.75 ± 6.58     | +8.64 ± 7.23    | +11.39 ± 4.40           | 621             |
| caller     | on     | 6,000 (2201)  | +185.98 ± 12.29  | +185.98 ± 12.29 | +0.00 ± 0.00            | 0               |
| overfolder | on     | 6,000 (2201)  | +10.02 ± 5.82    | +17.94 ± 6.35   | +7.92 ± 3.42            | 500             |
| bluffer    | on     | 6,000 (2201)  | +2.88 ± 6.13     | +9.43 ± 7.19    | +6.55 ± 3.54            | 426             |
| raiser     | on     | 6,000 (2201)  | +82.56 ± 11.59   | +80.32 ± 11.65  | -2.24 ± 1.16            | 48              |
| caller     | off    | 6,000 (2201)  | +129.34 ± 9.80   | +127.08 ± 9.88  | -2.26 ± 0.78            | 28              |
| raiser     | off    | 6,000 (2201)  | +80.58 ± 11.15   | +79.60 ± 11.18  | -0.98 ± 0.73            | 12              |
| raiser     | on     | 12,000 (2202) | +95.43 ± 8.46    | +95.63 ± 8.48   | +0.21 ± 0.61            | 50              |

Real-hand tournament audit replay (exact tier = the deciding Horse's own cards known; every turn/river CHECK of the audit; hands pulled read-only with `complaint-extract.sql`, every other seat's hole cards removed before the state is built; each decision re-decided at its recorded public snapshot, live hybrid tournament profile, seeds 1/7/42; fixed = the option-off replay is not the audit's best action and the option-on replay is, kind and a bet within max(1 bb, 15% of the pot); memory as of each decision = every has_human hand settled before it, public columns only, learned into a private sandbox (81,230 history hands)):

| replay                              | checks placed | fixed | newly wrong | changed, still not the best | changed ok to ok | unchanged | recorded cost of fixed (bb) |
| ----------------------------------- | ------------- | ----- | ----------- | --------------------------- | ---------------- | --------- | --------------------------- |
| v2a (2026-11-20..24), memory off    | 484           | 0     | 0           | 2                           | 0                | 482       | 0                           |
| v2a, memory as of each decision     | 484           | 9     | 0           | 4                           | 2                | 469       | 29.5                        |
| re-run (2026-11-20..26), memory off | 886           | 0     | 0           | 2                           | 0                | 884       | 0                           |
| re-run, memory as of each decision  | 886           | 18    | 2           | 6                           | 2                | 858       | 75.4                        |

The audit's listed Horse strengths (preflop raises and jam calls) and every recorded turn/river bet are untouched: the option acts only on a check.

## Speed

Per-decision cost of HorseLogic.decide where the option applies (heads-up tournament league spots where the brain checked on the option's street; ICM caches emptied before every timed call, so both arms are cold):

| context                                           | depth | spots | OFF p50 / p95 / max ms | ON p50 / p95 / max ms | fires                                         |
| ------------------------------------------------- | ----- | ----- | ---------------------- | --------------------- | --------------------------------------------- |
| 200-left MTT bubble (past the bound: stands down) | 60 bb | 222   | 6.86 / 7.94 / 11.58    | 6.38 / 6.89 / 11.51   | {"bluff_payout_unpriced": 272}                |
| 200-left MTT bubble (past the bound: stands down) | 25 bb | 233   | 6.76 / 7.83 / 11.33    | 6.25 / 6.83 / 11.09   | {"bluff_payout_unpriced": 283}                |
| 60-left MTT bubble, stacks (factor priced)        | 60 bb | 218   | 2.81 / 3.73 / 3.96     | 3.7 / 5.28 / 5.95     | {"bluff_no_edge": 21, "river_bluff_bet": 42}  |
| 60-left MTT bubble, stacks (factor priced)        | 25 bb | 232   | 2.73 / 3.71 / 4.08     | 3.67 / 5.06 / 7.04    | {"bluff_no_edge": 33, "river_bluff_bet": 45}  |
| three-left bubble, stacks (factor priced)         | 60 bb | 315   | 0.87 / 1.82 / 2.3      | 1.11 / 2.2 / 3.21     | {"river_bluff_bet": 69, "bluff_no_edge": 40}  |
| three-left bubble, stacks (factor priced)         | 25 bb | 339   | 0.79 / 1.79 / 3.04     | 1.18 / 2.3 / 5.4      | {"river_bluff_bet": 84, "bluff_no_edge": 51}  |
| heads-up, chip EV                                 | 60 bb | 295   | 0.79 / 1.73 / 2.2      | 1.08 / 2.28 / 2.99    | {"river_bluff_bet": 71, "bluff_no_edge": 33}  |
| heads-up, chip EV                                 | 25 bb | 464   | 0.74 / 1.84 / 3.44     | 1.15 / 2.27 / 3.6     | {"river_bluff_bet": 144, "bluff_no_edge": 86} |

Stage bar: p95 <= 10 ms, max <= 25 ms. Relative-cost law: `aHoldemTournamentBluffPriceIsFast.law.test.ts` (about 4x the option-off decision on the audited nodes, limit 12x).

## With No Opponent Record (The Equilibrium-Anchored Case)

With no record his fold to a bet is the bettor's break-even, so a pure bluff is worth nothing and the option bluffs only where the Horse's cards remove more of his calling part than of his folding part. A seat that never folds still beats those bets: with memory off the always-caller takes -2.26 ± 0.78 bb/100 from the option (28 hands of 6,000 differ). With memory on the caller's record shuts the option off at once (0 hands differ). That is the reason for a live shadow trial first: live, a person with no record yet faces only blocker bluffs, and a calling station among them costs a little until his record forms.

## Limits

- His raise over the bluff is not priced (fold or call only); on the river a raise costs the bluff only what a call would, but a raiser's record is read as a caller's (riverCall counts call-or-raise). The raiser probe: -2.24 ± 1.16 (6,000 pairs, seed 2201) and +0.21 ± 0.61 (12,000 pairs, seed 2202), pooled about -0.3 ± 0.5: no significant loss.
- Payout risk: the Horse's own bubble factor only (his fold is not raised by his own bubble factor: conservative). Read once per decision at the largest bluff risk. Stands down on a live pay jump that the context cannot price, and on a live pay jump of a field past 60 stacks (compute bound). In a PKO or a mystery bounty away from the money it prices chips and ignores head value (a bluff that is called never busts him unless all in).
- The league's pay-jump cards measure ICM on a three-left Sit & Go bubble and a six-left final table only; a big-field MTT bubble is out of scope by the compute bound, so it is not graded.
- Heads-up pots only; multiway river spots keep the brain's check.
- The audit's best action is graded against the people population's measured over-folding, which the prior anchor law forbids as a prior: with no opponent memory the replay fixes nothing (and breaks nothing); the fixes appear only with each opponent's own record.

## Replay

- Replay: NOT RUN (the committed scorer has no adapter for the tournament hand audit decisions.csv; the lane harness trc.mjs result is recorded in Grades)
