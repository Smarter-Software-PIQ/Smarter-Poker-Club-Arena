# The Horse Upgrade Manifest Declares What A Decision Runs, And A Law Holds The Two Equal

The upgrade activation manifest (`HorseUpgradeActivationManifest`, published on the engine's `/health` and compared between the host and each decision worker) says in which variants and modes each upgrade runs. The style matrix law of 2026-11-13 found it wrong and could only pin the errors. This corrects the declaration. No strategy code changed: no variant condition was added to or removed from `HorseLogic` or the remaining-variant pack.

Declaration and tests only: no decision, wager, think time, queue or deadline changes.

## What Changed

| Upgrade                                        | Before                                             | After                                                                                  |
| ---------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `upgrade_02_card_removal_blockers` variants    | nlh, plo4, plo5, plo6, plo8, short_deck, pineapple | all nine (adds flo8 and flh)                                                           |
| `upgrade_12_specialty_variants` variants       | plo8, flo8, short_deck, pineapple                  | plo8, flo8, flh, short_deck, pineapple                                                 |
| `upgrade_12_specialty_variants` runtimeSurface | `HorseEval,HorseLogic,ServerTableEngineRunout`     | adds `RemainingVariantLivePolicy`                                                      |
| `upgrade_12_specialty_variants` exceptions     | none (field did not exist)                         | pineapple, tournament, `RemainingVariantLivePolicy`, `pineapple_tournament_unapproved` |

- Upgrade 02. The postflop brain scores card removal with no variant condition (`HorseLogic`, the `upgrade02_card_removal_scored` fire), and the score is consumed in the fixed-limit games, not only computed: the continuation plan reads its certified nut blocker for every variant, and the EV engine branch for the games with no solver (Omaha, Short Deck, Pineapple and fixed limit, with fixed limit's single size) takes its fold-equity delta. Execution was wider than the declaration.
- Upgrade 12, FLH. Found while building the law, not in the original report: FLH is one of the four games the remaining-variant pack decides (`HORSE_PHASE12_VARIANTS`), and the upgrade's own evidence counters (`phase12_seen`, `phase12_fired`) fire on every FLH decision in both modes. Execution was wider than the declaration.
- Upgrade 12, Pineapple tournaments. The pack is consulted there and refuses (`pineapple_tournament_unapproved`); the reference brain decides. The cell stays declared, because the rest of the surface runs, and the refusal is now stated in a new optional entry field, `exceptions` (variant, mode, the member of the runtime surface that refuses, its reason). Pineapple has no tournament format in the catalog, so this cell exists in the engine only.

## Schema, Version And Digest

- The schema name (`horse-upgrade-activation-manifest-v1`) and the version (`2026-11-11.v1`) are unchanged. `exceptions` is an optional addition on an entry; `isValidHorseUpgradeActivationManifest` and `verifyWorkerUpgradeManifestCompatibility` do not read entry fields and accept it as they are. Nothing in the code requires a version bump when a declaration changes, and the version has not moved since the manifest was introduced.
- The manifest digest changes, because the entries are part of the digested payload. That is no new event: the digest also covers the source revision, so it already differs on every release. Host and workers compute the manifest from the same source and still compare equal. A host and a worker from different builds are refused as `worker_manifest_digest_mismatch`, exactly as before this change.
- Readers checked: the `/health` serializer and the `poker_horse_upgrade_manifest_info` metric in `GameServer` (version and digest only), the worker READY and status paths (`workerRuntime`, `client`, `lane`, `protocol`), and `server/scripts/verify-recovery-stack.sh` (top-level engine version only). No client or script reads `upgrades`, `variants` or `modes`.

## The Law

`HorseUpgradeManifestRuntimeParity.law.test.ts` deals one real flop decision per variant and mode (eighteen cells) through the production path and requires, for upgrades 01, 02, 06, 07 and for 12 in the games the pack decides, that the table of cells where the evidence counter fired equals the table of cells the manifest declares, in both directions. A declared exception must be the refusal the pack records, by name, and a pack refusal by cell must be declared. Every other enabled upgrade is named as table-dependent, so a new upgrade has to be classified.

The decision harness moved, unchanged, from `HorseStyleVariantModeMatrix.law.test.ts` into `HorseStyleVariantModeMatrix.test-support.ts` so both laws use one copy. The style matrix law's two pins of the old mismatches now assert the corrected declaration; the Pineapple tournament refusal is still asserted by its reason, and FLH joined the pack variants it checks.

## Limits, Stated

- A counter proves the upgrade's path executed for the decision, not that it changed the action.
- One heads-up flop spot per cell. A variant condition that bites only on a later street or multiway is not seen by the law.
- `variants` and `modes` mean where the code runs. An upgrade whose title names specific games (upgrade 12's title does not mention FLH) is not retitled here.
- The manifest declares Pineapple tournaments for the all-variant upgrades because the engine runs them there; the product has no such tournament.

## Regression

- `HorseUpgradeManifestRuntimeParity.law.test.ts` (34 tests). Mutations, each failing the law and then restored: FLH removed from upgrade 02's declaration; a condition excluding FLO8 added at the upgrade 02 fire in `HorseLogic`; upgrade 12's exception removed; FLH removed from upgrade 12; upgrade 07 declared for cash.
- `HorseStyleVariantModeMatrix.law.test.ts`, `HorseUpgradeLiveEvidence.law.test.ts`, `HorseUpgradeManifestPhase14Mode.test.ts`, the manifest contract and worker handshake test of `HorseActionSpaceFreedom.law.test.ts`, `Horse1000FleetActivation.test.ts`, `horseDecision/client.test.ts`, `lane.test.ts`, `workerRuntime.test.ts`, `tests/law-registry.law.test.ts`, `tests/engine-recovery-healthcheck.law.test.ts`.
