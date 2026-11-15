# huLimpDefendsToPrice (HU-NLH-011)

On by default from 2026-11-15. The option, its law, its receipt and its league card were merged opt-in as #10792 (activation PR: see the pull request that adds this file). Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). Win rates are in big blinds per 100 hands. The evaluation files named below are in the heads-up lane's evidence folder (`hu-audit-01UxDLnM/evaluation/`), not in this repository.

This option has little evidence behind it. It passed its declared rule, but it never acted in 10 of the 12 cells, and where it acted the result is positive and not significant. Read the Value and Limits rows before relying on it.

## Mechanism

Heads-up no-limit hold'em cash, preflop. The small blind limped, the big blind raised, and the action is back on the limper. `HorseLogic.ts` builds `huLimpPrice` when `opts.huLimpDefendsToPrice !== false`, one raise has been made, there is one limper and the hero did not make the raise; `huRaiserPrice('limper')` then applies the table gates (see Scope) and looks up the hand class's all-in equity against the raiser's range in `HorseHuBbDefence.HU_BB_EQUITY`. `decidePreflopV7` in `HorsePreflop.ts` reads it in the single-raise branch, after every existing call bar: the limp those bars fold calls when `equity >= huLimpRequiredEquity(pot odds)`, which is the rake-aware pot odds divided by the 0.8 realisation share.

The range the equity is read against is always the 20% reference, the narrowest column of the table. A read never widens it, because the only raise reads (raise-first-in and preflop-raise shares) count every open, and a player who opens every button need not raise every limp. An engaged raise read narrower than 20% stands the rule aside and the fold stays.

Values at one node (40bb effective, a min-raise to 2bb, reads off): 1bb to call into a pot that will be 4bb, 0.25 before rake, 0.3125 or a little more after the realisation discount. Measured on the #10792 source over all 169 hand classes through the real `HorseLogic.decide`: 109 classes call a min-raise, 38 a raise to 2.5bb, 21 a raise to 3bb, 3 a raise to 4bb, none a raise above 6bb.

What it replaces: there is no dedicated fold line. A limped hand facing a raise goes through the ordinary single-raise branch and falls off its last fold because the limp band sits below every call bar. The heads-up audit measured the small blind limping 14 to 15% of cash deals to 50bb and folding 100% of those limps to a raise to 3bb, 4bb, 6bb or all in at every depth from 17 to 150bb, 98.8% of 2,672 in play at 40bb, a min-raise laying three to one included.

The rule only turns a fold into a call. It does not change whether the hand limps, adds no limp-raise and removes no call.

## Input fidelity

No recorded production hand was replayed for this option. The evidence is of two kinds, neither of which is a replay.

- The law test sweeps synthetic two-seat states (the hero's hole cards set to each of the 169 classes, the opponent's cards dealt from the rest of the deck, cash mode, no ante, the live cash Hybrid persona) through the real `HorseLogic.decide`. Each class is put in the limped-and-raised spot whether or not the Horse would have limped it, so the class counts above are of the rule, not of hands that reach it. Opponent memory is off in most cases and on, with an empty record, in one. The table's VPIP floor, the seat's judged VPIP and the second look are not supplied.
- The declared evaluation deals whole hands through `runMatchup` in `HorseLeague.ts` with the cash Hybrid persona, the deal-seeded mood clock and memory learning on. The opponents are a Horse mirror and five synthetic heads-up personas. The league harness is not the production table engine.

The evaluation ran on commit 2017e96d. Main has moved since and the evaluation was not re-run on the commit that carries this default.

## Value

The table this row asks for, expected value of the new action against the old at each changed node under three stated opponent ranges with one of them value only, was NOT produced for this option. What exists instead is a declared paired evaluation of win rate, option on minus option off, same deals in both arms. A reviewer should weigh that substitution.

Declaration written before any result (`DECLARATION-HU-DEFENCE.md`); results in `RESULTS-HU-DEFENCE.md`. 12 cells, each 4 seeds x 12,500 pairs = 100,000 hands; 0 illegal actions, 0 truncated streets, 0 brain fallbacks; no deviation from the declaration.

| Opponent | Depth | On minus off, bb/100 |   SE |     z | Divergent pairs |
| -------- | ----- | -------------------: | ---: | ----: | --------------: |
| mirror   | 25bb  |                +0.00 | 0.00 | INERT |               0 |
| mirror   | 40bb  |                +0.00 | 0.00 | INERT |               0 |
| wide     | 25bb  |                +0.00 | 0.00 | INERT |               0 |
| wide     | 40bb  |                +0.00 | 0.00 | INERT |               0 |
| minraise | 25bb  |                +2.07 | 1.68 | +1.23 |           5,102 |
| minraise | 40bb  |                +3.51 | 2.50 | +1.40 |           6,378 |
| limp     | 25bb  |                +0.00 | 0.00 | INERT |               0 |
| limp     | 40bb  |                +0.00 | 0.00 | INERT |               0 |
| threebet | 25bb  |                +0.00 | 0.00 | INERT |               0 |
| threebet | 40bb  |                +0.00 | 0.00 | INERT |               0 |
| stab     | 25bb  |                +0.00 | 0.00 | INERT |               0 |
| stab     | 40bb  |                +0.00 | 0.00 | INERT |               0 |

