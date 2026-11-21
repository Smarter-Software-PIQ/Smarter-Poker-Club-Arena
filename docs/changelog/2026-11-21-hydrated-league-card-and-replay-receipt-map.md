# 2026-11-21: Opt-In Hydrated League Card Runner and Replay Receipt Ledger Mapping

## Summary

1. **Opt-in solver store hydration for `horseLeagueCard.ts` and manual hosted workflow**
   - Added `--hydrate-solver-stores` to `server/src/benchmark/HorseLeagueCard.ts` and `server/src/scripts/horseLeagueCard.ts` (default OFF so offline runs stay byte-identical and require no database).
   - When `--hydrate-solver-stores` is passed, the script requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, loads GTO charts, postflop compact and V31 stores in parallel via `loadGtoCharts()`, `loadGtoPostflop()` and `loadGtoPostflopV31()` before dealing cards, prints a single factual line with the loaded store counts, and fails closed with a non-zero exit if all three return 0 rows.
   - Added `.github/workflows/horse-league-card-hydrated.yml` (manual `workflow_dispatch` only, `runs-on: ubuntu-24.04`, `environment: ci-main`, `permissions: contents: read`, shared `horse-strength-hosted-capacity` concurrency group, zero DB writes) to run a single named league card with hydrated solver stores and upload its log and `RESULT_JSON` output as an artifact.

2. **Root-cause ledger consumer mapping for `v72DefenceByOpener` and audited authority options**
   - Audited all 144 registered options with authority files in `docs/horse-option-authority.d/` against `ledgerReceiptsOfOption()` (`server/src/benchmark/ReplayArmReceipts.ts`).
   - Updated receipt `consumer` strings in `server/src/engine/HorseDataLedger.ts` where the parenthesized consumer metadata omitted the owning option name, starting with `v72_defend_vs_opener` (`v72DefenceByOpener`) and including `omahaSmallBlindSteal`, `omahaNutClassValueSize`, `omahaPreflopReraiseDefencePricedInPosition`, `omahaReraisedPositionInLightning`, `omahaFacingBetEvShownField`, `omahaFacingBetValueIsRangeRelative`, `omahaPairedBoardRiverIsPriced`, `omahaRiverBluffCatchIsPriced`, `omahaTurnCallRealizationByRunout`, `omahaMathCore` and `omahaRiverNutBlockerBluffReachable`.
   - Added regression tests in `server/src/benchmark/HorseLeagueCard.test.ts` and `server/src/benchmark/ReplayArmReceipts.test.ts`.
