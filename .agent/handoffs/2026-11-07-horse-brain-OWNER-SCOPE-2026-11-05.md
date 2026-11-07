# Owner scope of work, supplied 2026-11-05 (verbatim, reflowed only)

Continue the existing Horse Brain, Hold’em Brain, PLO Brain, Hybrid, and Decision Readiness work through completion.
My objective is that ALL 1,000 horses have the complete applicable production capability set available, with the intended skills enabled, correctly connected, authorized to influence decisions, and proved against the actual serving engine.
Complete the necessary fixes, missing configuration and artifacts, qualification where required, tests, commits, merges, deployment coordination, and production verification within this chat’s scope. Continue under the existing release controls and authorization. You already have my direction to finish this work; routine implementation decisions do not require another confirmation.
Use the following requirements as the completion standard.

## 1. Refresh the actual state and maintain ownership of this work
Start by checking the current repository, in-flight changes, serving release, worker versions, effective configuration, and latest receipts. Update the supplied report against that current evidence.
The previous release queue, deadlines, engine boot times, and “being built now” statements are historical snapshots. Verify their current status before acting.
Keep this chat focused on Horse Brain, Hold’em, PLO, Hybrid, Decision Readiness, memory, decision execution, activation evidence, and the release dependencies necessary to complete them.
Do not reopen the stopped horses-versus-humans, Free Buy tuning, or general fold-to-3-bet investigations unless a specific reproducible defect directly prevents an approved capability from working. Keep unrelated tournament accounting, withdrawals, scheduling, seating policy, and other chats’ projects outside this assignment.
Confirm the current release owner and coordinate the exact required changes through the existing authorized coordination process. Maintain one deployment owner. This chat remains responsible for verifying that its changes actually reach production.

## 2. Establish one complete, reconciled capability inventory
Build the authoritative inventory from the actual source, PR history, activation configuration, and previously approved requirements.
Cover October 22 through the current audit cutoff, including the changes completed since the report. Follow older dependencies when necessary to establish whether those capabilities work.
Give every distinct capability a stable identifier and its exact name. Expand grouped descriptions such as “the other five skills,” “nine league arms,” and partially active modules into individually accountable entries.
For each capability, record:
- Its intended behavior, source PRs/commits, and production call sites.
- Applicable variants, formats, streets, positions, stack conditions, and other eligibility rules.
- Required files, models, flags, selection artifacts, qualification records, policy digests, and serving bindings.
- Effective production authority: allowed to affect decisions, shadow only, disabled, unavailable, or otherwise restricted.
- Deployment status, worker coverage, horse coverage, and runtime evidence.
- The exact remaining blocker and next action, if any.
Separate gameplay capabilities from replay tools, tests, scorecards, and measurement infrastructure. These supporting tools matter, but they do not count as additional skills used by a horse in a hand.
Split mixed-status entries. For example, the live PLO8 outlook in #9351 does not establish that its plan fingerprints and decay components are live.
Reconcile the report’s 104 headline with its 102 grouped inventory rows and the additional partial components. Generate the totals from the inventory so that every item is counted consistently.
Keep these evidence levels separate: packaged, configured, reachable, evaluated, permitted to influence decisions, and observed influencing or contributing to committed actions.

## 3. Close every specifically identified defect
Verify and finish each of the following, using the current state rather than assuming it is still outstanding.

### Previously authorized phases and the Phase 14 river kernel
Restore the intended live authority for phases 8 and 10–14 under my existing authorization, including the Phase 14 river correction kernel.
Repair the engine-image omission of files required by the policy digest. Verify that the actual deployed image contains every required file and produces a valid digest and authority resolution on every serving worker.
Add a meaningful build or release check that catches a mismatch between the digest inputs and the packaged image.
A candidate release with missing required activation artifacts must fail readiness before receiving traffic. Preserve the healthy serving release. Make the fault explicit instead of silently downgrading the phases to shadow.
Preserve the integrity checks. Do not accept a null digest, fabricate an artifact, or relabel shadow execution as active decision authority.

### Long-term memory: #9543
Deploy and prove the memory-persistence fix.
Show that new learning continues to be written beyond the brief period after boot, can be read back, survives a controlled worker replacement or reload, and is subsequently consumed by the appropriate decision path.
Reads of previously stored information alone do not prove that current learning is being saved.
Verify the correct horse, opponent, variant, and observation boundaries, including deduplication and the distinction between independent observations and approved public notes.

### Refused tournament decisions: #9572
Replay the affected jam-to-call cases against the intended release and production configuration.
Prove that the corrected decisions pass validation and result in the correct legal action committed to the correct live turn. Confirm that the fix is present in the serving workers.

### Time-bank turns without a decision
Finish the root-cause investigation and permanent fix for the missing decisions and silent force resolutions.
Record deadline handling and the actual final action. Retain necessary emergency legal handling, with an explicit reason and origin.
A forced fold or check must remain visible as a fallback when that is what happened. Resolve the cause instead of improving the percentage through relabeling.