The declared rule: the option passes when no cell is below -2 standard errors; a cell with zero divergent pairs is INERT, counts as not below, and is not a measurement. Result: PASS under the rule, with 10 of 12 cells inert. Only the min-raise persona cells move: +2.07 +/- 1.68 at 25bb and +3.51 +/- 2.50 at 40bb, neither significant. The pooled personas figure (+0.56 +/- 0.30) is entirely those two cells.

Sign and sensitivity: against these opponents the option almost never acts, and where it acts the result is positive but not established. There is no value-only opponent and no opponent whose raise over a limp is between 2bb and 3.5bb. The audit's own earlier measurement of a cruder rule, calling every raise of 4.5bb or less, gained nothing (-1.2 +/- 1.1); the priced rule declines most of those calls, which is consistent with that result and is not a measurement of this rule.

These are simulated win rates against synthetic opponents, not production results.

## Continuation

The rule's arithmetic depends on what happens after the call through one number, the 0.8 share of all-in equity a limped hand is taken to realise. That number is an assumption set below one on purpose (the limp band is the weakest hands the seat plays). It was not measured from recorded hands, and no continuation frequency was measured from recorded hands either.

The paired evaluation plays every hand to its end, so the two min-raise cells include what actually happened after the call against that one persona. That is the only check on the assumption.

## Reach

In the evaluation: zero divergent pairs in 10 of 12 cells; 5,102 and 6,378 divergent pairs out of 50,000 in the two min-raise persona cells. That persona raises 35% of limps, to 2bb. The Horses raise a limp to 3.5 to 4.5bb and the other personas to 3.75bb, where the price leaves few classes to call (21 at 3bb, 3 at 4bb), so between Horses the option does very little; both mirror cells were inert.

In production the reach against people is near zero so far. The lane owner's query of `hand_history` from 2026-11-13T12Z to 2026-11-15T01Z found 3 heads-up no-limit hold'em cash hands with a human in them, all before 2026-11-14T06:17Z, and 0 since. How many of those three were a raised limp is not known. How often a human raises a Horse's limp to 3bb or less is not known.

None of the changed decisions was already a call in production by construction: the option was read only on explicit true before this change and nothing in production set it.

## Scope

Gated in code to all of: no-limit hold'em (not Omaha, short deck, pot limit or fixed limit), cash, exactly two dealt in (`dealtHorseTableSize === 2`, so not blind against blind after a dealt-in button folded), the hero limped the small blind and that call is its only voluntary action, exactly one raise to 6bb or less that is not all in, 20 to 150bb effective, no straddle, no bomb pot, not an all-in-or-fold table.

Each exclusion has a decision-level case in `server/src/engine/HorseHeadsUpOpenerAndLimperDefendToPrice.law.test.ts`, swept over all 169 classes with the option on and off and again at the default: three dealt with the button folded, a tournament, four-card Omaha, short deck, fixed limit, pot-limit hold'em, an all-in raise, an all-in-or-fold table, a straddled pot, a bomb pot, a stack under 20bb, a stack over 150bb, and a raise above the cap (to 6.5bb). The law also pins that the option leaves the 3-bet-open spot alone, that a larger raise is called by strictly fewer classes, and that explicit false gives the decisions made before the option existed.

Evidence of value covers 25bb and 40bb and a raise to 2bb only. Raises of 2.5bb to 6bb and depths outside 25bb and 40bb are inside the rule and outside the evaluation.

## Visibility

`hu_limp_defends_to_price` (registered in `HorseDataLedger.ts`, owner HuDefence) fires once each time this rule's call is still the final decision. It is an occurrence counter, so a quiet day is not a fault. The law test pins that the receipt fires on exactly the classes whose final decision the option changed, at the default as well as on explicit true, and never with the option false.

## Limits

- Ten of twelve evaluation cells are inert. The evidence of value is two cells against one synthetic persona, neither significant.
- No human-fitted heads-up opponent exists. Every opponent in the evaluation is a Horse mirror or a synthetic persona.
- Chips only, in a league harness. Nothing here is a production result, and three human heads-up hold'em cash hands in two days means production will not confirm or refute it soon.
- The value row is a paired win-rate evaluation, not the per-node, three-range expected-value table the checklist asks for, and it has no value-only opponent.
- The evaluation measures only the min-raise slice, diluted by the 65% of limps that persona does not raise. It says nothing about raises of 2.5bb to 6bb.
- The 20% reference is never narrowed without an engaged read. Against an unread opponent who raises a limp only with strong hands, these calls are priced against a range wider than the truth.
- The equity table was written for an opening range and is read here as a linear raising range of the same width.
- The 0.8 realisation share is an assumption.
- The evaluation was not re-run on the commit that carries the default.
