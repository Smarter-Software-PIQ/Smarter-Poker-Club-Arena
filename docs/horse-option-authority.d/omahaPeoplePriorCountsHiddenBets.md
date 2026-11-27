# omahaPeoplePriorCountsHiddenBets: Authority For The Live Switch

Built 2026-11-27 by lead-8 lane OFA (session 013U37ba) on Dan's order of 2026-11-27 12:27 PM ("WE STILL AREN'T EVEN CLOSE TO FIXING THE OVER FOLDING BUG, AND THAT SHOULD BE YOUR NUMBER 1 PRIORITY!"). Default OFF (read `=== true`), switchable `off / shadow / on_shadow / on`, scopable per game (`horse.omahaGameScope.omahaPeoplePriorCountsHiddenBets`). **Evidence NOT MET**: the grades are pending; this file does not authorize switching the option on.

## The Defect It Answers

The people-only flop and turn cells behind omahaFlopPressureCapIsPriced and omahaFacingBetPriorIsPeopleMeasured are measured on the bets whose cards were SHOWN at showdown. Of the people's flop or turn bets that were called and not raised (Oct 27 - Nov 27, PLO4/PLO5 cash, public events only; `plo-lead7-01TLQer8/l8-ofa/out/hidden.md`), only 37-57% were shown. The rest were folded later in the hand, mucked at the showdown, or won with no showdown. For example, PLO5 turn heads-up bets of 0.7 pot and over: 329 called, of which 171 shown, 16 mucked, 47 folded later and 95 won with no showdown. The folded and mucked bets are the weak end, and the fit never sees them. Every called river bettor is shown (461 of 461), so the river is not affected.

The same bias defeats the bettor's own record, which counts only shown bets. A barreller who mucks his lost showdowns is read as value-heavy. Lane OFE, PLO5 heads-up, Horse memory on, the serving options on: a persistent air barreller who mucks wins +1.58 +/- 0.60 bb per line (out of position +2.17 +/- 0.84). The Horses fold 70% on the turn against a 45% break-even. The same bot loses -5.52 when it shows its losing hands.

## What It Does

PLO4/PLO5 cash (tables and Lightning), heads-up, inside the two existing priced verdicts (HorseOmahaPeoplePriorHidden.ts):

- **The flop (omahaFlopPressureCapIsPriced) and the turn (omahaFacingBetPriorIsPeopleMeasured).** The people cell is read from split cells, fitted per game. The flop is split by pot type: limped, single-raised, or re-raised (the pooled flop sample is mostly re-raised pots, which are value-heavy). The turn is split by line: the flop checked through, the bettor made the flop wager, or another player did.
- **How the split cells count.** Each split cell counts every hidden bet (folded later, or mucked at a showdown) as non-value, in both units: the price's value region and the record's top-20% unit. A bet won with no showdown keeps the shown mix.
- **Thin cells.** A thin split cell is blended toward the equilibrium anchor by its own n, using the existing blend with 30 pseudo-bets. It is never replaced by the pooled cell. There is no clamp on the output.
- **The bettor's own record.** HorseOmahaBetRead now also counts his hidden bets, learned from public folds and the showdown list. With the option on, the record reads shown + hidden against value, in the same unit as the corrected people share.
- **Untouched.** The river, multiway, PLO6, tournaments and hold'em are untouched. Off, every cell, share and record read is exactly today's (law test). No input reads whether a player is a person or a Horse, a name, or an account. No unshown card is read. The option never raises. Receipt: `omaha_hidden_bets_prior_read`.

## What Was Measured

Corrected people shares (fit `server/scripts/omaha-facing-bet-people-prior-fit.ts`, same 26,823-hand people-only export as the current data; generated `HorseOmahaPeoplePriorHidden.data.ts`), selected cells (shown share -> corrected, n shown + hidden):

| cell                                         | shown | corrected | n        |
| -------------------------------------------- | ----- | --------- | -------- |
| PLO5 turn HU big, bettor made the flop wager | 0.356 | 0.493     | 160 + 43 |
| PLO5 turn HU big, flop checked through       | 0.556 | 0.677     | 45 + 17  |
| PLO5 flop HU big, single-raised pot          | 0.271 | 0.571     | 70 + 49  |
| PLO5 flop HU big, re-raised pot              | 0.416 | 0.509     | 245 + 46 |
| PLO4 flop HU big, re-raised pot              | 0.286 | 0.333     | 42 + 3   |

Grades: pending (see Known Limits). They must include the first-encounter / mucking barreller, the value-only bettor, the people-calibrated responder, real-chips natural experiment in re-raised pots, the audited replay and flag-off.

## Prior anchor

- Baseline: the balanced non-value share for the price (omahaEquilibriumAnchor; three streets on the flop), the whole prior where a split cell has no bets, and the weight behind a thin one.
- Population weight: the PEOPLE-ONLY split cell (people's bets; cards people showed with mucked = false; hidden bets known only from public folds and mucks), weight n / (n + 30), n = shown + hidden; Horse play never enters; never the HUD '\*' rows.
- Own record: his own flop / turn bets of the size, shown and hidden, move the share as a Beta-binomial ratio with 8 pseudo-bets, so his own record dominates from about 8 bets, and a mucking barreller's hidden bets now count.
- No unshown cards: the fit reads only cards people showed; a hidden bet is counted from public events (a fold, a muck at the showdown), never from its cards.

## Replay

- Replay: NOT RUN (grades pending at the time of the first push, 2026-11-27)

## Known Limits

- Evidence NOT MET until the pre-registered grades in `plo-lead7-01TLQer8/l8-ofa/BUILD.md` pass.
- A hidden bet counted as non-value is the upper end: a value bet outdrawn and mucked, or a value bet folded to a later raise, is counted as non-value too. Re-raised pots (SPR / stack-off give-ups) are the cell most exposed to this; they must be graded on their own.
- The fit window is Oct 27 - Nov 26 (the current people export); refit with the same script.
