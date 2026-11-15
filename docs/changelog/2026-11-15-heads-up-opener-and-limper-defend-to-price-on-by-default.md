# Heads-up hold'em: the opener and the limper defend to their price, on by default

Date: 2026-11-15. Lane: heads-up (HU-NLH-010, HU-NLH-011). Status: two existing Horse options change from opt-in to on by default. This changes live heads-up no-limit hold'em cash decisions once an engine release serves it. No schema change, no migration.

## Why

The heads-up audit measured two preflop folds the price does not support. The small blind that opened folded 81.0 to 92.2% of its opens to a 3-bet whose break-even is 62.5 to 66.7%, and an unread every-hand 3-bettor won +79.9 +/- 2.5 bb/100 against it at 40bb. The small blind that limped folded 99 to 100% of its limps to any raise, a min-raise laying three to one included.

#10792 built a priced fold-to-call correction for each as an opt-in option (`huOpenerDefendsToPrice`, `huLimpDefendsToPrice`) and stated that neither was proposed for activation while the owner's preflop range hold governed. Their declared evaluation then passed. The owner has now ordered every built improvement against maniac and tight opponents switched on through the normal promotion controls. This is that change for these two options, with the evidence files the default-on law requires, for independent review.

## What changed

- `HorseLogic.ts` reads both options as `!== false` instead of `=== true`. Absent is on. Explicit `false` is the off arm and gives the decisions made before the options existed. The rules, their gates and their scope are unchanged: no-limit hold'em cash, exactly two dealt in, 20 to 150bb effective, a 3-bet of 1.8x to 7x (opener) or a raise to 6bb or less (limper), not all in; never three or more dealt, tournaments, Omaha, short deck, pot limit, fixed limit, straddles, bomb pots or all-in-or-fold tables. Both rules only turn a fold into a call.
- `docs/horse-default-on.d/huOpenerDefendsToPrice.md` and `huLimpDefendsToPrice.md`: the eight evidence rows for each option.
- `HorseDataLedger.ts`: the two flag notes say default ON since 2026-11-15 and carry the evaluation figures; the two receipt notes no longer say default-off.
- `HorseLeague.ts`: the two heads-up defence cards are restated for a default-on option. Arm A is the live default and arm B sets the option explicitly false, so each card still reports option on minus option off and its sign means what it meant before.
- Comments in `HorsePreflop.ts` and `HorseHuBbDefence.ts` that said default off.

## Evidence

Full rows in the two evidence files. In short, from the declared evaluation (declaration written before any result; 24 cells of 100,000 hands; heads-up cash at 25bb and 40bb against a Horse mirror and five synthetic heads-up personas; source 2017e96d; no deviation):

- `huOpenerDefendsToPrice`: PASS, 12 of 12 cells not below -2 standard errors, lowest z -1.31. Pooled mirror -0.08 +/- 0.25 bb/100. Pooled personas +0.34 +/- 0.36, not distinguishable from zero. One clearly positive cell (wide persona, 40bb, +4.75 +/- 1.29).
- `huLimpDefendsToPrice`: PASS under the rule, but inert in 10 of 12 cells. The two min-raise persona cells are +2.07 +/- 1.68 at 25bb and +3.51 +/- 2.50 at 40bb, neither significant.

## Tests touched, and why

- `server/src/engine/HorseHeadsUpOpenerAndLimperDefendToPrice.law.test.ts`. It treated `{}` as off. Off is now both options explicitly false, and an on arm is one option true with the other false, so a difference is that option's alone. Every earlier assertion is kept against those arms (fold-to-call only, equity covers the price, the price decides, every scope negative, the receipt equals the changed final decisions). Added: absent equals explicit true for every class in every spot; the default calls what the off arm folds and differs from it only by fold to call; the default changes nothing in any out-of-scope spot; the default fires the receipt on the same hands as explicit true. The source-read assertion now requires `!== false`.
- `server/src/benchmark/ADefaultOffFlagHasALeagueCard.law.test.ts`. It asserted that the two options were default off and switched on by a card. They are no longer default off, so those four lines are replaced by a case that asserts both have left the default-off set, that their ledger notes say default ON since 2026-11-15, and that each still has exactly one heads-up card of the default-on shape (one arm unset, the other explicitly false). No other case changed.
- `server/src/benchmark/HorseLeagueHumanField.test.ts`: a comment only.
- `docs/laws.d/server-src-engine-HorseHeadsUpOpenerAndLimperDefendToPrice.md`: the law's one-line statement.

No pinned decision, digest or frozen corpus needed a change. The targeted run at this tree (55 server test files: the heads-up laws and sweeps, the league card and schedule tests, the policy digest and reference-source laws, the receipt and ledger laws, the 3-bet defence and limp tests) passed without any expected value being edited, `HorseBigBlindDepthPriceSweep.law` and `HorseHeadsUpRuleScope.law` (#10735) included. The whole server suite was not run for this change.

## Limits

- Every opponent in the evaluation is a Horse mirror or a synthetic persona. No human-fitted heads-up opponent exists. Chips only, in the league harness.
- No gain is established for either option. The opener's pooled persona result is not distinguishable from zero; the limp option barely acts against this field.
- The per-node expected-value table under three stated ranges that the default-on checklist asks for was not produced; the paired evaluation stands in its place, and the evidence files say so.
- The evaluation ran on 2017e96d and was not re-run on the commit that carries the default.
- Human heads-up hold'em cash is rare in production (the lane owner's query of `hand_history`, 2026-11-13T12Z to 2026-11-15T01Z: 3 such hands, none after 2026-11-14T06:17Z), so natural confirmation against people will be slow. The rule also acts when two Horses are heads-up.
- To switch either option off, set it explicitly `false`; the law pins that this restores the earlier decisions.
