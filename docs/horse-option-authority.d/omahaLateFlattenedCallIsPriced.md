# omahaLateFlattenedCallIsPriced: Authority For The Live Switch

Built 2026-11-22 by PLO-OWNER lead-5 from the leak trace of a real losing hand (b1e6ae31). Evidence NOT MET: stays OFF. The option is registered, default off (read `=== true`), and has replay counts only: how often its spot occurs is not yet measured on live traffic. This file does not authorize switching the option on.

## What It Does

PLO4/PLO5 cash (tables and Lightning), river only.

In the wager rules the facing-bet expected-value stage (`omaha_facing_bet_ev`) judges a call or a fold; a raise passes it unjudged. A later stage, `call_large_river_boat_wager`, can flatten that raise to a call. Nothing has priced that call. In hand b1e6ae31 the Horse held fours full of twos, wanted to raise a pot-sized river bet of 91, was flattened to a call, and called against a verdict that priced the call as a fold; it lost to fours full of eights.

With the option on, exactly that call (a raise went into the EV stage, a raise went into the boat stage, the boat stage returned the call) is given the same facing-bet verdict (`omahaFacingBetEv`; `omahaLateFlattenedCallIsPricedRule` in `server/src/engine/HorseLogic.ts`): the call stands where the verdict calls and the hand folds where it does not. Where that verdict does not price the spot, the priced turn and river raise rule applies its own priced call to the same marked call (`omahaLateFlattenedCallPriced` in `server/src/engine/HorseOmahaPricedWiring.ts`). No other call, fold or raise is read or changed, and no new threshold is added.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em, every other street. Receipts `omaha_late_flattened_call_priced_kept` and `omaha_late_flattened_call_priced_folded` count how often the spot occurs and which way it goes. Scopable per game (`horse.omahaGameScope.omahaLateFlattenedCallIsPriced`); staged for shadow re-decision on the PLO4/PLO5 river.

## What Was Measured

Counts only, on decisions replayed with the production switch set of 2026-11-22 and empty opponent memory.

- Real hand b1e6ae31 (`server/src/engine/HorseOmahaNonNutNeverRaises.law.test.ts`): the river call of 91 becomes a fold on every seed; with the facing-bet verdict switched off the priced raise rule's own price folds it too. The two other real hands of the trace are not changed by this option.
- 2,400 generated PLO4/PLO5 cash turn and river decisions facing a wager (two seeds, 4,800 decisions): the spot did not occur; 0 decisions changed.
- The lead-5 state set (14,614 states of every game and format, two seeds, 29,228 decisions): the spot occurred in 1 state (PLO5 6-max river), was priced and the call was kept; 0 decisions changed.
- Risk stated by the leak trace: Horses' river calls of 60%+ pot bets with a full house won 12 of 19 (+996 bb) in the sample of 2026-11-17 to 11-23, so this must stay limited to late-flattened calls, and their live frequency must be measured in shadow before any switch-on.

## Replay

- Replay: NOT RUN (built 2026-11-22; the audited-set scorer was not run; the spot occurred once in 14,614 replayed states, so shadow receipts must measure its frequency first)
