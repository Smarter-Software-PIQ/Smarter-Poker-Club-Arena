# holdemRiverBluffIsPricedOnPeople: Authority For The Live Switch

**Evidence MET (2026-11-27): every bar of the lane passed and the scored replay rows below are 8 fixed / 1 newly wrong and 7 fixed / 2 newly wrong.** League mirror heads-up +10.52 +/- 3.25 bb/100 per seat (48,000 hands, two seeds; +25.30 +/- 6.35 at 300 bb) and 6-max +6.99 +/- 0.95 (36,000 hands, three seeds); a responder that answers river bets at people's measured fold by size +3.50 +/- 1.78 direct (two seeds, 24,000 hands; +7.91 +/- 3.19 over three seeds with the opponent's memory on); exploit probes calling station -0.02 +/- 0.11 and river station +5.50 +/- 4.40 with their record live (direct cost with the opponent's memory held still -0.04 +/- 0.02: one to eight bluffs until his record prices him), over-folder +23.41 +/- 3.87, balanced bluffer +17.39 +/- 4.80 (two seeds each); scored real-hand replay on 882 audited decisions 15 fixed / 3 newly wrong (13 of the 61 audited river missed bluffs become bets; the audit's strict size rule reads the same replay 4 fixed / 2 newly wrong / 14 right action at another size); the audits' Horse strengths unchanged; flag-off 0 differences in 28,000 decisions; decision cost on the compiled build p95 2.3 ms, max 8.5 ms on 1,254 applicable spots. What the evidence does not hold: the mirror is against today's Horses, a calling station nobody has a record of and whose record never builds loses -16 to -18 bb/100 (the lifetime record by size is what protects it), and no live decision has run it: the next step is the live shadow stage, not on. Default OFF in source (`OPTION_SWITCH_RELEASE_DEFAULT_OFF`, read `=== true`), registered (migration `20261127053906_horse_option_register_holdem_river_bluff_on_people`), switchable `off / shadow / on_shadow / on`, scoped to NLH cash tables and Lightning. Built 2026-11-27 by PLO-OWNER + Hold'em owner lead-8, lane nlhriver.

Owner orders it rests on: Hold'em late-street bluffs are never random: a bluff is math dependent AND blocker dependent, or the range advantage is the Horse's; no blanket rules, every threshold is a price; and of 2026-11-26 12:21 PM Chicago, "the stats need to be used against human players, not horses": opponent's own record, then people-only population, then the equilibrium anchor.

## Why It Exists

Every daily real-hand audit lists "NLH cash river: missed profitable bluff" as the top Hold'em chip leak (2026-11-26: 18 decisions, 175 bb). Measured from public actions, people only, NLH cash, 2026-10-01 to 2026-11-26: people fold 49.2% of heads-up river first bets (243 of 494) where a minimum-defence player folds 37.6%: 1.31 times equilibrium, and more to small bets than to big ones (multiplier 1.57 under 0.4 pot, 1.44 at 0.4 to 0.7, 1.18 at 0.7 to 1.1, 1.06 above; 1.89 at 0.4 to 0.7 pot after the turn was checked through). The turn is not the same root: people fold 37.3% of heads-up turn first bets (278 of 746) against 35.3% at equilibrium (1.06), so this option is river only.

No existing option prices that:

- `holdemRiverBluffIsPriced`, `holdemRiverLeadRangeIsPriced`, `holdemRiverBluffMultiwayIsPriced` (unregistered, OFF) price on `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET`, a curve of 14,830 Horse answers pooled with 793 people's (72.7% and 79.2% folds at 67 to 100% pot and above, where people fold 55.6% and 58.3%). That is a population fitted on Horse play: it breaks the owner order and they are not repaired here.
- `holdemOpeningBluffIsPriced` (registered, OFF) has the right shape (the price, and blockers or the range advantage) but reads his own decayed record shrunk to the equilibrium anchor with no people step and no size cell: with no record a pure bluff is worth exactly nothing, so against a new person it fires almost never (0 of the 61 audited river missed bluffs with no memory, 5 with memory).

## What It Does