### Dormant Decision Readiness components
Wire the intended #9197 modules and the dormant portions of #9351 into their correct production lifecycle.
Account individually for rare-opportunity memory, whole-hand loss attribution, planning and invalidation, plan fingerprints, opportunity-scoped decay, and candidate-readiness components.
Prove that their outputs are consumed where intended. An entry counter at the start of an unused helper is insufficient.

### V82 and other unreleased work
Verify deployment and behavior of #9538, including its two- and three-handed eligibility and relevant stack boundaries.
Resolve every other “merged but not released” entry individually. Repository tooling and engine changes may have different deployment requirements; report each accurately.

### Missing receipts
Identify all twelve layers described as live without their own usage receipts, reconcile the earlier reference to eleven, and finish the evidence for each.
A receipt must describe what happened to the capability’s result, including valid no-change or precedence outcomes.

## 4. Finish the capabilities currently labeled off, unqualified, or unbound
Identify all seven feature-authority skills by exact name. Include smallPotNearNutRiverValue, riverPositionDefense, and the five unnamed skills.
Complete their missing selection files, qualification records, dependencies, and activation artifacts. Use the repository’s applicable qualification process, repair failing implementations, then enable and prove the capabilities in their intended contexts.
Missing qualification or configuration must remain assigned work. It is not a permanent explanation for leaving an intended production capability inaccessible.
Give the same individual treatment to:
- v53PloTourneyIcm and its required variant-specific qualification.
- V31 value models and the missing serving binding for the actual release.
- The Phase 8 catastrophe-guard family.
- Every other intended production capability hidden inside an “opt-in” group.
Keep the catastrophe guard separate from restoring the already authorized phases. The report says the original forced activation excluded that guard family; restoring the phases does not establish that this separate capability works.
For V62, PLO6 cash V24, tournamentFlatBump, and the nine league arms, distinguish among an implementation defect, a negative measured result, insufficient evidence, a calibration experiment, and a superseded design.
Investigate and repair intended production capabilities, then rerun the relevant evaluation against the current baseline. Preserve held-out evaluation and established integrity checks.
For a genuinely superseded, duplicate, or calibration-only implementation, document its disposition and the active replacement where applicable. Do not reclassify an unfinished production capability simply to improve the completion count.
If a capability still fails its requirements or conflicts with another approved rule, keep that item explicitly unresolved and explain the concrete problem. Do not claim that everything is active while those exceptions remain.

## 5. Verify all 1,000 horses and every serving worker
Produce a census covering every horse ID. Reconcile any difference from the expected 1,000.
For each horse, verify:
- Its stored assignment and effective runtime Hybrid profile.
- Its resolved capability set and applicable overrides.
- Its effective policy/configuration identity.
- Successful initialization and access to required artifacts.
- Actual live observations by variant and street, where available.
Verify creation, reset, assignment, recovery, and cache-refresh paths so horses cannot silently revert to retired style assignments. Preserve any approved internal components used by Hybrid while retiring the obsolete selectable styles as intended.
Check all serving workers for the expected image, configuration, artifacts, and authority. A correct worker does not establish that the entire fleet is correct.
For horses without natural gameplay, use isolated checks through the same production initialization and configuration path to establish readiness. Do not force seating, create artificial production activity, or disturb games to obtain a sample.
Report these separately:
- Configuration and capability readiness for all 1,000 horses.
- Live use by horses that actually played.
- Horses and feature situations still awaiting a natural live opportunity.
The 208 previously unobserved horses cannot inherit live-use proof from the other 792.

## 6. Prove the complete path from expected decision to committed action
Define full activation precisely: Every horse has the applicable production capability set available. Every ordinary decision passes through the required decision process. Each relevant conditional capability is evaluated, or its valid current cached result is consumed where that is the intended design.
Its result must be eligible to influence the final action, subject to documented precedence and legal constraints.
Conditional skills do not need to fire in irrelevant situations. A valid evaluation that leaves the baseline unchanged can be correct. Shadow execution, an ignored return value, and an undocumented bypass are different outcomes and must remain visible.
Establish a joined evidence chain: Expected horse turn → canonical state and legal actions → resolved profile and policy → applicable capabilities → evaluation and result consumption → final proposal → validation → engine-committed action.
Include the horse, table/event, hand, street, turn/decision identity, worker, release identity, timestamps, deadline outcome, action origin, and any fallback or override reason.
Account for:
- Eligible capabilities that were evaluated.
- Ineligible capabilities and the relevant reason.
- Evaluations that correctly made no change.
- Proposals superseded by a named higher-priority rule.
- Refused decisions.
- Expired or stale attempts.
- Timeouts and emergency actions.
- Missing results or missing receipts.
Derive coverage from expected turns, so a turn that produced no brain result cannot disappear from the denominator.
Exclude blinds and antes from ordinary decision counts. Deduplicate retries and distinguish worker attempts from unique turns and committed actions.
Reconcile the report’s different action totals, graph-completion totals, and feature counts using explicit windows and populations. Explain the incomplete tournament-context and utility counts through eligibility or actual defects.
Keep instrumentation bounded and verify its effect on decision latency. Missing telemetry is an evidence gap, not a successful decision.

