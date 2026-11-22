# omahaSemiBluffRaiseIsPriced: Authority For The Live Switch

Built 2026-11-21 by lanes REPLACEMENTS-1 through REPLACEMENTS-5 (R1 v4, PLO-OWNER lead-4) on the owner's order that there may never be any blanket rules in the PLO4/PLO5 Horses and that a rule which loses chips when removed alone needs a priced replacement. Evidence NOT MET: the option stays OFF until live production switch approval. Formal 8-cell 224k-hand learning-bench grade (`20261223`/`20261224`, criteria `3e39c6d5e756`, head `9f44cdb66afb`) = **PASS (V344 CONFIRM)**: 56/56 active (`23,694` parted), 56/56 CTRL `0/0.000000`, `0` candidate-only Horse flags / `0` HUD refused, 7/7 GUARD-POOLED PASS (`max z = +1.6932 <= 1.971`), 56/56 GUARD-CELL PASS (`max z = +2.6321 <= 2.739`), ALL 56 IV `+1.0005 +/- 0.5985 (z = +1.6717)`, latency `0 / 4,769 (0.0000%) > 100 ms` (max `21.8 ms`, faster than OFF in all 4 formats). This file does not authorize switching the option on: switches are made only by the lead through the delivery path.

## What It Does

PLO4/PLO5 cash (tables, and Lightning where `omahaPricedInLightning` opens it), high only, one board, no bomb pot, flop only (lead ruling Nov 21 2026: one priced mechanism per street; the turn and river raise stay with `omahaTurnRiverRaiseIsPriced`), facing a wager (`omahaPricedSemiBluffRaise`, `server/src/engine/HorseOmahaPricedWiring.ts`). The brain's two semi-bluff raise sites in `HorseLogic` (the flop/turn raise and the pressure semi-bluff) rolled a frequency (bluff frequency times aggression): the legacy semi-bluff raise, a blanket rule with no switch, which answered every spot the bars `omahaNoDrawRaiseOutOfPosition` and `v74OmahaSemiBluffNeedsDraw` released. With the option on the roll never decides (it is still drawn, in its order). The raise is made only where its expected value at the pot-limit legal size of highest value beats the better of the call and the fold by more than its uncertainty:

- equity is sampled against the range that continues at each size;
- the opponent's fold is his lifetime public fold-to-raise at the price laid, shrunk to the population as (hits + prior x k) / (opportunities + k), with no cliff;
- the proof is the sample's standard error plus the standard error of his fold rate, 0.5 / sqrt(opportunities + k) of the pot;
- one or two opponents, none all in; any other spot is not raised by these sites.

No hand class, size band, position or opponent kind is read (the kind priors are forced off inside the rule; position enters only as the realisation the price already carries). The option does not touch the two bars: it stands alone, so both can go off. The entry conditions of the two sites are unchanged: they decide only where the price is consulted; outside them no semi-bluff raise is made, as before. PLO6, PLO8, hold'em, tournaments and bomb pots are untouched.

Receipts: `omaha_semibluff_raise_priced_raise`, `omaha_semibluff_raise_priced_no_raise`, `omaha_semibluff_raise_priced_unpriced_no_raise`.

Default OFF in source (read `=== true`). Registered in the option switch, switchable live; scopable per game (`horse.omahaGameScope.omahaSemiBluffRaiseIsPriced`).

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/REPLACEMENTS-1.md. Law test `HorseOmahaSemiBluffRaiseIsPriced.law.test.ts`: off identical; PLO6, hi-lo, bomb pots, hold'em and tournaments out of scope; every raise priced and pot-limit legal; the option only makes, withholds or resizes a raise; one spot gives one verdict whatever the roll. Against an unread opponent 550 consultations gave no raise; against a measured 90% folder every listed spot raised.

- Replay: NOT RUN (formal 8-cell 224k-hand learning-bench grade V344 PASS on 20261223/20261224; production live-hand audit replay pending)
- Bench: see REPLACEMENTS-1.md (development seed 20261120; grade seeds declared there before any grade run)

Correction of Nov 21 2026 (lanes REPLACEMENTS-2/-3, lead rulings): the one source of opponent reads is the lifetime HUD provider (`hudStat`: `f.fRaise`, `f.fBet`, `f.rRaise`; public actions only; shrinkage n/(n+k), no cliff); with no provider installed every opponent is the population exactly. The option is flop only. His re-raise is priced with the cell's population prior, or with the figure measured once from public hands where no packet gives one (`OMAHA_SEMIBLUFF_RERAISE_POPULATION`: PLO4 0.12, PLO5 0.13; criteria CRITERIA-REPLACEMENTS-3-RERAISE-POPULATION.md). The price is consulted once, on the finished decision, wherever a call or a fold faces a flop bet with a legal raise.
