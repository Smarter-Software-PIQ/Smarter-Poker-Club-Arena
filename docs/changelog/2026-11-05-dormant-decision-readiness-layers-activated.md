# The Dormant Decision Readiness Layers Are Live

Dan's order: the horses must use every tool, skill and ability that was built, in real time, with an active decision process on every hand and every street. The fleet activation audit of release 71087373 found three merged layers that no live decision ever reached. This change wires the ones that can be wired into the live decision path, leaves a receipt for each so activation can be proven from `horse_brain_telemetry`, pins the wiring with a law test, and records exactly why the rest stays as it was.

## What Was Dormant

1. Decision Readiness Phase 2 (#9351, Items 21 and 23): `computeContinuationContenderFingerprint` and `evaluateMultiStreetBarrelContinuation` in `HorseContinuationPlanInvalidation.ts` had no caller outside their unit test.
2. Decision Readiness Phase 3 (#9351, Item 12): `decayAndAddOpportunityScoped` in `HorseOpponentExploit.ts` was only reached when `observeExploitRow` or `mergeExploitRows` received `opportunityScoped = true`, and the two live callers in `HorseMind.ts` never passed it. `blendOpponentMemoryWithExpiry` and `computeDonorHandClockStaleness` in `HorseOpponentMemory.ts` had no caller.
3. The #9197 modules `HorseRareOpportunityMemory.ts` and `HorseWholeHandLossAttribution.ts` are imported by no live file. See the section on what stays as it was.

## What Is Live Now

### The Plan Fingerprint (Items 21 and 23)

When a horse plans a multi-street barrel (a flop or turn bluff or semi-bluff that `planBarrel` marks as a planned line), the wager that carries the plan now also records the next-street state it expects: every live contender including the horse, and the effective stack and pot once the wager is matched once. It is public information only (seat occupancy and chip counts) and it travels through the same accepted-wager effect sink as the barrel plan and the V39 outlook, so it lands only when the exact wager is accepted by the table.

On the next street, before the planned barrel can fire, the horse compares the state that actually arrived against the fingerprint with `evaluateMultiStreetBarrelContinuation`. A contender the plan never expected, a stack-to-pot exposure more than 65 percent away from the planned one, or a scare card while facing a bet withdraws the plan: the decision then runs the ordinary ladder with no planned barrel. When the street matches the plan, the card class the evaluator reports is recorded as the causality tag (`improved_on_good_card`, `continued_on_blank`, `checked_scare_card`) while V39 keeps its measured authority over good, blank and scare cards, so a blocked scare card is still the bluff it was born for.

One design point the original helpers left open was the baseline the fingerprint is taken from. Taking it before the wager would make every routine called barrel read as an exposure shift, so the baseline is the next-street state the wager expects: the pot after the single expected caller matches it and the effective stack behind that.

Flag `planFingerprint` (default on; explicit false keeps the unconditional plan). Receipts: `plan_fingerprint_recorded`, `plan_fingerprint_<reason>` and `plan_fingerprint_absent` for a plan that carried no fingerprint.

### Donor Staleness (Item 12)

`HorseMind.opponentRead` now blends a thin exact opponent row with its sibling table-size bucket through `blendOpponentMemoryWithExpiry`. The donor's weight decays with a 120-hand half-life measured on the player's own hand clock: `HorseMind` records the player's pooled observed-hand count when each durable row is imported, and the staleness is the distance from that mark to the player's current count (`computeDonorHandClockStaleness`), never a difference of two buckets' own hand counts. The donor weight also tapers linearly to nothing as the exact row approaches the twelve-hand thin line, so there is no step at twelve hands. Receipts: `opponent_memory_donor_fresh`, `opponent_memory_donor_stale`, `opponent_memory_donor_expired`.

## What Stays As It Was, And Why

0. Opportunity-scoped exploit decay (`decayAndAddOpportunityScoped`) was wired and then withdrawn in the same change. With it on, `HorseManiacPressure.law.test.ts` fails: a maniac who turns into a nit folds preflop and offers no postflop opportunity, so every opportunity-gated statistic (bet when checked to, fold to bet, river call, 3-bet) stays frozen at its maniac value and the horse keeps reading a maniac indefinitely (the law requires the read to clear within 25 hands; a nit who turns into a maniac was also read only after 14 PLO4 hands against a 12-hand pin). The registered law and the Item 12 design contradict each other, and the law registry's rule for a contradiction is that it goes to Dan, never to a third law. `HorseMind.observeExploitHand` and `mergeSandboxExploit` therefore keep the per-hand decay, with a comment saying why, and the helper stays available for that decision.
1. The durable SQL profile (`fn_horse_exploit_add` in migration 20261023183513) still decays every counter per completed hand. The in-process rule above is the one the helpers define, but the database side needs a versioned v2 profile contract (per-stat opportunity clocks and timestamps on `horse_exploit_profiles`, and a rule for the one-time legacy back-fill that decays by hand count) that no design settled. Two merged modules even disagree on it: `decayAndAddOpportunityScoped` decays by one hand factor per hand with an opportunity, while `HorseRareOpportunityMemory` decays by opportunity count with its own per-stat half-lives. Choosing one for the production trigger is a strategy decision, not wiring, so it is left for an explicit decision.
2. `HorseRareOpportunityMemory.ts` (Item 12 v2 record model) is a replacement memory model with its own serialization, expiry and per-stat half-lives. Its own header says it qualifies the v2 model while preserving the live v1 model during a transition that needs the v2 profile, read-frame and SQL contract. Making it the read authority would replace the live model; it stays a qualification module.
3. `HorseWholeHandLossAttribution.ts` (Items 32 and 33) is a post-hand benchmark summarizer. It needs per-street records (required threshold equity, bluff classification, blockers, an opponent style shift from the v2 tracker) that the live path does not produce, and it never chooses an action. It stays a benchmark tool.
4. `HorseDormantCandidateReadiness.test.ts` (Item 25) is a test with no module; it pins the seven feature-authority skills unselected, which is unchanged.
5. `ExplicitContinuationPlanV2` and `evaluateExplicitContinuationPlanV2` (the six-branch response tree in the same file) need a per-spot response table that was never authored; only the fingerprint helpers are wired.

Untouched: the Hybrid profile, the V62 opt-in (stays 0), orange-zone behaviour, Phase 14, `workerRuntime.ts`, `observerReads.ts`, the fleet and session managers and the release lane.

## Proof

`server/src/engine/HorsePlanFingerprintActivation.law.test.ts` (law `docs/laws.d/dormant-decision-readiness-layers-are-live.md`) drives each layer from `HorseLogic.decide` on a realistic hold'em hand with a pinned `decisionTimeMs`: the fingerprint is recorded on a planned flop semi-bluff with the expected contenders and chips and lands only on acceptance; the turn keeps a matching plan and decides exactly as the off arm; a third contender or a far exposure withdraws the plan (non-vacuous: seeds exist where the off arm barrels and the live arm checks); a borrowed bucket is fresh at import, stale after twenty observed hands and fresh again after a re-import. The opponent-exploit neutrality law gets the usual off arm for the recorded corpus. `scripts/horse-measure/sql/activation.sql` carries the new receipt rows.
