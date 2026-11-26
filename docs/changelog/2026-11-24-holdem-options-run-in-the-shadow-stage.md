# Hold'em options can run in the live shadow stage, with a per-direction watch report (2026-11-24)

**What made it PLO-only.** Not the switch: the three Hold'em options already take `shadow` in the registry and the
database. The stage itself was PLO-only in two places of `HorseOptionShadowStage.ts`: an entry's `games` were typed
`OmahaOptionGame` (4 | 5), and `optionShadowStageInScope` classified a decision with `omahaOptionGameOf` alone, so a
hold'em decision had no stage game and a staged entry could never be in scope there. The table listed Omaha options
only, and its law test asserted `name.startsWith('omaha')`. A Hold'em option in `shadow` therefore fell back to the
inline option shadow: re-decided before the answer, skipped whenever the acted decision took over 15 ms, no breaker,
no Horse-only cap, no per-game time.

**What changed.**

- Stage games are now `4`, `5`, `nlh_cash`, `nlh_lightning`, `nlh_tournament` (`optionShadowStageGameOf`: the Omaha
  reading first, unchanged, then no-limit hold'em with two hole cards, one board, no bomb pot). An Omaha entry is in
  scope exactly where it was.
- Entries for `holdemValueAndCallsArePriced` (NLH cash and Lightning, flop to river), `holdemTournamentAllInCallIsPriced`
  (NLH tournaments, every street) and `cashDefenceTrimColdCalls` (NLH cash and Lightning, preflop), one line each with
  `holdemStage(games, streets?)`.
- A staged re-decision in a hold'em game that changed the answer counts its direction:
  `option_shadow_<option>_dir_<from>_to_<to>_seen` / `_dir_size_seen` (+ `_person_seen`). Every staged re-decision
  is also timed per game: `option_shadow_stage_redecide_game_<game>`. A PLO re-decision counts the counters it
  counted before (no direction).
- Registration law `aPricedOptionDeclaresAShadowStageEntry.law.test.ts`: a registered option whose name says it is
  priced and that takes shadow or on_shadow is in `OPTION_SHADOW_STAGE` or in `OPTION_SHADOW_STAGE_UNSTAGED` with
  its reason. The options that predate the rule are listed there and keep the inline shadow.
- **No Hold'em option runs before the answer without a latency guard.** An option that is not staged still takes the
  inline shadow (re-decided before the answer); in a hold'em game that re-decision now runs under the stage's breaker
  (`option_shadow_inline_self_disabled_seen`, then `option_shadow_skipped_stage_disabled_seen`), so a slow option
  (one chooser measured up to about 0.3 s on a cold cache) holds at most one live decision per worker. PLO inline
  re-decisions are unchanged.
- Read-only watcher `scripts/ops/horse-option-shadow-watch.mjs <option> --since <ISO>` with `VERDICT=CLEAN|DIRTY`,
  for PLO and Hold'em (replaces the ad-hoc `check-plo5-flop-shadow.sh`). Unit tests:
  `tests/unit/horseOptionShadowWatch.test.ts`.
- How to register an option and run a trial: `docs/ops/horse-option-shadow-stage.md`.

**Unchanged.** The acted decision (law extended to NLH cash, Lightning and tournament), one shadow row globally, the
50 ms acted budget, the Horse-only cap, the per-minute budget, the breaker and its CPU charge, the journal (no new
record kind or field), and every decision with no shadow row (flag-off check: 0 differences). No migration: the
database already accepts `shadow` for these names. Nothing is switched on.