Not facing a wager, heads-up, on the river (`HorseLogic.holdemOpeningPriced`, the same hook and the same price as `holdemOpeningBluffIsPriced`): the brain's check becomes a bluff at a legal priced size only when

1. the hand has no value size (no size where its equity against his calling part is above one half, on his record-anchored fold and on the people-priced fold alike);
2. the bet prices above the check by more than the error of his fold: `EV(bet) - se(fold) x dEV/dfold > EV(check)`, size by size; the size with the highest such margin is bet;
3. AND either the Horse's cards remove more of his calling part than of his folding part (his fold given the Horse's hand above his fold read without it: blockers) or the Horse's public line range outscores his on this board (`holdemRangeAdvantage` above one half).

His fold to a bet B into pot P is `m x B / (P + B)`, at least 0.01 and at most 0.95 (`HorseHoldemPeopleRiverFold.ts`):

- equilibrium: `m = 1` (the fold a minimum-defence player gives the bet);
- people: the size cell of B (under 0.4 pot, 0.4 to 0.7, 0.7 to 1.1, above) of people's answers to a heads-up NLH cash river first bet, shrunk to equilibrium, then the cell of the Horse's line (it made the last turn wager, the opponent did, nobody did) shrunk to the size cell: `m_cell = (F + k g m_parent) / (E + k g)`, F folds, E the equilibrium folds of the bets answered, `g = E / n`;
- his own record: his lifetime public first answers to a heads-up river first bet OF THAT SIZE (OPPONENT-HUD `r.fb.sm.hu` at most 0.7 pot, `r.fb.bg.hu` above) move people's multiplier the same way and dominate as they grow. The other size cell is not read (people answer the two sizes differently). With no lifetime record of either size, his recent river response record (the decayed `riverCallOpp - riverCall of riverCallOpp`) is his record.
- `k = 19.9` pseudo-answers at every step: the measured between-player prior strength of the river fold (beta-binomial method of moments on people with at least 5 answers, NLH cash and tournaments pooled: 18.9 small cell, 19.9 big cell; the larger is used. Cash alone measures 7.6 and 12.3 on 17 and 10 people).

