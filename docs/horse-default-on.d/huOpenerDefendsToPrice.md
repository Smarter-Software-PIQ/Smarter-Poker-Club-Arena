# huOpenerDefendsToPrice (HU-NLH-010)

On by default from 2026-11-15. The option, its law, its receipt and its league card were merged opt-in as #10792 (activation PR: see the pull request that adds this file). Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). Win rates are in big blinds per 100 hands. The evaluation files named below are in the heads-up lane's evidence folder (`hu-audit-01UxDLnM/evaluation/`), not in this repository.

## Mechanism

Heads-up no-limit hold'em cash, preflop. The small blind (the button) opened, the big blind 3-bet, and the action is back on the opener. `HorseLogic.ts` builds `huOpenerPrice` when `opts.huOpenerDefendsToPrice !== false`, two raises have been made, nobody limped and the hero made the first raise; `huRaiserPrice('opener')` then applies the table gates (see Scope) and looks up the hand class's all-in equity against the 3-bettor's range in `HorseHuBbDefence.HU_BB_EQUITY`. `decidePreflopV7` in `HorsePreflop.ts` reads it after its existing 3-bet call bars and under the same stack cap: a hand those bars fold calls when `equity >= huOpenerRequiredEquity(pot odds)`, which is the rake-aware pot odds divided by the 0.85 realisation share.

The range the equity is read against: the opponent read's re-raise share when the read is engaged and 20% or wider; the 20% reference (the narrowest column of the table) when there is no read; nothing when the read is narrower than 20%, in which case the rule stands aside and the fold stays.

Values at one node (40bb effective, 2.5bb open, 3-bet to 8bb, reads off): 5.5bb to call into a pot that will be 16bb, 0.344 before rake, 0.404 or a little more after the realisation discount. Measured on the #10792 source over all 169 hand classes through the real `HorseLogic.decide`: 16 classes change, each from fold to call (22 to 77, A2s to A9s, K9s, QTs); with a 3-bet to 10bb, 13; with a 3-bet to 20bb (8x, outside the 1.8x to 7x band), none.

What it replaces: with exactly two dealt in, the per-seat 3-bet defence read (V73) is never reached because it needs three or more dealt in, so the general bar decides, and it continues about the top tenth of all hands. The heads-up audit measured the opener folding 81.0 to 92.2% of its opens to a 3-bet across 17 to 150bb and four sizings, against a break-even for the 3-bettor of 62.5 to 66.7%.

The rule only turns a fold into a call. It adds no 4-bet and no jam, changes no size and removes no call. Above 20bb effective the final dominated-offsuit layer (`dominated_3bet_fold`) still folds offsuit unpaired non-AK hands facing a 3-bet of 2.5x or more, after this rule has called them.

## Input fidelity

No recorded production hand was replayed for this option. The evidence is of two kinds, neither of which is a replay.

- The law test sweeps synthetic two-seat states (the hero's hole cards set to each of the 169 classes, the opponent's cards dealt from the rest of the deck, cash mode, no ante, the live cash Hybrid persona) through the real `HorseLogic.decide`. Opponent memory is off in most cases and on, with an empty record, in one. The table's VPIP floor, the seat's judged VPIP and the second look are not supplied.
- The declared evaluation deals whole hands through `runMatchup` in `HorseLeague.ts` with the cash Hybrid persona, the deal-seeded mood clock and memory learning on, so the opponent read is the one the Horse builds from the hands of that run. The opponents are a Horse mirror and five synthetic heads-up personas. The league harness is not the production table engine.

The evaluation ran on commit 2017e96d. That source fired the opener receipt on some hands the dominated-offsuit layer later folded back; the fix (receipt only, no decision changed) was made after the run. Main has moved since and the evaluation was not re-run on the commit that carries this default.

## Value

The table this row asks for, expected value of the new action against the old at each changed node under three stated opponent ranges with one of them value only, was NOT produced for this option. What exists instead is a declared paired evaluation of win rate, option on minus option off, same deals in both arms. A reviewer should weigh that substitution.

Declaration written before any result (`DECLARATION-HU-DEFENCE.md`); results in `RESULTS-HU-DEFENCE.md`. 12 cells, each 4 seeds x 12,500 pairs = 100,000 hands; 0 illegal actions, 0 truncated streets, 0 brain fallbacks; no deviation from the declaration.

| Opponent | Depth | On minus off, bb/100 |   SE |     z | Divergent pairs |
| -------- | ----- | -------------------: | ---: | ----: | --------------: |
| mirror   | 25bb  |                +0.15 | 0.27 | +0.54 |             383 |
| mirror   | 40bb  |                -0.31 | 0.42 | -0.75 |             564 |
| wide     | 25bb  |                -0.77 | 0.83 | -0.93 |             816 |
| wide     | 40bb  |                +4.75 | 1.29 | +3.68 |           1,040 |
| minraise | 25bb  |                +0.68 | 1.30 | +0.52 |           3,172 |
| minraise | 40bb  |                +0.82 | 1.18 | +0.69 |           1,505 |
| limp     | 25bb  |                -0.43 | 0.86 | -0.50 |           1,173 |
| limp     | 40bb  |                -1.46 | 1.11 | -1.31 |           1,397 |
| threebet | 25bb  |                +0.00 | 0.10 | +0.05 |               7 |
| threebet | 40bb  |                +1.79 | 1.74 | +1.03 |           1,678 |
| stab     | 25bb  |                -0.83 | 0.85 | -0.98 |             800 |
| stab     | 40bb  |                -1.11 | 1.29 | -0.86 |           1,185 |

