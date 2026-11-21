# omahaPreflopReadIsPricedFromLifetime: Authority For The Live Switch

Evidence NOT MET for a live switch-on: B4 six-max preflop lifetime HUD read (retiring the preflop half of `plo_opponent_presumed_aggressive`) requires its own sparring-bench + symmetric M5 person grade after LIST TRAIN, FIX-1, and HUD-9 land on `main`.

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, single board, non-bomb-pot, non-AoF, PREFLOP only, 3–6 dealt seats (`sh`). Strictly excludes heads-up (`dealt === 2`, owned by `omahaButtonOpenIsPriced`), tournaments, PLO6, and hi-lo.

With this option AND `omahaOpponentLifetimeHud` on:

1. `HorseMind.opponentRead` on 3–6 seat PLO4/PLO5 cash preflop reads each opponent's lifetime public HUD counters (`hudExploitCounters`) instead of `presumedAggressorRead` (`plo_opponent_presumed_aggressive` fires drop to 0 on 6-max preflop).
2. At the `maniac_pressure_preflop` site (`HorseLogic.ts`), whenever retiring the presumption removes a maniac-pressure width (`widened === true`), `priceOmahaPreflopHudSixMax` prices the raise against call/fold directly on six-max (`sh`) HUD cells (`hudStatIn(..., 'sh')`, exact `pf.lr` for limpers facing iso, exact `pf.bvo` for blinds facing open) with continuous `n / (n + k)` shrinkage, SRP vs 3-bet realization, zero sample cliff, zero person-vs-Horse key, and zero unshown hole cards.
3. Strictly silent (`null` -> keeps legacy width) when `pf.lr` / `pf.bvo` is missing on limped/unopened blinds, or when `raises >= 2` is owned by `omahaPreflopReraiseDefencePricedInPosition` / `omahaFourBetFoldPricedCall`.

Default OFF in source (read `=== true`). Registered in `OPTION_SWITCH_RELEASE_DEFAULT_OFF` and `OPTION_SHADOW_STAGE` (`streets: ['preflop']`, companion `omahaOpponentLifetimeHud`).

## Receipts

`opponent_hud_exploit_counters`, `opponent_hud_presumption_replaced_lifetime`, `opponent_hud_presumption_replaced_prior`, `opponent_hud_preflop_priced_{fold,call,raise}`, `opponent_hud_preflop_unpriced_legacy`.

## Rollback

Set `omahaPreflopReadIsPricedFromLifetime` off (one switch row, lead only).

- Replay: NOT RUN (awaiting DEV bench + LIST TRAIN/FIX-1/HUD-9 merge before formal grade)
