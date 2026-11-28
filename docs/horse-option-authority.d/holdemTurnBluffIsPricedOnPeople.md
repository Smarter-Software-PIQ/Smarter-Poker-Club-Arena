# holdemTurnBluffIsPricedOnPeople: Authority For The Live Switch

**State: default OFF in source** (registered, never switched). **Evidence MET (2026-11-27): every bar of the lane passed on the fourth version of this option, and the scored replay row on an audit set never looked at before reads 33 fixed / 4 newly wrong.** A responder that answers turn bets at people's measured fold and raise share by line and size: +6.70 +/- 1.73 bb/100 on two seeds no earlier version was run on, +3.86 +/- 1.02 over four seeds (direct effect, memory held still). League mirror heads-up +3.96 +/- 2.12 and 6-max +1.19 +/- 0.42 bb/100 per seat (same-seed no-op 0.00 +/- 0.00). Turn station +0.07 +/- 0.05, always-caller -0.14 +/- 0.10 (a handful of first bluffs, then none), over-folder +2.38 +/- 3.59, balanced bluffer +0.44 +/- 3.31. Flag-off 0 differences in 28,000 decisions. Read the Grades section for what failed on the way (three earlier versions) and the Limits: the gain against the current Horse field is small, the people card is a calibrated responder and not people, the NLH turn packet attach has never run live, and this is a watch-only (shadow) candidate first.

Owner orders it rests on: Hold'em late-street bluffs are never random: a bluff is math dependent AND blocker dependent, or the range advantage is the Horse's; no blanket rules, every threshold is a price; and of 2026-11-26 12:21 PM Chicago, "the stats need to be used against human players, not horses": opponent's own record, then people-only population, then the equilibrium anchor. Owner order of 2026-11-27 4:48 PM Chicago: the zero-bluff bugs, heads-up as well as multiway, in No Limit as well as Omaha.

## Why It Exists

The daily real-hand audits list "NLH cash turn: missed profitable bluff" among the top Hold'em chip leaks (41 audited turn missed bluffs in the two audit sets of 2026-11-20 to 2026-11-26). Measured from public actions, NLH cash hands with a person, 2026-10-28 to 2026-11-27 (lane note `plo-lead7-01TLQer8/l9-nlzb/NODES.md`), and on people's answers 2026-10-01 to 2026-11-26 (the table below, 746 answers):

- Horses bet the heads-up turn as often as people do in every line (barrel in position 51.4% against 51.2%, out of position 59.9% against 64.6%; after a checked flop 50.8% against 47.8% in position). The frequency is not the leak.
- A heads-up turn BARREL is not a profitable pure bluff against people: they fold 34.1% of them where break-even is 35.7% (293 bets, -1.68 +/- 1.17 bb a bet with no equity), and fold a barrel of two thirds pot or more at 0.89 times equilibrium.
- A SMALL bet after a checked flop is: people fold 38.6% of bets under 0.4 pot there where equilibrium folds 22.4% (83 answers, 1.72 times equilibrium; 43% against 22.5% on the Oct 28 to Nov 27 pull, +3.15 +/- 1.28 bb a bet with no equity), while at 0.4 to 0.7 pot they fold at equilibrium (1.08) and above it less (0.94). Horses pick the half-pot size 59% of the time in that line.

So the turn leak against people is the size and the line, not more barrels: the option acts ONLY after a checked-through flop. No existing option prices that: the baseline flop/turn bluff draws a random number from fixed dials and never bets air that is not a draw, an overcard hand or a blocker hand; `holdemOpeningBluffIsPriced` (registered, OFF) has the right price but reads his own decayed record shrunk to equilibrium with no people step and no size or line cell, so with no record a pure bluff is worth exactly nothing and every size prices the same.

## What It Does

Not facing a wager, heads-up, on the turn, WHEN THE FLOP WAS CHECKED THROUGH (`HorseLogic.holdemOpeningPriced`, the same hook and the same price as `holdemOpeningBluffIsPriced` and `holdemRiverBluffIsPricedOnPeople`): the brain's check becomes a bluff at a legal priced size only when

