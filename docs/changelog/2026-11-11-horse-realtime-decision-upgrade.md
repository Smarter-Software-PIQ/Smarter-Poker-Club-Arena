# Horse Real-Time Decision Engine Upgrade & 1,000-Horse Fleet Activation

Date: 2026-11-11

## Summary

Eliminates static preflop/postflop clamps, turn-pipeline drops, receipt-supersession check/fold fallbacks, pot-limit integer wager rejections, time-bank tank cancellations, and `outside_domain` authority cliffs across all supported variants (`nlh`, `plo4`, `plo5`, `plo6`, `plo8`, `flo8`, `flh`, `short_deck`, `pineapple`) and formats (`cash`, `tournament`), while activating 100% real-time solver adherence (`gtoAdherence = 1`) and EV-bounded persona individuality (`<= 0.12 BB`) across all 1,000 horses.

## Key Changes

1. **Preflop Action-Space Freedom & Side-Game Overlays**:
   - Retired `NEVER_THREE_BET` on `rundown` and `broadway_ds` (`KQJTds`, `QQKJTds`) and rescued playable `PLO5`/`PLO6` trips sub-cores (`AAAKKds`, `AAAKQJds`, `KKKQJTds`, `999876ds`) while keeping ragged `AAAxxx` at `foldAlways: true`.
   - Added `HorsePreflopOrbitState.ts` (`analyzePreflopOrbit` separating full raises from incomplete short-stack all-ins, squeeze vs cold-called 3-bet tracking, generalized straddle/kill unopened detection, and `analyzeV38CommittedPopulation` preventing 100bb isolation re-jams into uncapped prior raisers).
   - Added `HorseSideGameOverlay.ts` pricing live Seven-Deuce bounties and Full/Half Kill Pots (`effectiveBigBlind` + live killer option), plus asymmetric cover ICM bubble pressure, satellite cliffs, and PKO/KO/Mystery bounty chip equivalence (`IcmModel.ts`, `HorseTournamentUtility.ts`).
2. **Real-Time Turn Pipeline, Legalizer & Prompt Reliability**:
   - Pre-commit legalizer in `ServerTableEngineTurns.ts` and `HandController.ts` snaps wagers to `chipUnit` (`1` on Tournaments & Diamond Cash, `0.01` on cent Cash) and clamps pot-limit raises to `[minRaiseTo, maxRaiseTo]` before whole-stack shove promotion.
   - Fixed Phase 10/11/12 `responseValidation.ts` receipt supersession (`shadow_change` superseded by `wager_rules` or `corrective_policy`), eliminating `result_refused` check/fold fallbacks.
   - Preserved `THINK_TIMEBANK_SENTINEL` horse tanks across tournament auto-time-bank activation (`clearPrimaryClockPreservingHorseDecision`), bounded short-clock IPC deadlines (`decisionDeadline.ts`), prioritized `DECIDE_FAST`/`DECIDE_DISCARD` in `client.ts`, added idle `PREWARM_STREET`, purged stale pre-actions, added transient `lease_lost` retry, and wired prompt real-time horse responses for All-In Insurance and Run It Twice (`ServerTableEngineRunout.ts`).
3. **Multi-Street Dynamic Planning, Range Posteriors, Card Removal & Bomb Pots**:
   - Upgraded `HorseContinuationPlanInvalidation.ts` (`buildExplicitContinuationPlanV2`, `solveGeometricStreetSizing`, `reevaluateDynamicContinuationNode`) for live Flop -> Turn -> River re-evaluation.
   - Added `HorseActionLinePosterior.ts` (5-bucket street-by-street Bayesian opponent range capping), `HorseCardRemovalScorer.ts` (nut-flush/boat blockers vs missed-suit fold-blocker penalties), precomputed 10-triple board bitmask caching + stratified reservoir in `HorseEval.ts`, correlated 2/3-board bomb-pot scoop/quarter simulation, and stratified 2-street lookahead in `HorseEvEngine.ts`.
4. **1,000-Horse Full Fleet Activation, Strict Release Governance & Permanent CI Law Gate**:
   - Activated `gtoAdherence = 1` across all 1,000 unretired horses (`HorseHybridProfile.ts`, `HorsePersona.ts`), fast intra-session EWMA gear-shift detection (`HorseOpponentExploit.ts`), Hand #2+ stack-drift tolerance in `HorseFeatureAuthority.ts` (preserving strict fail-closed release qualification on unselected feature and tournament-flag artifacts and keeping the 32-spot `HorsePhase8Safety` sentinel intact), and fixed Diamond whole-unit `chipUnit = 1` geometry in `Plo4LivePolicy.ts` and `OmahaVariantLivePolicy.ts`.
   - Added versioned production activation contract `server/src/engine/HorseUpgradeActivationManifest.ts` verified across all 8 worker shards on `/health` and `/metrics`, permanent CI law gate `server/src/engine/HorseActionSpaceFreedom.law.test.ts` (`docs/laws.d/server-src-engine-HorseActionSpaceFreedom.md`), and cardinality-bounded Prometheus + `/health` watchcounters (`poker_horse_action_clamped_total`, `poker_horse_plan_reevaluated_total`, `poker_horse_legalizer_degraded_total`, `poker_horse_street_prewarm_total`, `poker_horse_decision_fallbacks_total`, and opportunity denominator `poker_horse_telemetry_opportunities_total`).