Who folds, the Horse's equity against the rest, EV(bet) and EV(check) are `holdemOpeningPrice` unchanged: `EV(bet) = f' P + (1 - f')(eqCall (P + B + B') - B)`, `EV(check) = eq P`. No random draw anywhere. With both this option and `holdemOpeningBluffIsPriced` on, this option decides the river and that one keeps the turn.

The same formula for every opponent: nothing is keyed on an account, a name or a person/Horse flag; only the population's data source is people's play.

Receipts: `holdem_river_people_bluff_bet`, `holdem_river_people_bluff_no_edge` (priced above the check, but neither blockers nor the range advantage were the Horse's: the check stands), `holdem_river_people_bluff_below_check` (no size cleared the check by the error of his fold), `holdem_opening_priced_unpriced`.

Scope: no-limit hold'em cash, table and Lightning (never tournaments, Short Deck, fixed limit, bomb pots, all-in-or-fold tables, run-it-twice boards), one board, heads-up, river, the Horse NOT facing a wager. Not multiway (PR #12095's `holdemMultiwayOpeningBluffIsPriced` is the multiway piece and keeps the equilibrium anchor). Off (absent, false or a truthy non-boolean): nothing here is read; byte-identical.

## The Lifetime Record Reaches The Decision Only While The Option Is Switched

OPPONENT-HUD keeps NLH lifetime profiles (the `r.fb.sm.hu` / `r.fb.bg.hu` cells among them) but attached its packet to PLO4/PLO5 cash decisions only (`HUD_LIVE_SNAPSHOT_FAMILIES`, AUDIT-24H P1-2: no IPC bloat before an NLH consumer opts in). This option opts in, narrowly (`services/OpponentHudStore.ts`, `HUD_NLH_RIVER_CONSUMERS`): while its switch row is `on`, `shadow` or `on_shadow` and the store is armed (`omahaOpponentLifetimeHud` on, as it is live), the HEADS-UP RIVER decision of an NLH cash hand carries its opponent's packet; every other NLH decision, and every NLH decision while the row is off or absent, carries nothing, exactly as before (`OpponentHudStore.test.ts`). The worker reads it through the provider it already installs (`HorseMind.holdemRiverFirstWagerFoldRecordOf`). A shadow re-decision therefore reads the same record the acted decision would.

## Prior anchor

- Baseline: equilibrium, the fold a minimum-defence player gives a bet of B into P, `B / (P + B)` (`m = 1`); a thin people cell reads it, and the price needs blockers or the range advantage on top.
- Population weight: the PEOPLE-ONLY measured fold multiplier for the Horse's line and the bet's size (`HorseHoldemPeopleRiverFoldTables.json` v1-2026-11-27-people-cash-river, fit by `scripts/ops/holdem-people-river-fold-fit.mjs`: 494 answers by people to heads-up NLH cash river first bets, 2026-10-01 to 2026-11-26, 18,911 hands read; an answer by a Horse never enters a cell, the stored HUD '\*' population rows are not read), each cell shrunk by 19.9 pseudo-answers. Never the Horse field: Horses fold 71.0% of 0.7 to 1.1 pot river bets where people fold 55.6%.
- Own record: the opponent's own lifetime public river answers of the bet's size, shrunk to people's multiplier by the same 19.9, so his own record dominates as it grows: after a checked-through turn 20 answers with no fold bring a half-pot multiplier of 1.79 down to 0.89, 60 answers to 0.45; a player who never folds is priced as one (probe: calling station ON minus OFF -0.02 +/- 0.11 bb/100 over 12,000 hands with his record live, 6 bluffs fired).
- No unshown cards: the table is fitted on public actions only (the pull selects no hole card, showdown or summary column); his range is read from public actions; the only hole cards read are the deciding Horse's own.

## How To Trial It (Live Shadow Stage)

Staged in `HorseOptionShadowStage.OPTION_SHADOW_STAGE` (`holdemStage(['nlh_cash', 'nlh_lightning'], ['river'])`): set the switch row to `shadow` (`node scripts/ops/horse-option-switch.mjs set holdemRiverBluffIsPricedOnPeople shadow`), and read the per-direction watch with `node scripts/ops/horse-option-shadow-watch.mjs holdemRiverBluffIsPricedOnPeople --since <ISO>` (from a check to a wager is the only direction this option takes). The acted decision is unchanged in shadow; the heads-up NLH cash river snapshot carries the opponent's lifetime packet from the moment the row is `shadow`.

## Grades (chips), 2026-11-27

Harness in the lane's scratch folder (`plo-lead7-01TLQer8/l8-nlhriver/src`: `grade.mts`, `rc.mjs`, `latency.mjs`), run from this branch's `server/`, base = the live switch rows read 2026-11-27 05:20Z (74 decide options) in both arms and the option added in ON. No database. Every world counts each seat's first answers to heads-up river first bets from its own completed hands and serves them as the lifetime record, as the live packet does. bb/100 with a 2-chip big blind (the earlier Hold'em opening grades of 2026-11-25 were printed in chips/100: halve them to compare).

League mirror (every seat a Horse on the hybrid cash profile, 100 bb unless stated; each deal played twice with the ON and OFF seats swapped; one memory sandbox and one lifetime river record store per pass; bb/100 per seat):

| table                  | seed     | hands  | ON - OFF bb/100 per seat | option river bluffs |
| ---------------------- | -------- | ------ | ------------------------ | ------------------- |
| heads-up 100 bb        | 20261127 | 24,000 | +10.53 +/- 4.71          | 1,154               |
| 6-max 100 bb           | 20261127 | 12,000 | +7.39 +/- 1.76           | 530                 |
| heads-up 100 bb        | 20261128 | 24,000 | +10.51 +/- 4.49          | 1,086               |
| 6-max 100 bb           | 20261128 | 12,000 | +6.43 +/- 1.58           | 497                 |
| heads-up 300 bb        | 20261129 | 24,000 | +25.30 +/- 6.35          | 1,222               |
| 6-max 100 bb           | 20261129 | 12,000 | +7.24 +/- 1.62           | 460                 |
| heads-up 100 bb pooled | 2 seeds  | 48,000 | +10.52 +/- 3.25          |                     |
| 6-max 100 bb pooled    | 3 seeds  | 36,000 | +6.99 +/- 0.95           |                     |

Exploit probes (heads-up, 100 bb, 12,000 deals per arm on the same deals, the script in seat 0; ON - OFF differenced hand by hand; the script's river answers are served as its lifetime record, as live):

| probe        | conditions                                       | seed | Horse OFF bb/100 | Horse ON bb/100 | ON - OFF        | option river bluffs | script river record at the end (folds/answers small, big) |
| ------------ | ------------------------------------------------ | ---- | ---------------- | --------------- | --------------- | ------------------- | --------------------------------------------------------- |
| caller       | opponent memory on, lifetime record live         | 11   | +376.1 +/- 20.7  | +376.1 +/- 20.7 | -0.02 +/- 0.11  | 6                   | 0/562, 0/944                                              |
| riverstation | opponent memory on, lifetime record live         | 11   | +20.9 +/- 9.4    | +26.4 +/- 9.7   | +5.50 +/- 4.40  | 7                   | 0/365, 0/179                                              |
| overfolder   | opponent memory on, lifetime record live         | 11   | +13.7 +/- 8.1    | +45.4 +/- 8.2   | +31.73 +/- 5.63 | 595                 | 656/823, 214/265                                          |
| bluffer      | opponent memory on, lifetime record live         | 11   | +14.0 +/- 9.4    | +26.9 +/- 10.1  | +12.89 +/- 7.04 | 629                 | 244/528, 626/836                                          |
| caller       | opponent memory on, lifetime record live         | 12   | +383.0 +/- 20.5  | +374.1 +/- 20.3 | -8.85 +/- 9.50  | 3                   | 0/539, 0/1015                                             |
| riverstation | opponent memory on, lifetime record live         | 12   | +27.0 +/- 9.8    | +27.7 +/- 10.1  | +0.74 +/- 5.11  | 4                   | 0/365, 0/185                                              |
| overfolder   | opponent memory on, lifetime record live         | 12   | +28.5 +/- 8.3    | +44.4 +/- 8.2   | +15.96 +/- 5.33 | 577                 | 638/804, 218/262                                          |
| bluffer      | opponent memory on, lifetime record live         | 12   | +14.7 +/- 8.9    | +36.0 +/- 9.6   | +21.30 +/- 6.56 | 686                 | 195/386, 797/1014                                         |
| caller       | opponent memory held still, lifetime record live | 11   | +231.0 +/- 14.2  | +230.8 +/- 14.2 | -0.22 +/- 0.11  | 6                   | 0/1023, 0/770                                             |
| caller       | opponent memory held still, lifetime record live | 12   | +231.0 +/- 14.0  | +231.0 +/- 14.0 | -0.03 +/- 0.02  | 1                   | 0/1074, 0/762                                             |
| riverstation | opponent memory held still, lifetime record live | 11   | +59.8 +/- 10.3   | +59.5 +/- 10.3  | -0.27 +/- 0.11  | 8                   | 0/558, 0/290                                              |
| riverstation | opponent memory held still, lifetime record live | 12   | +30.5 +/- 10.4   | +30.5 +/- 10.4  | -0.03 +/- 0.02  | 2                   | 0/501, 0/265                                              |
| caller       | opponent memory held still, NO lifetime record   | 11   | +231.0 +/- 14.2  | +213.2 +/- 14.5 | -17.87 +/- 1.99 | 825                 | 0/1761, 0/850                                             |
| riverstation | opponent memory held still, NO lifetime record   | 11   | +59.8 +/- 10.3   | +43.8 +/- 10.6  | -15.97 +/- 1.63 | 641                 | 0/1154, 0/323                                             |
| caller       | opponent memory on, NO lifetime record           | 11   | +376.1 +/- 20.7  | +380.9 +/- 20.9 | +4.82 +/- 8.37  | 55                  | 0/597, 0/973                                              |
| riverstation | opponent memory on, NO lifetime record           | 11   | +20.9 +/- 9.4    | +18.4 +/- 9.5   | -2.56 +/- 5.40  | 192                 | 0/545, 0/175                                              |
| riverstation | opponent memory on, lifetime record live, 300 bb | 13   | +21.5 +/- 13.0   | +21.9 +/- 13.1  | +0.47 +/- 5.15  | 4                   | 0/345, 0/158                                              |
| people       | opponent memory on, lifetime record live         | 11   | +6.7 +/- 8.8     | +4.3 +/- 9.2    | -2.34 +/- 6.05  | 447                 | 396/802, 163/281                                          |
| people       | opponent memory on, lifetime record live         | 12   | +11.6 +/- 9.2    | +22.9 +/- 9.3   | +11.35 +/- 5.03 | 461                 | 419/813, 176/323                                          |
| people       | opponent memory on, lifetime record live         | 13   | +3.5 +/- 8.5     | +16.0 +/- 9.2   | +12.47 +/- 5.62 | 409                 | 348/708, 191/317                                          |
| people       | opponent memory held still, lifetime record live | 11   | +19.2 +/- 9.0    | +22.7 +/- 9.2   | +3.48 +/- 2.60  | 762                 | 648/1249, 170/300                                         |
| people       | opponent memory held still, lifetime record live | 12   | +10.0 +/- 9.7    | +13.5 +/- 10.1  | +3.52 +/- 2.45  | 755                 | 652/1237, 175/333                                         |

- caller (opponent memory on, lifetime record live), 2 seeds pooled: -0.02 +/- 0.11
- riverstation (opponent memory on, lifetime record live), 2 seeds pooled: +3.47 +/- 3.33
- overfolder (opponent memory on, lifetime record live), 2 seeds pooled: +23.41 +/- 3.87
- bluffer (opponent memory on, lifetime record live), 2 seeds pooled: +17.39 +/- 4.80
- caller (opponent memory held still, lifetime record live), 2 seeds pooled: -0.04 +/- 0.02
- riverstation (opponent memory held still, lifetime record live), 2 seeds pooled: -0.04 +/- 0.02
- people (opponent memory on, lifetime record live), 3 seeds pooled: +7.91 +/- 3.19
- people (opponent memory held still, lifetime record live), 2 seeds pooled: +3.50 +/- 1.78

Reading the probes:

- People (`people`): a responder that answers a river bet at PEOPLE's measured fold frequency for its size (33.0% under 0.4 pot, 50.0% at 0.4 to 0.7, 55.6% at 0.7 to 1.1, 58.3% above), folding its weakest hands first, calling the rest, never raising; everything else is the production Horse (`grade2.mts`). It is the nearest harness stand-in for the people the table was measured on. Direct effect (opponent memory held still, so both arms stay on the same hands): +3.48 +/- 2.60 and +3.52 +/- 2.45 bb/100 (762 and 755 bluffs in 12,000 hands; pooled +3.50 +/- 1.78). With memory on: -2.34 +/- 6.05, +11.35 +/- 5.03, +12.47 +/- 5.62 (pooled +7.91 +/- 3.19).
- Calling stations (the caller never folds to a postflop bet; the river station never folds to a river bet). With the lifetime record live the option fires 1 to 8 river bluffs in 12,000 hands and then his record prices him as what he is. With the opponent Horse's memory held still (so the two arms stay on the same hands) that direct cost is -0.22 +/- 0.11 and -0.03 +/- 0.02 bb/100 against the caller and -0.27 +/- 0.11 and -0.03 +/- 0.02 against the river station: a one-off learning cost of a few bluffs, not a rate. With memory on, the arms part after the first changed hand and the difference is the noise of two different matches (-0.02 +/- 0.11 and -8.85 +/- 9.50 on 6 and 3 bluffs; +5.50 +/- 4.40, +0.74 +/- 5.11, and +0.47 +/- 5.15 at 300 bb).
- The worst case, a station nobody has any record of and whose record never builds (no lifetime record, no memory): -17.87 +/- 1.99 (caller) and -15.97 +/- 1.63 (river station) bb/100. The record is what protects it; it is by size, lifetime, and reaches the decision whenever the option is switched. With the decayed window record alone (no lifetime record): +4.82 +/- 8.37 (55 bluffs) and -2.56 +/- 5.40 (192 bluffs).
- Over-folder +31.73 +/- 5.63 and +15.96 +/- 5.33; balanced bluffer (the production Horse that also bets the river at a balanced share) +12.89 +/- 7.04 and +21.30 +/- 6.56.
- The mirror and the bluffer probe are against today's Horses, which fold big river bets more than people do (71.0% against 55.6% at 0.7 to 1.1 pot). They show the option is not exploited by the current field; they are not the measure of its gain against people.

For comparison on the same harness, `holdemOpeningBluffIsPriced` (turn and river, his decayed record to the equilibrium anchor): mirror heads-up +20.73 +/- 4.57 bb/100 (24,000 hands), calling station +5.47 +/- 8.43.

## Replay

Real-hand replay on the two NLH cash audit sets (every exact-tier postflop decision: the deciding Horse's own cards known; hands pulled read-only with `chooser/extract.sql`, which returns no person's cards; each decision re-decided at its recorded public snapshot, live hybrid cash profile, seeds 1/7/42, the action of the majority of seeds): the daily audits' window 2026-11-24 22:00Z to 2026-11-27 05:00Z (555 decisions, 121 hands) and the hand audit of 2026-11-20 to 24 (327 decisions, 67 hands). Opponent memory as of each decision (every retained hand with a person settled before it, public columns only) and each opponent's lifetime river record by size as of each decision (the same public pull). Rows printed by the committed scorer (`server/scripts/audited-decision-replay.ts --placed`, verdict-only: a judged-bad decision is fixed only by a change to the action the audit names; a judged-correct decision that changes is newly wrong):

- Replay: fixed 8; newlyWrong 1; changed 11; unchanged 544; unjudged 2; set NLH-cash-hand-audit-2026-11-24-to-26; scorer 5302af2ab3e; source placed verdict-only; arm PPL vs off; replayed 555 of 555
- Replay: fixed 7; newlyWrong 2; changed 9; unchanged 318; unjudged 0; set NLH-cash-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm PPL vs off; replayed 327 of 327

Together: 15 fixed, 3 newly wrong, of 882 decisions. What changes (21 decisions): 16 checks the audit judged a mistake become bets where the audit's best action is a bet (13 of the 61 audited river missed bluffs, 3 other river errors), recorded cost 170 bb, of which 67 bb in 10 decisions against people; 4 checks the audit judged correct become bets, and in all four the audit's own best action is also a bet (the recorded check was inside its tolerance); 1 bet changes size. With no opponent memory and no record at all (people's prior alone) the same scorer prints 8 fixed / 0 newly wrong and 7 / 0.

The audit's strict size rule (the lane harness `rc.mjs`: the audit's best action AND a size within max(1 bb, 15% of the pot) of its best size) reads the same replay as 4 fixed, 2 newly wrong, 14 right action at another size: the audit's model prefers a pot-size river bluff, and this option bets about half pot, the size people fold the most against its price (multiplier 1.44 at 0.4 to 0.7 pot against 1.18 at 0.7 to 1.1).

Of the 61 audited river missed bluffs, 13 become bets (8 of the 33 heads-up hands and 5 of the 28 multiway hands, those heads-up by the river). Of the rest: 23 are multiway; in 17 heads-up ones the price keeps the check (`holdem_river_people_bluff_below_check`: the hand's showdown value is worth more than the bluff's margin over the error of his fold; most of these hold 0.15 to 0.40 equity in the audit's own column, and after the Horse's own turn bet people's multiplier is only about 1.2); in 4 neither blockers nor the range advantage were the Horse's (`holdem_river_people_bluff_no_edge`); in 4 the brain's own baseline bluff already bets on most seeds.

Horse strengths (the audits' correct river bets and correct calls): river bets 34, changed 1 (a size on one seed's baseline bluff); calls 82, changed 0.

Existing options on the same replay (lane harness, as-of memory; fixed / newly wrong by the action kind): `holdemRiverBluffIsPriced` 5 / 4, `holdemRiverLeadRangeIsPriced` 12 / 3, `holdemRiverBluffMultiwayIsPriced` 1 / 1, `holdemOpeningBluffIsPriced` 17 / 12 (turn and river), this option 17 / 0.

## Speed

Per-decision cost of the engine's own decide (`horseDecide`, the production options) at every heads-up river spot of league hands where the production decision is a check with nothing to call (the spots the option prices), OFF and ON on the same state (`l8-nlhriver/src/latency.mjs`), on the shared Mac under load (load average about 15):

| build                                                                   | stacks | spots | ON p50 / p95 / p99 / max ms | OFF p50 / p95 / p99 / max ms | added p50 / p95 / max ms |
| ----------------------------------------------------------------------- | ------ | ----- | --------------------------- | ---------------------------- | ------------------------ |
| compiled (the engine image compile, `tsc --project tsconfig.emit.json`) | 100 bb | 628   | 1.17 / 2.23 / 3.05 / 5.12   | 0.66 / 1.74 / 2.43 / 3.53    | 0.21 / 1.27 / 3.47       |
| compiled                                                                | 300 bb | 626   | 1.17 / 2.31 / 3.36 / 8.50   | 0.66 / 1.77 / 3.09 / 3.76    | 0.21 / 1.22 / 6.32       |
| source (tsx)                                                            | 100 bb | 628   | 1.17 / 2.05 / 2.34 / 2.83   | 0.74 / 1.66 / 1.86 / 2.11    | 0.16 / 1.17 / 2.17       |
| source (tsx)                                                            | 300 bb | 626   | 1.17 / 2.13 / 2.61 / 3.73   | 0.73 / 1.67 / 1.94 / 2.68    | 0.16 / 1.11 / 3.00       |

The stage bar is p95 at most 10 ms, max at most 25 ms, nothing over 50 ms: met on 1,254 applicable spots on each build (worst p95 2.31 ms, worst single decision 8.50 ms). Relative-cost law: `aHoldemRiverBluffIsPricedOnPeople.law.test.ts` (an applicable decision on costs 5.8 to 6.0 times the same decision off on the fixture's real nodes: 1.3 ms against 0.22 ms; limit 16).

## Limits

- Heads-up river first bets only. Multiway river spots (28 of the 61 audited river missed bluffs are multiway hands in the audit; those that are heads-up by the river are in scope) and the turn are not touched.
- Cash only: tournaments are out of scope (people's tournament river fold is measured in the same pull, 1.33 times equilibrium on 428 answers, but no tournament grade was run and no payout risk is priced here).
- The people table holds 494 answers from 2026-10-01 to 2026-11-26; its line cells are thin (the opponent-bet-the-turn line has 26 answers and reads its size cell almost unchanged). It is refit with `scripts/ops/holdem-people-river-fold-fit.mjs` as hands accrue.
- The size it bets is the size of highest priced margin on people's fold by size (usually about half pot). The audits' own model prefers a pot-size bluff (its fold prior is the fitted late-street prior, not people's measured curve by size), so by the audit's strict size rule most of the option's bets are "right action, other size".
- Against a player nobody has a river record of, it prices people's fold. A new calling station is paid one to eight bluffs until his record prices him (the direct cost in Grades); the record is lifetime, by size, and reaches the decision whenever the option is switched.
- The check's value is its showdown value (his bet behind an out-of-position check is not priced), as in `holdemOpeningBluffIsPriced`.

## Rollback

Default OFF with no switch row, so nothing is rolled back today. Once it is switched (`shadow`, then `on` with the note `authority: holdemRiverBluffIsPricedOnPeople docs/horse-option-authority.d/holdemRiverBluffIsPricedOnPeople.md sha256 <64 hex>`), roll back by switching it off: `node scripts/ops/horse-option-switch.mjs set holdemRiverBluffIsPricedOnPeople off --rollback --reason <text> --authority <ref> --changed-by <actor>`. Off is byte-identical to the base brain and stops the NLH river packet (law tests); no data migration.

Rollback triggers (any one, while it is on or in shadow): a shadow breaker trip; any `horse_decision_refused_isolated` or `phase15_execution_fallback` row; new `horse_error_log` rows tied to it; the next daily audit showing its river bets against people losing chips.
