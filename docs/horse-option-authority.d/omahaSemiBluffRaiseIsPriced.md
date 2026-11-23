# omahaSemiBluffRaiseIsPriced: Authority For The Live Switch

Built 2026-11-21 by lanes REPLACEMENTS-1 through REPLACEMENTS-5 (R1 v4, PLO-OWNER lead-4). Changed 2026-11-22 by PLO-OWNER lead-5 (Turn 5b) to obey the owner ruling of 2026-11-15 12:30.

Evidence NOT MET. The option stays OFF. This file does not authorize switching it on: switches are made only by the lead through the delivery path.

## Status Of The Evidence

- The R1 v4 learning-bench grade (V344, seeds `20261223`/`20261224`, criteria `3e39c6d5e756`, head `9f44cdb66afb`) was run against scripted opponents only, on the rule as it was BEFORE Turn 5b. That rule raised any hand in or out of position on price. The rule in this file does not: it raises only the combo draw in position. **The V344 grade does not apply to the rule as it is now. The current rule has no grade.**
- Evidence: NOT MET (no grade of the current rule; no result against people was ever read)
- Replay: NOT RUN (no replay of the current rule on audited production decisions is recorded)

## What It Does

PLO4/PLO5 cash (tables, and Lightning where `omahaPricedInLightning` opens it), high only, one board, no bomb pot, FLOP ONLY, facing a wager (`omahaPricedSemiBluffRaise`, `omahaSemiBluffRaisePricedFinal`, `server/src/engine/HorseOmahaPricedWiring.ts`).

Owner ruling, enforced before any price (`omahaSemiBluffRaiseHandMayRaise`): "RAISING WITH DRAWS SHOULD NEVER HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO DRAWS, NOT NAKED NUT FLUSH DRAWS".

- Out of position the rule never raises, whatever the hand and whatever the opponent's record.
- In position it may raise only the combo draw, by the one existing definition (`omahaComboDrawForRaise`: a hand below two pair with a flush draw and a straight draw of eight or more outs). A bare flush draw, a bare straight draw or wrap, a pair with a draw, a made hand and a hand with no draw are not raised by this rule.
- A flop raise that reaches the finished decision with a draw the ruling bars (`omahaDrawRaiseBarOf`: out of position, a bare flush draw, a bare straight draw) becomes the call, with the bar's own switch `omahaNoDrawRaiseOutOfPosition` on or off. It is never kept on price.

For the combo draw in position, the price decides. The raise is made only where its expected value at the best legal pot-limit size beats the better of the call and the fold by more than its uncertainty:

- equity is counted against the range that continues at each size, conditioned on the opponent having bet the flop;
- the opponent's fold is his lifetime public fold-to-raise (`hudStat` `f.fRaise`), shrunk to the population as n / (n + k), with no cliff; his re-raise is `f.rRaise`, shrunk the same way; with no HUD provider installed every opponent is the population exactly;
- the proof is the sample's standard error plus the standard error of his fold rate;
- one or two opponents, none all in; any other spot is not raised.

With the option on, the brain's two legacy semi-bluff frequency sites in `HorseLogic` never raise on the flop (the roll is still drawn, in its order, and does not decide). The price is consulted once, on the finished decision, wherever a call or a fold faces a flop bet with a legal raise.

The rule reads the Horse's own cards, the board, the seats, the pot and each opponent's public lifetime record by user id. It reads no unshown hole card and no person-versus-Horse key. PLO6, PLO8, hold'em, tournaments and bomb pots are untouched.

Receipts: `omaha_semibluff_raise_priced_raise`, `omaha_semibluff_raise_priced_no_raise`, `omaha_semibluff_raise_priced_fold_measured`, `omaha_semibluff_raise_priced_unpriced_no_raise`, `omaha_semibluff_raise_priced_owner_ruling_no_raise`.

Default OFF in source (read `=== true`). Registered in the option switch; scopable per game (`horse.omahaGameScope.omahaSemiBluffRaiseIsPriced`).

## What Was Measured

- Law test `HorseOmahaSemiBluffRaiseObeysTheDrawRuling.law.test.ts` (Turn 5b): with the option on, 0 raises of an out-of-position draw against an unread opponent and against 50%, 90% and 99% folders, with the owner's bar switch on and off; in position 0 raises of a bare flush draw or bare straight draw; the option adds a raise only with the combo draw in position.
- Law test `HorseOmahaSemiBluffRaiseIsPriced.law.test.ts`: off identical; PLO6, hi-lo, bomb pots, hold'em and tournaments out of scope; every raise priced and pot-limit legal; one spot gives one verdict whatever the roll.
- Bench: the V344 grade above, of the earlier rule, against scripted opponents; it does not grade this rule.
