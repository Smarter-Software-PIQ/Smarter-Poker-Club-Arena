# 2026-11-21: horseRunItTwiceIsPriced registered default OFF in the live option switch

Consolidated into the Turn 4 pre-staged switch-list branch (`coord-plo6-harm-lock-20261121`) alongside the `plo6FacingBetIsPriced` off-only harm lock.

## What changed

- `server/src/engine/HorseLogic.ts`: added `horseRunItTwiceIsPriced?: boolean` to `HorseDecideOpts` (main-thread switch, default OFF, read `=== true`, never read inside `HorseLogic.decide`).
- `server/src/engine/HorseRunItTwiceSwitch.ts`: folded in `1a0565b4cdbd`'s `pollMs = 0` + `wallClock` fix (avoiding up to 60s poll lag on activation or emergency rollback while keeping `STYLE_SWITCH_STALE_MS` staleness) and reads `opts.horseRunItTwiceIsPriced === true`.
- `server/src/engine/ServerTableEngineRunout.ts`: emits the five `horse_rit_priced_*` receipt literals explicitly so `HorseDataLedger.test.ts` statically verifies every registered receipt is fired.
- `server/src/engine/HorseDataLedger.ts` and `server/src/engine/HorseDataLedger.test.ts`: registered flag `horseRunItTwiceIsPriced` and all five receipts (`horse_rit_priced_equity_unknown`, `horse_rit_priced_owner_cut`, `horse_rit_priced_once`, `horse_rit_priced_multi`, `horse_rit_priced_three`), and added `engine/HorseRunItTwiceSwitch.ts` to `BRAIN_FILES`.
- `server/src/engine/HorseOptionSwitch.ts`: registered `horseRunItTwiceIsPriced` in `OPTION_SWITCH_RELEASE_DEFAULT_OFF`, `OPTION_SWITCH_SHADOW_REFUSED` (main-thread switch outside `HorseLogic.decide`), and `OVERRIDES` (`Programme` owner).
- `server/src/benchmark/HorseLeague.ts`: added `nlh_horse_run_it_twice_is_priced` to `UNMEASURABLE_MATCHUPS` (league never offers run-it-twice and `RUN_IT_TWICE_EV_GAP_BB = 0`).
- `docs/horse-option-authority.d/horseRunItTwiceIsPriced.md`: renamed from `horseRunItTwiceIsPriced.UNREGISTERED.md`, updated state line (still `Evidence NOT MET`, `- Replay: NOT RUN` intact).
- `server/src/engine/HorseRunItTwicePriced.test.ts`: folded in `1a0565b4cdbd`'s lane and `ServerTableEngineRunout` wiring tests and verified registered `on`/`off` zero-poll-lag transitions and fail-safe OFF behavior.
- `supabase/migrations/20261121234955_horse_option_switch_turn4_train.sql` and `scripts/ci/test-horse-option-switch-evidence-postgres.sh`: regenerated with `gen-horse-option-switch-sql.ts --follow-up` (7 style, 349 other options, 57 off-only).

## What did not change

No switch row was written. `horseRunItTwiceIsPriced` stays default OFF in source until switched on by the Horse SWITCH lane after cutover.
