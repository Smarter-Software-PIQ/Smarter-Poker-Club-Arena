# Fix holdemTournamentAllInCallIsPriced preflop fold and raise-removal leaks

Fixes three root causes in `holdemTournamentAllInCallIsPriced` (default OFF, zero switch-list migration, zero release-control paths touched) that caused `holdem_tournament_all_in_call_priced_fold_seen` to produce `2` fixed / `44` newly wrong and removed `39` raises/raising all-ins on the HVH48-E tournament audit:

1. **Moved preflop pricing from the top of `decidePreflopV7Glue` into `holdemAllInCallReference`** (`server/src/engine/HorseLogic.ts`): previously, returning `call` or `fold` before `decidePreflopV7Glue` ran intercepted spots where the reference chose a `raise` or raising `all_in` (violating the module's own invariant: "A raise is never made or removed here: only the call and the fold"), removing `39` `OK` raises/jams (`all_in -> call` `18`, `all_in -> fold` `9`, `all_in -> raise` `6`, `raise -> call` `6`). Running in `holdemAllInCallReference` checks `holdemCallShape(decision, player, gs) === 'other'` first and leaves every raise and raising all-in untouched.
2. **Preserved exact `nashCallVsJam` (`chart_bb_defend`) answers on standard-table lone open-jams**: previously, running before `nashCallVsJam` replaced the exact Nash Push/Fold V2 equilibrium caller table with a 3,000-deal Monte Carlo + `OVERCALL_SHARE = 0.5` approximation, folding `30` `OK` Nash calls (`call -> fold`) while fixing `0`. `holdemAllInCallReference` now leaves `chart_bb_defend` decisions untouched while continuing to price all re-jams, multiway all-ins, committed stacks, All-In-Or-Fold tables, and 20-25bb jams.
3. **Required `facingAllIn` at or above `gs.currentBet` in `priceHoldemTournamentPreflopAllInCall`**: previously, `live.some((p) => p.is_all_in === true && p.bet > 0)` triggered when a short blind was posted all-in (`bet <= bb`) under a larger live non-all-in open (`gs.currentBet > p.bet`), pricing a deep-stacked call with postflop play remaining as an all-in showdown. `facingAllIn` now requires `p.bet >= gs.currentBet - 1e-9` (or `heroAllInByCall`).

## Measured impact

- **HVH48-E audited replay** (scorer `5302af2ab3e`, post-#11556 + #11622, `5356` of `10937` replayed, `0` arm errors):
  - Before: `fixed 86; newlyWrong 83; changed 302; unchanged 5054; unjudged 112` (REPLAY-6 **FAIL**)
  - After: `- Replay: fixed 80; newlyWrong 11; changed 199; unchanged 5157; unjudged 88; set HVH48-E Hold'em tournaments vs people 48h; scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 5356 of 10937` (`7.27:1`; most frequent live opponent removed `72` fixed / `10` newly wrong = `7.20:1`; REPLAY-6 **PASS**).
- **Paired league (`mtt6_holdem_tournament_all_in_call_is_priced_12bb`, 3 seeds x 6,000 pairs = 36,000 hands, mirror field, `EQUITY_GOVERNOR=off`, solver stores empty)**:
  - Before: `+3.07 +/- 0.51 bb/100`, `z = 6.03`
  - After: `+4.29 +/- 0.71` (`z = 6.05`), `+3.31 +/- 0.72` (`z = 4.58`), `+2.24 +/- 0.68` (`z = 3.31`); pooled **`+3.28 +/- 0.41 bb/100`, `z = 8.08`**, SIGNIFICANT on 3/3 seeds, `0` illegal/truncated/corrected/fallbacks.

## Verification

- Added 3 regression cases to `server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts` pinning all three fixes.
- Passed `AHoldemTournamentAllInCallIsPriced.law.test.ts`, `AReferenceNodeRuleIsAReferenceReturn.law.test.ts`, `SecondLookIsNotLive.test.ts`, `EveryHorseOptionRecordsItsReplay.law.test.ts`, and `tsc --noEmit`.