1. the hand has no value size (no size where its equity against his calling part is above one half, on his record-anchored fold and on the people-priced fold alike);
2. the bet prices above the check by more than the error of his fold: `EV(bet) - se(fold) x dEV/dfold > EV(check)`, size by size; the size with the highest such margin is bet (one third, one half, three quarters or the whole pot, or all in within 1.5 pots: no size is banned, the price chooses);
3. AND either the Horse's cards remove more of his calling part than of his folding part (blockers) or the Horse's public line range outscores his on this board (`holdemRangeAdvantage` above one half).

His fold to a bet B into pot P is `m x B / (P + B)`, at least 0.01 and at most 0.95 (`HorseHoldemPeopleTurnFold.ts`):

- equilibrium: `m = 1`;
- people: the size cell of B (under 0.4 pot, 0.4 to 0.7, 0.7 to 1.1, above) of people's answers to a heads-up NLH cash turn first bet, shrunk to equilibrium, then the cell of the checked-through-flop line shrunk to the size cell: `m_cell = (F + k g m_parent) / (E + k g)`;
- his own record: his lifetime public first answers to a heads-up turn first bet OF THAT SIZE (OPPONENT-HUD `t.fb.sm.hu` at most 0.7 pot, `t.fb.bg.hu` above). The record is by size only and cannot see the line, so it SCALES people's cell instead of replacing it: `rho = [(F + k g M) / (n g + k g)] / M`, with M people's multiplier of that same record cell over every line, and `m = m_people(line, size) x rho`. No record: `rho = 1`. A player who never folds a turn bet: `rho` goes to 0. A player who folds as people do overall keeps people's line cell whole. The other size cell is not read. With no lifetime turn record of either size, his recent record of folds to a bet (the decayed window counters, unsized) is read the same way against people's all-sizes cell;
- `k = 44.4` pseudo-answers at every step: the measured between-player prior strength of the turn fold (beta-binomial method of moments on people with at least 5 answers, NLH cash and tournaments pooled: 44.4 small cell on 41 people, 38.1 big cell on 24; the larger is used, the river module's rule).

Who folds, the Horse's equity against the rest (with the out-of-position realization on the turn), EV(bet) and EV(check) are `holdemOpeningPrice` unchanged. No random draw anywhere. After a flop wager (the Horse barrels, or leads into the flop bettor) this option stands aside and reads nothing: there people fold a turn bet at or below equilibrium (0.89 to 1.04 and 0.62 to 0.94), so there is no people edge to price, and an earlier version of this option, which priced those lines too, made more new mistakes than fixes there on the audited hands (see Replay). With both this option and `holdemOpeningBluffIsPriced` on, this option decides the turn after a checked-through flop and that one keeps the rest.

The same formula for every opponent: nothing is keyed on an account, a name or a person/Horse flag; only the population's data source is people's play.

Receipts: `holdem_turn_people_bluff_bet`, `holdem_turn_people_bluff_no_edge`, `holdem_turn_people_bluff_below_check`, `holdem_opening_priced_unpriced`.

Scope: no-limit hold'em cash, table and Lightning (never tournaments, Short Deck, fixed limit, bomb pots, all-in-or-fold tables, run-it-twice boards), one board, heads-up, turn, the flop checked through, the Horse NOT facing a wager. Not multiway, not the flop, not the river, not after a flop wager. Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## The Lifetime Record Reaches The Decision Only While The Option Is Switched

As for the river option one street later (`services/OpponentHudStore.ts`, `HUD_NLH_TURN_CONSUMERS`): while this option's switch row is `on`, `shadow` or `on_shadow` and the store is armed, the HEADS-UP TURN decision of an NLH cash hand carries its opponent's packet; every other NLH decision, and every NLH decision while the row is off, carries nothing, exactly as before. Read-only check of production on 2026-11-27: `opponent_hud_profiles` family nlh holds 128 people's profiles, 68 with a `t.fb.sm.hu` cell (1,133 small answers, 37.5% folds; 485 big answers, 46.2% folds). The attach has unit tests only (`OpponentHudStore.test.ts`); it has never run live: the shadow stage is where it is first seen.

## Prior anchor

- Baseline: equilibrium, the fold a minimum-defence player gives a bet of B into P, `B / (P + B)` (`m = 1`); a thin people cell reads it, and the price needs blockers or the range advantage on top.
- Population weight: the PEOPLE-ONLY measured fold multiplier for the Horse's line and the bet's size (`HorseHoldemPeopleTurnFoldTables.json` v1-2026-11-27-people-cash-turn, fit by `scripts/ops/holdem-people-turn-fold-fit.mjs`: 746 answers by people to heads-up NLH cash turn first bets, 2026-10-01 to 2026-11-26, 18,911 hands read; an answer by a Horse never enters a cell, the stored HUD '\*' population rows are not read), each cell shrunk by 44.4 pseudo-answers.
- Own record: the opponent's own lifetime public turn answers of the bet's size, shrunk to people's multiplier of that same cell by the same 44.4 and applied as a ratio to people's line cell, so his own record dominates as it grows in what it measures (how much he folds bets of that size) and people's table supplies only the line split his record cannot see; a player who never folds a turn bet is priced as one.
- No unshown cards: the table is fitted on public actions only (the pull selects no hole card, showdown or summary column); his range is read from public actions; the only hole cards read are the deciding Horse's own.

## How To Trial It (Live Shadow Stage)

Staged in `HorseOptionShadowStage.OPTION_SHADOW_STAGE` (`holdemStage(['nlh_cash', 'nlh_lightning'], ['turn'])`). From a check to a wager is the only direction this option can change; any other direction in the shadow read is a fault.

## Grades (chips), 2026-11-27

Bars were written before any grade (`plo-lead7-01TLQer8/l9-nlzb/BUILD.md`). Harness `l9-nlzb/src/grade3.mts` (a port of the river lane's `grade2.mts`: one memory sandbox and one lifetime record store per world, pair clock, deal mood, saved random stream; the same-seed no-op mirror reads 0.00 +/- 0.00 heads-up and 6-max), run from this branch's `server/`, base = the live switch rows read 2026-11-27 17:10Z in both arms and the option added in ON. bb/100, big blind 2 chips. Every world counts each seat's first answers to heads-up turn first bets by size from its own completed hands and serves them as the lifetime record, as live.

| card                  | conditions                                        | seed     | n     | ON - no-op bb/100 | option turn bluffs | notes                       |
| --------------------- | ------------------------------------------------- | -------- | ----- | ----------------- | ------------------ | --------------------------- |
| NO-OP mirror heads-up | every seat a Horse, ON/OFF seats swapped per deal | 20261127 | 6000  | +0.00 +/- 0.00    | 0                  |                             |
| NO-OP mirror 6-max    | every seat a Horse, ON/OFF seats swapped per deal | 20261127 | 3000  | +0.00 +/- 0.00    | 0                  |                             |
| people                | memory held still, lifetime record live           | 13       | 12000 | +8.88 +/- 3.17    | 496                | Horse OFF +15.0, ON +23.9   |
| people                | memory held still, lifetime record live           | 14       | 12000 | +4.52 +/- 1.39    | 504                | Horse OFF +17.2, ON +21.8   |
| people                | memory held still, lifetime record live           | 11       | 12000 | +2.46 +/- 1.35    | 508                | Horse OFF +29.7, ON +32.2   |
| people                | memory held still, lifetime record live           | 12       | 12000 | -0.42 +/- 1.69    | 516                | Horse OFF +32.9, ON +32.5   |
| turnstation           | memory held still, lifetime record live           | 11       | 12000 | +0.13 +/- 0.09    | 5                  | Horse OFF +47.1, ON +47.2   |
| turnstation           | memory held still, lifetime record live           | 12       | 12000 | +0.02 +/- 0.04    | 7                  | Horse OFF +41.3, ON +41.3   |
| caller                | memory held still, lifetime record live           | 11       | 12000 | -0.14 +/- 0.11    | 4                  | Horse OFF +231.0, ON +230.9 |
| caller                | memory held still, lifetime record live           | 12       | 12000 | -0.13 +/- 0.17    | 6                  | Horse OFF +230.6, ON +230.4 |
| mirror heads-up       | every seat a Horse, ON/OFF seats swapped per deal | 20261127 | 24000 | +1.77 +/- 3.14    | 365                |                             |
| mirror 6-max          | every seat a Horse, ON/OFF seats swapped per deal | 20261127 | 12000 | +1.66 +/- 0.67    | 119                |                             |
| mirror heads-up       | every seat a Horse, ON/OFF seats swapped per deal | 20261128 | 24000 | +6.14 +/- 2.84    | 399                |                             |
| mirror 6-max          | every seat a Horse, ON/OFF seats swapped per deal | 20261128 | 12000 | +0.71 +/- 0.52    | 126                |                             |
| overfolder            | memory on, lifetime record live                   | 11       | 12000 | +4.08 +/- 5.10    | 233                | Horse OFF +14.4, ON +18.5   |
| overfolder            | memory on, lifetime record live                   | 12       | 12000 | +0.68 +/- 5.04    | 233                | Horse OFF +29.0, ON +29.6   |
| bluffer               | memory on, lifetime record live                   | 11       | 12000 | -5.54 +/- 4.83    | 205                | Horse OFF +0.8, ON -4.7     |
| bluffer               | memory on, lifetime record live                   | 12       | 12000 | +6.42 +/- 4.52    | 244                | Horse OFF +2.5, ON +8.9     |
| people                | memory on, lifetime record live                   | 11       | 12000 | +2.20 +/- 5.75    | 150                | Horse OFF +17.1, ON +19.3   |
| people                | memory on, lifetime record live                   | 12       | 12000 | +2.79 +/- 4.89    | 166                | Horse OFF +12.5, ON +15.3   |
| turnstation           | memory on, lifetime record live                   | 11       | 12000 | -8.62 +/- 6.04    | 5                  | Horse OFF +34.3, ON +25.6   |
| caller                | memory on, lifetime record live                   | 11       | 12000 | -4.93 +/- 7.74    | 7                  | Horse OFF +385.5, ON +380.6 |
| turnstation           | memory held still, no lifetime record             | 11       | 12000 | -0.88 +/- 0.65    | 398                | Horse OFF +47.1, ON +46.2   |

- people (memory held still, lifetime record live), 4 seed(s) pooled: +3.86 +/- 1.02 (+3.8 SE)
- turnstation (memory held still, lifetime record live), 2 seed(s) pooled: +0.07 +/- 0.05 (+1.5 SE)
- caller (memory held still, lifetime record live), 2 seed(s) pooled: -0.14 +/- 0.10 (-1.3 SE)
- mirror heads-up (every seat a Horse, ON/OFF seats swapped per deal), 2 seed(s) pooled: +3.96 +/- 2.12 (+1.9 SE)
- mirror 6-max (every seat a Horse, ON/OFF seats swapped per deal), 2 seed(s) pooled: +1.19 +/- 0.42 (+2.8 SE)
- overfolder (memory on, lifetime record live), 2 seed(s) pooled: +2.38 +/- 3.59 (+0.7 SE)
- bluffer (memory on, lifetime record live), 2 seed(s) pooled: +0.44 +/- 3.31 (+0.1 SE)
- people (memory on, lifetime record live), 2 seed(s) pooled: +2.50 +/- 3.77 (+0.7 SE)
- turnstation (memory on, lifetime record live), 1 seed(s) pooled: -8.62 +/- 6.04 (-1.4 SE)
- caller (memory on, lifetime record live), 1 seed(s) pooled: -4.93 +/- 7.74 (-0.6 SE)
- turnstation (memory held still, no lifetime record), 1 seed(s) pooled: -0.88 +/- 0.65 (-1.4 SE)

Reading the cards:

- People (`people`): a responder that answers a turn FIRST bet at people's measured fold AND raise share for the bettor's line and the bet's size (after a checked flop 38.6% / 37.6% / 43.5% folds under 0.4 pot / 0.4 to 0.7 / 0.7 to 1.1; a barrel 19.8% / 37.0% / 41.9%; a lead into the flop bettor 25% / 24% / 29%; raises 5 to 17%), and a river bet at people's river fold by size; its weakest hands fold first, the top share raises pot, the rest call; everything else is the production Horse. Its own lifetime turn record in the harness ends near 37% folds to small bets and 47% to big ones; production's people cells read 37.5% and 46.2%. Direct effect (opponent memory held still so both arms stay on the same hands), four seeds in the order 13, 14, 11, 12: +3.86 +/- 1.02 bb/100 (+8.88 +/- 3.17; +4.52 +/- 1.39; +2.46 +/- 1.35; -0.42 +/- 1.69); the fresh seeds 13 and 14 alone: +6.70 +/- 1.73 bb/100. With memory on: +2.50 +/- 3.77 bb/100 (+2.20 +/- 5.75; +2.79 +/- 4.89).
- Calling stations (the caller never folds to a postflop bet; the turn station never folds a turn bet). The lifetime turn record prices them as what they are: the option fires 4 to 7 turn bluffs in 12,000 hands, early, and none after. Turn station +0.07 +/- 0.05 bb/100 (+0.13 +/- 0.09; +0.02 +/- 0.04); caller -0.14 +/- 0.10 bb/100 (-0.14 +/- 0.11; -0.13 +/- 0.17) (a one-off learning cost of those first bluffs, not a rate).
- A station with NO record of any kind that never builds one (lifetime record off, memory held still): -0.88 +/- 0.65 bb/100 (-0.88 +/- 0.65). The record is what protects it; it reaches the decision whenever the option is switched.
- Over-folder +2.38 +/- 3.59 bb/100 (+4.08 +/- 5.10; +0.68 +/- 5.04); balanced bluffer (the production Horse that also bets the turn and river at a balanced share) +0.44 +/- 3.31 bb/100 (-5.54 +/- 4.83; +6.42 +/- 4.52).
- Earlier versions, recorded because they failed or showed nothing (every card above is the fourth version, re-run from zero):
  1. His window record of folds to a bet as the only own record: turn station -1.66 +/- 1.08 bb/100 with memory held still (it cannot see a player who gives up flops and never folds a turn). People card +4.02 +/- 1.42 (no own record ever read there).
  2. The lifetime turn record by size REPLACING people's cell, every line: chips cards passed (people +2.15 +/- 2.11, heads-up mirror +11.76 +/- 2.59, 6-max +4.08 +/- 1.15, turn station -0.01 +/- 0.14) but the audited replay failed: committed scorer 6 fixed / 4 newly wrong with no memory and 5 / 6 with memory as of the decision, the damage in leads into the flop bettor (1 fixed / 7 newly wrong over the two modes) where people fold a turn bet BELOW equilibrium.
  3. The same, after a checked-through flop only: people card +1.29 +/- 1.51 and -1.17 +/- 1.78 (pooled +0.06 +/- 1.17): no gain. His size-only record had replaced the line cell of people's table.
- The mirror and the bluffer probe are against today's Horses. They show the option is not exploited by the current field; they are not the measure of its gain against people.
- The people card's bar seeds for this version are 13 and 14, which no earlier version was run on; seeds 11 and 12 (seen on earlier versions) are reported beside them.

## Replay

Real-hand replay (every exact-tier postflop decision of the repo's NLH cash audit: the deciding Horse's own cards only, hands pulled read-only with `chooser/extract.sql`, which returns no person's cards; each decision re-decided at its recorded public snapshot, live hybrid cash profile, seeds 1/7/42, the action of the majority of seeds; `plo-lead7-01TLQer8/l8-nlhriver/src/rc.mjs` run from this branch). The replay has no lifetime turn record: with memory, each opponent's window record as of the decision stands in.

THE BINDING SET WAS NEVER LOOKED AT BEFORE THIS VERSION WAS FIXED: the audit of 2026-11-06 08:08Z to 2026-11-19 05:40Z (5,247 decisions in 1,040 hands, 876 turn checks, 158 audited turn missed bluffs), pulled after the scope and the pre-registration were written. The two later sets (2026-11-20 to 24, 327 decisions; 2026-11-24 to 26, 555 decisions) are the ones on which the second version failed and from which the scope was diagnosed, so they prove nothing for this version; they are recorded because the build reads every row. Rows with each opponent's memory as of the decision:

- Replay: fixed 33; newlyWrong 4; changed 41; unchanged 5206; unjudged 4; set NLH-cash-hand-audit-2026-11-06-to-19; scorer 5302af2ab3e; source placed verdict-only; arm TPP vs off; replayed 5247 of 5247
- Replay: fixed 1; newlyWrong 1; changed 2; unchanged 553; unjudged 0; set NLH-cash-hand-audit-2026-11-24-to-26; scorer 5302af2ab3e; source placed verdict-only; arm TPP vs off; replayed 555 of 555
- Replay: fixed 3; newlyWrong 0; changed 3; unchanged 324; unjudged 0; set NLH-cash-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm TPP vs off; replayed 327 of 327

With no opponent memory the same scorer prints, in the same order of sets: fixed 18; newlyWrong 2; changed 21; unchanged 5226; unjudged 1 | fixed 2; newlyWrong 1; changed 4; unchanged 551; unjudged 1 | fixed 2; newlyWrong 0; changed 2; unchanged 325; unjudged 0.

What changes on the unseen set: only turn checks after a checked-through flop become bets; nothing changes on the flop, on the river, facing a wager, multiway or after a flop wager.

The second version (every line, his size record replacing people's cell), for comparison on the same scorer: unseen set fixed 23; newlyWrong 16; changed 44; unchanged 5203; unjudged 5 with no memory and fixed 34; newlyWrong 28; changed 70; unchanged 5177; unjudged 8 with memory; the two later sets 6 fixed / 4 newly wrong with no memory and 5 / 6 with memory, the damage in leads into the flop bettor (1 fixed / 7 newly wrong over the two modes). That is why the option stands aside after a flop wager.

## Speed

Per-decision cost of `HorseLogic.decide` on heads-up NLH cash turn spots where the brain checks with nothing to call (league hands, tsx source build, the same state timed off and on; every such turn check, in and out of the option's line):

| stacks | spots | OFF p50 / p95 / p99 / max ms | ON p50 / p95 / p99 / max ms | ON minus OFF p95 / max ms |
| ------ | ----- | ---------------------------- | --------------------------- | ------------------------- |
| 100 bb | 921   | 0.61 / 0.86 / 1.20 / 1.83    | 1.26 / 1.84 / 2.14 / 3.31   | 1.21 / 2.19               |
| 300 bb | 869   | 0.61 / 0.84 / 1.16 / 1.71    | 1.26 / 1.92 / 2.30 / 5.04   | 1.28 / 4.44               |

Relative-cost law (`aHoldemTurnBluffIsPricedOnPeople.law.test.ts`, the fixture nodes): on about 1.2 to 1.3 ms against 0.28 ms off per decision, ratio about 4.5 (limit 16). The compiled build was not measured.

## Limits

- The mirror and the bluffer probe are against today's Horses; they show the option is not exploited by the current field, not its gain against people. The people card is a harness responder calibrated to people's measured turn answers, not people.
- People RAISE a turn bet (8.3% of answers; 6% of small bets after a checked flop); the price counts every non-fold as a call. Not priced here.
- Heads-up only. The multiway turn and river after a checked street (where Horses bet less than people: river probe multiway 5.7% against 21.6%) are not covered by this option.
- The NLH turn packet attach has never run live.
