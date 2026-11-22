# Scripted fixed-limit Omaha hi-lo league field and cards

2026-11-21, engineering worker for Antigravity Coordinator.

## Summary

Adds a dedicated scripted opponent population (`FLO8_SCRIPTED_POPULATION_ID = 'flo8_scripted_field_v1'`,
restricted to `flo8` while keeping `FIXED_LIMIT_SCRIPTED_POPULATION_ID` strictly `flh`-only) with five pure
deterministic seat policies in `server/src/benchmark/Flo8ScriptedField.ts` and nine league cards in
`FLO8_SCRIPTED_FIELD_CARDS` (`server/src/benchmark/HorseLeague.ts`) to measure the three fixed-limit Omaha
hi-lo options across favourable, stress, and value-only harm-control fields:

- Personas (`Flo8ScriptedField.ts`, zero RNG, zero `HorseMind`, using `omahaPreflopPercentile(cards, true)`,
  `scoreOmahaHi` / `scoreOmahaHiPartial`, `evaluateOmahaLowHand`):
  1. `flo8_high_barreler_v1`: 6-max multi-street high barreler for `fixedLimitHiLoLowHalfFloor`.
  2. `flo8_maniac_v1`: reuses `flhManiacPolicy` (high-heat range + harm control for `fixedLimitOmahaNoPresumption`).
  3. `flo8_tight_value_v1`: value-only and quartering harm control for all three options.
  4. `flo8_river_folder_v1`: heads-up check-to-river / river-folding field for `fixedLimitHiLoNutLowRiverBet`.
  5. `flo8_passive_caller_v1`: heads-up calling station stress test for `fixedLimitHiLoNutLowRiverBet`.
- Cards (`FLO8_SCRIPTED_FIELD_CARDS`, 9 cards total, 3 per option):
  - `flo8_hilo_low_half_floor_vs_high_barreler`, `_vs_maniac`, `_vs_tight_value` (6 seats)
  - `flo8_nut_low_river_bet_vs_river_folder`, `_vs_passive_caller`, `_vs_tight_value` (2 seats)
  - `flo8_no_omaha_presumption_vs_tight_value`, `_vs_high_barreler`, `_vs_maniac` (6 seats)
- Removed `flo8_hilo_low_half_floor` and `flo8_nut_low_river_bet` from `UNMEASURABLE_MATCHUPS`
  (`flo8_no_omaha_presumption` was already promoted in `0f9d39a0571b`).
- Admitted `FLO8_SCRIPTED_POPULATION_ID` for `flo8` in `LeagueDecisionState.ts` and
  `HorseLeagueComputeWorkerClient.ts`.

## Verification

- Added `server/src/benchmark/HorseLeagueFlo8Field.test.ts` pinning helper accuracy, zero-RNG purity,
  persona semantics, node-by-node `HandController` menu and hi-lo settlement parity across all five
  personas, domain boundaries, and worker response validation.
- Updated `HorseLeagueFixedLimit.test.ts` and `LeagueInertMatchupsAreRetiredOrRepointed.test.ts`.
- Ran targeted unit/parity tests and `cd server && npx tsc --noEmit` (multi-seed league sims held until
  Mac load drops).
