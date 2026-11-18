# Omaha: a nut-class straight or flush on a paired river is priced on his range (default OFF)

Date: 2026-11-18. Lane: PAIRED-RIVER (hand audit of hand 59993188). One new option, off by default (read `=== true`): `omahaPairedBoardRiverIsPriced`. Nothing is switched on by this change.

## What was there

Hand 59993188 (PLO5 1/2 fast-table cash): a Horse re-raised aces, called a 4-bet, called the flop and the turn, made the ace-high flush on a river that paired the board and folded to a bet of 54% of the pot at a price of 26.0%, after putting in 610. Two layers folded it. The facing-bet EV counts the bettor's value bets as the strongest 19.2% of ALL five-card holdings; 23.6% of random holdings make a full house on that board, so the nut flush beat none of them. Behind it, the paired-board fold of 2026-10-25 folds anything short of a full house above a price of 0.25.

## What changed

New `server/src/engine/HorseOmahaPairedRiverPriced.ts` (pure, deterministic). With the option on, inside `omahaFacingBetEv`, for PLO4/PLO5 cash on the river, heads-up, facing the first bet of the street made by a person on a paired board with a straight or flush that only a full house or quads beats, the verdict is priced on the bettor's line-conditioned range: his preflop action (a 3-bet or 4-bet narrows him by the engine's own preflop width), what he did on the flop and the turn, the Horse's blockers, and the measured frequency with which people bet each hand class on paired rivers by share of the pot (614 recorded bets by 29 people, 30 days). EV(call) at the actual price decides, in both directions. The lead into the turn aggressor reviewed in hand 59730132 keeps its verdict. With the option unset or false every decision is identical byte for byte.

Owner rulings: the categorical fold is the owner's of 2026-10-25 ("ITS A FOLD 100% OF THE TIME"); the later ruling of 2026-11-17 ("EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS") governs where a priced verdict exists (lead's decision 2026-11-18).

## Evaluation

Declared before the run. 28 recorded decisions in scope over 30 days; 8 added calls won 37.5% at a mean price of 28.6%, mean +147 bb with a 95% interval of -83 to +417; one call removed, a winner. INSUFFICIENT (10 added calls were required) and the removed-call bar failed. A journal replay through `HorseLogic.decide` (241 paired-river decisions, 2.1 days) changed 8 decisions, none below a straight and none outside the spot, flipped hand 59993188 to a call, and found 4 added calls against people (1 win in 4): also INSUFFICIENT. The option stays off; authority file `docs/horse-option-authority.d/omahaPairedBoardRiverIsPriced.md` lists what must pass.

## Files

- `server/src/engine/HorseOmahaPairedRiverPriced.ts`, `HorseOmahaPairedRiverPriced.test.ts` (new).
- `server/src/engine/HorseOmahaFacingBetEv.ts`: one optional field on the verdict.
- `server/src/engine/HorseLogic.ts`: the option, the count memo key and the call into the new module.
- `server/src/engine/HorseDataLedger.ts`, `HorseOmahaRuleSites.ts`, `HorseReferenceDecisionSources.ts`, `server/src/benchmark/HorseLeague.ts`, `ADefaultOffFlagHasALeagueCard.law.test.ts`: the registry entries and two league cards.
- The option-switch list follow-up migration and the proof script lists (generated).
