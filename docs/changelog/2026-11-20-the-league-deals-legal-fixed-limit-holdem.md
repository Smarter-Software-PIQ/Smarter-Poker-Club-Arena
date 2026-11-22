# The league deals legal fixed-limit hold'em

**Date:** 2026-11-20
**Area:** nightly duplicate league (`server/src/benchmark/HorseLeague.ts`, `LeagueDecisionState.ts`)

## What was wrong

No fixed-limit Horse option could be evaluated in the repository. `HorseLeague.playHand` dealt every variant with no-limit or pot-limit betting: for `flh` and `flo8` it built no decision menu at all (`leagueActionState` returned null), validated wagers as no-limit, executed an all in for the whole stack and had no street unit and no cap. `HorseLogic` meanwhile took its fixed-limit path from the variant name. So `UNMEASURABLE_MATCHUPS` refused every fixed-limit card, correctly, and the default-off fixed-limit options had no card that could ever confirm them.

## What changed

1. **`playHand` deals fixed-limit hold'em with the engine's own rules.** The street unit (`fixedLimitBetSize`), the four-wager cap (`isFixedLimitCapped`), the single legal amount (`calculateBettingState` with its fixed-limit bounds, `validateAction`) and the capped-street substitution (`substituteOnCappedStreet`) are the functions `HandController` and `ServerTableEngineTurns` call. The brain receives the controller's menu (`leagueFixedLimitActionState`).
2. **The domain is stated and enforced.** Fixed-limit hold'em, cash, no ante, Horse seats only, stacks above 24 big blinds (the most one hand can cost, so no seat can be all in). `playHand` throws on any other fixed-limit hold'em table instead of dealing rules it does not have. `flo8` is not dealt as fixed limit: the league awards no low half, so its arms stay refused on the old path, unchanged.
3. **Proof against the real controller.** `HorseLeagueFixedLimit.test.ts` replays 240 league hands (heads-up and six-max) through a real `HandController` with the same cards and requires the same node, the same menu, every action accepted and the same settlement. `ALeagueDecisionStateIsProductions.law.test.ts` gains three fixed-limit nodes compared key by key with the request the live table sends.
4. **Two real cards.** `flh_priced_preflop` (six seats) and `flh_river_full_bet_read` (heads-up) leave the refused list for the nightly card. Measured as defined (seed 20261115, 300 pairs): 30 of 300 pairs diverged, +1.11 +/- 1.24 bb/100, and 9 of 300 pairs diverged, +1.33 +/- 1.15 bb/100. Those are not results; they show the arms no longer play identical poker.
5. **Every other fixed-limit refusal now says what is true.** The hold'em arms were re-measured on the legal game and stay refused with their own counts: a Horse mirror changes them in none or almost none of the pairs (`fixedLimitCallIsNotACommitment`: 1 of 300, and 1 of 2,000 on the Hybrid persona). The `flo8` arms say the league deals no hi-lo hand. Two ledger notes that said the league "deals no fixed limit" are corrected.
6. **`docs/horse-league-fixed-limit.md`** records the rules, the proof, every measurement and the design of what each refused arm still needs (scripted fixed-limit fields, a seeded no-limit probe history, hi-lo settlement, short stacks).

## What did not change

No option is switched on, no default moves, no migration, no live-table code. With a variant other than `flh` every league hand plays exactly as before. The two cards add work to the nightly league card only.

## Limits

- The cards are Horse mirrors. `fixedLimitCallIsNotACommitment` and `fixedLimitReadIgnoresProbes`, the two options this work set out to give a card, still have none: the first moves 1 pair in 2,000 against Horses and the second needs a no-limit probe history no single-variant card has. The design file says what to build for each.
- bb/100 is in big blinds; a fixed-limit big blind is the small bet.
- Stacks of 24 big blinds or less, antes, tournaments and field populations are refused for fixed limit, not modelled.
