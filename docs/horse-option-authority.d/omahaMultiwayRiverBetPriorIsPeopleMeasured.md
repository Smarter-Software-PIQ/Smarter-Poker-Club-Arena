# omahaMultiwayRiverBetPriorIsPeopleMeasured: Authority For The Live Switch

**State: OFF** (dark: source default OFF, no switch row; this file proposes none). It does nothing on a first encounter (next section). Built 2026-11-27 by lead-9 workers MWR, RV, RV2 and RV3 (session 01UxDLnJ) on Dan's order of 2026-11-27 4:48 PM ("#1 priority ... are the over folding bugs ... not just multiway, but also heads up"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaMultiwayRiverBetPriorIsPeopleMeasured`; compiled scope 0 = PLO4 and PLO5). It acts inside `omahaFacingBetEv`. **Evidence NOT MET**: the measurements are below and in `plo-lead7-01TLQer8/l9-river2/BUILD.md`; this file does not authorize switching the option on.

## It Does Nothing On A First Encounter

Stated first so nobody switches it on for the wrong reason. Against a bettor the Horses hold no shown river bet of, this option prices people's multiway river bets, which are value (17% in the bluff region, 118 shown bets): on 1,289 real multiway river decisions it turned no fold into a call and 13 calls into folds (worker MWR, `l9-mwriver/BUILD.md`). The multiway river over-fold against an UNKNOWN bettor (after a checked-through turn a zero-equity bluff nets PLO4 +14.4 +/- 3.1 and PLO5 +15.3 +/- 5.7 bb per bet) stays open with this option on: the Horses reach that river with bluff-catchers that would need a bluff share over one half to call, and no public evidence about an unknown bettor says that. What this option adds is the bettor's OWN record on the multiway river, which no price read before.

## The Defect It Answers

The people-measured facing-bet prior (`omahaFacingBetPriorIsPeopleMeasured`) and the bettor's own shown-bet record act heads-up only. A multiway river first bet is priced on an old constant (0.13 / 0.15 / 0.19 by size) and reads against the Horse mean: 99% of the multiway river folds in the 30-day replay come from that verdict. A bettor who keeps showing river bluffs into a field is therefore never read, and neither is one who only ever shows value.

People's own record does order their multiway river bets (people export, 247 multiway river first bets by people, record = his shown river bets of that size on earlier days): non-value share 12% (value record, 25 shown), 12%, 23% (no record), 32%, 36% (bluffy record, 14 shown).

## What It Does

PLO4/PLO5 cash (tables and Lightning, one board, high only, no bomb pot), the river, a first wager (never a raise) with another player in the hand besides the bettor (a caller, an earlier all-in or a player still to act), outside re-raised pots, inside the facing-bet verdict: the bettor's non-value share and river regions are

1. his own shown river bets of that size (the per-opponent bet read, 8 pseudo-bets), over
2. the people-only multiway river cell and regions (the cells `omahaFacingBetPriorIsPeopleMeasured` reads), over
3. the balanced share (30 pseudo-bets) where the cell is thin.

It replaces the old constant and the reads against the Horse mean for that decision. No clamp, no size rule, no identity input (person or Horse, name, account), no unshown card. It never raises: calls and folds only. Heads-up pots, re-raised pots, the flop, the turn, raises, PLO6 and tournaments are untouched. Receipts `omaha_mw_river_people_prior_priced`, `omaha_mw_river_people_prior_record_read`, `omaha_mw_river_people_prior_changed`. Staged for shadow re-decision on the river.

## What Was Measured

Real multiway river decisions (worker MWR's set: 1,289 recorded Horse decisions facing a multiway river first bet, Oct 27 to Nov 27, the deciding Horse's own cards only, seeds 1/7/42), replayed on this head with the opponent memory as of each decision AND the bet-read record as of each decision, learned from the cards PEOPLE showed (people export; a day of hands is learned only once the decision is at least two days later): the option priced 250 decisions and read a record of the bettor on 129 of them. It turned no fold into a call and 12 calls into folds. The recorded calls among those 12 realised -2.8 +/- 8.0 bb (n 9; against a person's bet -11.7 +/- 2.7, n 3): the folds it adds were not winning calls. The zero-equity bluff cells against a person's multiway river bet do not move (PLO4 all sizes +10.7 +/- 4.2 bb per bet, n 72, before and after; PLO5 +12.3 -> +12.6 +/- 8.2, n 145): today's people show value on the multiway river, so their records make the Horses fold, not call. Bar "added calls against people not significantly negative": no call is added (n 0), so the bar is met with nothing to measure.

## Fixed Harness

ON-minus-same-seed-no-op (no-op 0.00, 0 divergent deals on every card), base = the stacked head, 6-max cash, 100 bb:

| card                                                                                                             | PLO4                                     | PLO5                                      | bar            | result |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- | -------------- | ------ |
| multiway river bluffer mwp (seed 802, 16,000 deals), its bluff bb per river bet into two or more, base -> option | -3.98 +/- 1.91 -> -9.11 +/- 1.81 (n 250) | -6.93 +/- 1.91 -> -11.07 +/- 1.77 (n 168) | not > +2 SE    | PASS   |
| Horses against mwp (bb/100)                                                                                      | +3.35 +/- 1.34 (43 divergent deals)      | +2.21 +/- 0.98 (35 divergent)             |                |        |
| value-only bettor, multiway field, seeds 211 + 212 pooled (bb/100)                                               | 0.00 (0 divergent in 8,000)              | 0.00 (0 divergent in 8,000)               | >= -3.0 / -4.0 | PASS   |
| flag-off (base vs this branch)                                                                                   | 0 differences in 28,000                  |                                           | 0              | PASS   |

The value-only cards do not move because a never-bluffer's shown record is value, which the people cell already prices; the bluffer card is where the own record acts (it shows river bluffs, and the Horses call it more).

## Watch And Rollback

- Roll back (switch off) if the realised chips of the multiway river calls this option adds against people (receipt `omaha_mw_river_people_prior_changed` with a call) are below zero by 2 SE after 30 such calls.
- Roll back if any breaker, error or decision over 50 ms appears in the shadow read.

## Prior anchor

- Baseline: equilibrium. The balanced share for the price (`omahaEquilibriumAnchor`) weighs 30 pseudo-bets behind the people cell and is the whole share where the cell is unmeasured.
- Population weight: PEOPLE-ONLY shown multiway river bets (`HorseOmahaFacingBetPeoplePrior.data.ts`, multiway river cells and regions), n / (n + 30).
- Own record: his own shown river bets of that size (8 pseudo-bets) move the share and the regions in both directions; this is the part of the option that changes decisions.
- No unshown cards: the record is learned from cards shown at a showdown; at decision time the option reads the public state and the deciding Horse's own cards.

## Replay

- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 868; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm MW vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2696; unjudged 1; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm MW vs off; replayed 2697 of 2697
- Note (2026-11-27): arm MW = omahaPeoplePriorCountsHiddenBets + omahaTurnFacingBetPriorIsLineSplit + omahaHiddenBetsArePricedAsGiveUps + this option, opponent memory off (no record of any bettor); the arm without this option (BASE) gives: - Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm BASE vs off; replayed 869 of 869 / - Replay: fixed 0; newlyWrong 0; changed 1; unchanged 2696; unjudged 1; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm BASE vs off; replayed 2697 of 2697