## 7. Validate the approved ranges, sizing, and behavior
Verify the actual approved rules against the full state in which they apply.
Include opening ranges by position, table size, variant, format, and effective stack; ante and limper adjustments; opening sizes; 3-bet sizing and defense; shove limits; short-handed behavior; postflop discipline; and interactions with the approved owner rules.
Specifically verify the report’s applicable cash opening and 3-bet sizing rules, the tournament first-in shove limits, and the V82 facing-open zone.
Distinguish those rules by context. First-in shoves and jams facing an open are different situations. Cash and tournament requirements may differ. Hold’em rules must not accidentally override an Omaha-specific decision.
Use exact legal action menus, effective stacks, action history, cold callers, minimum raises, pot limits where applicable, and chip-grid rounding.
Replay known failure cases and test meaningful boundary conditions against the exact release image and configuration. Verify precedence when multiple rules apply to the same decision.
For live frequency comparisons, show opportunity denominators and sample limitations. A wider opening rate or higher 3-bet percentage alone does not establish correctness or stronger play.
Retain the settled findings unless fresh reproducible evidence overturns them. Keep this work focused on approved behavior and capability activation.

## 8. Ship the complete changes and verify the actual serving release
Maintain a release manifest listing every required code change, migration, configuration change, and artifact.
Complete the necessary focused tests and existing release gates. Push and merge the in-scope work, then coordinate deployment with the confirmed release owner.
Record the actual serving commit, image digest, policy/configuration identity, artifact bindings, and worker coverage.
Check inclusion of every required fix in that serving release. Track mixed-version periods explicitly and recheck activation after the rollout.
Run the memory continuation and reload proof through the controlled release process where possible, without unnecessary production restarts.
Commit, PR, merge, deployment, and runtime verification are separate milestones. Report each accurately and carry this assignment through the required runtime proof.

## 9. Complete a defined production verification window
Choose and state a sufficient post-release verification window based on the actual traffic and failure modes.
Cover the supported Hold’em and PLO paths, cash and tournament formats, Lightning where applicable, and MTTs, Spins, Sit & Go’s, and satellites where they exercise different decision paths.
Cover preflop, flop, turn, and river wherever those streets occur.
Combine production observations with controlled scenario coverage for rare situations, including all-in-or-fold behavior. Label controlled tests and real gameplay separately.
For the stated window, account for every expected decision and investigate every unexplained omission, silent shadow downgrade, erroneous refusal, deadline failure, and missing receipt.
Show that learning persists beyond boot, required artifacts remain valid, and all workers retain the intended authority.
A finite observation window establishes what was observed in that window. It does not justify a claim of permanent perfection.
Where natural live opportunities are still absent, identify the exact pending coverage and the available readiness evidence. Keep the remaining verification attached to a concrete owner and follow-up mechanism.

## 10. Deliver a final report that makes completion verifiable
Update the existing activation report with:
1. The reconciled capability inventory and its evidence-based totals.
2. Every remaining disabled, shadow-only, dormant, unqualified, unbound, defective, or undeployed capability.
3. The complete 1,000-horse readiness census and separate live-observation coverage.
4. Every serving worker’s release and activation identity.
5. Evidence that each intended production capability is connected and can affect the correct decisions.
6. Post-release decision coverage, refusals, fallbacks, timeouts, and unexplained gaps.
7. Memory write, reload, and subsequent-use evidence.
8. Validation of the approved ranges, sizing, and rule interactions.
9. Exact commits, deployment artifacts, relevant receipt examples, and reproducible evidence queries.
10. Any remaining blocker, its owner, the work already completed, and the concrete next action.
Verify that the existing daily scorecard actually runs and produces its intended result. Keep scorecard operation separate from engine activation. Reuse existing scheduled work where appropriate and report only schedules that are actually installed and verifiable.
Lead the final response with a direct answer: “Are all 1,000 horses configured to access every intended applicable production capability, and what live evidence proves those capabilities are being used?” Separate completed activation from pending natural live coverage and from unresolved defects.
Keep working through the in-scope fixes, qualification, deployment, and verification. If an external dependency prevents the final step, finish all available work and report the precise dependency with a concrete handoff.
The completion standard is that every intended production capability reaches every applicable horse through the correct decision process, with evidence connecting that process to the action the engine actually commits.

Later owner direction (2026-11-07, same programme): "I WANT YOU TO FINISH UP ANY AND ALL CURRENT THINGS THAT ARE CURRENTLY OPEN, NOT FINISHED OR STILL PENDING. MAKE SURE THAT YOU FINISH THEM UP, GET THEM FULL PUSHED AND PUBLISHED, THEN GIVE ME A MILITARY GRADE HANDOFF PROMPT FOR EVERY SINGLE THING THAT IS STILL LEFT TO DO [...] DO NOT DO ANY UN NECESSARY TESTS, OR WORK OUTSIDE OF THIS SCOPE. FINISH ANY AND ALL TASKS USING THE FASTEST, MOST EFFICiENT ROUTE. LAUNCH A SWARM IF IT WILL HELP."