The declared rule: the option passes when no cell is below -2 standard errors. Result: PASS, 12 of 12 cells, lowest z -1.31. Pooled mirror (2 cells) -0.08 +/- 0.25. Pooled personas (10 cells) +0.34 +/- 0.36, which is not distinguishable from zero. One cell is clearly positive (wide persona, 40bb, +4.75 +/- 1.29). Six of the twelve cell means are negative, none significantly. The threebet 25bb cell has 7 divergent pairs and is effectively unmeasured.

Sign and sensitivity: the evaluation shows the option does not measurably lose against this field; it does not show that it wins. The nearest thing to a value-only opponent in the evidence is the mirror, whose big blind 3-bets about 9% of opens, narrower than the 20% reference the unread rule prices against; those two cells pool to -0.08 +/- 0.25. Against an opponent the Horse has read as re-raising less than 20% the rule does not act. An unread opponent who 3-bets only premium hands is the case where these calls lose most, and no cell isolates it.

The finding that motivated the option (an every-hand 3-bettor winning +79.9 +/- 2.5 against an unread Horse at 40bb) was measured before the option existed. The option's effect on that unread case was not measured in play: in the threebet cells the read engages early and the cell measures mostly the read-widened rule.

These are simulated win rates against synthetic opponents, not production results.

## Continuation

The rule's arithmetic depends on what happens after the call through one number, the 0.85 share of all-in equity the opener is taken to realise in position in a 3-bet pot. That number is an assumption set below one on purpose. It was not measured from recorded hands, and no continuation frequency (how often the 3-bettor continues on the flop, how often the opener folds later) was measured from recorded hands either.

The paired evaluation plays every hand to its end, so its win rates include what actually happened after the call against those opponents; that is the only check on the assumption, and it is against synthetic opponents.

## Reach

In the evaluation, the pairs in which the two arms played a hand differently (divergent pairs, out of 50,000 pairs per cell) are in the table above: 383 to 3,172 in every cell but one (7). The audit measured the spot itself, an opener facing a 3-bet, at 6.1% of hands at cash 40bb.

In production the reach against people is near zero so far. The lane owner's query of `hand_history` from 2026-11-13T12Z to 2026-11-15T01Z found 3 heads-up no-limit hold'em cash hands with a human in them, all before 2026-11-14T06:17Z, and 0 since. How many of those three were an opener facing a 3-bet is not known. The rule also acts when both seats are Horses; that count was not taken.

None of the changed decisions was already a call in production by construction: the option was read only on explicit true before this change and nothing in production set it.

## Scope

Gated in code to all of: no-limit hold'em (not Omaha, short deck, pot limit or fixed limit), cash, exactly two dealt in (`dealtHorseTableSize === 2`, so not blind against blind after a dealt-in button folded), the hero made the only open and that open is its only voluntary action, exactly one 3-bet of 1.8x to 7x that is not all in, no caller, 20 to 150bb effective, no straddle, no bomb pot, not an all-in-or-fold table.

Each exclusion has a decision-level case in `server/src/engine/HorseHeadsUpOpenerAndLimperDefendToPrice.law.test.ts`, swept over all 169 classes with the option on and off and again at the default: three dealt with the button folded, a tournament, four-card Omaha, short deck, fixed limit, pot-limit hold'em, an all-in raise, an all-in-or-fold table, a straddled pot, a bomb pot, a stack under 20bb, a stack over 150bb, and a 3-bet outside the band (to 20bb). The law also pins that the option leaves the raised-limp spot alone and that explicit false gives the decisions made before the option existed.

Evidence of value covers 25bb and 40bb only. The rule reaches 20 to 150bb; 20 to 25bb and 40 to 150bb are inside the rule and outside the evaluation. At exactly 20bb effective the dominated-offsuit layer stands aside, so more offsuit hands are called there (31 classes against 19 at a 2bb open 3-bet to 6bb) than at 21bb and deeper; that step was not evaluated in play.

## Visibility

`hu_opener_defends_to_price` (registered in `HorseDataLedger.ts`, owner HuDefence) fires once each time this rule's call is still the final decision. It is an occurrence counter, so a quiet day is not a fault. The law test pins that the receipt fires on exactly the classes whose final decision the option changed, at the default as well as on explicit true, and never with the option false.

## Limits

- No human-fitted heads-up opponent exists. Every opponent in the evaluation is a Horse mirror or a synthetic persona.
- Chips only, in a league harness. Nothing here is a production result, and three human heads-up hold'em cash hands in two days means production will not confirm or refute it soon.
- The value row is a paired win-rate evaluation, not the per-node, three-range expected-value table the checklist asks for, and it has no value-only opponent of its own.
- The pooled persona result is +0.34 +/- 0.36: no gain is established. The case for turning it on is that it removes a measured exploit (folding 81 to 92% to a 3-bet) without a measured cost, not that it has been shown to win.
- The unread path against an every-hand 3-bettor, which is the case the finding was about, is not isolated by any cell.
- Against an unread Horse the 20% reference is wider than the Horses' real 3-bet range (about 9%); the table has no narrower column. The mirror cells measure what that costs against Horses (-0.08 +/- 0.25) and say nothing about a tight human.
- The equity table was written for an opening range and is read here as a linear 3-betting range of the same width.
- The 0.85 realisation share is an assumption.
- Depths other than 25bb and 40bb were not evaluated, and the evaluation was not re-run on the commit that carries the default.
- With 12 cells and no true effect, a cell below -2 standard errors appears by chance in about 24% of runs; the declared rule was applied as written and none appeared.
