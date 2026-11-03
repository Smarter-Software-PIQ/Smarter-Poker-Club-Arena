# Fix legacy checkpoint native census memory admission and resolve pre-guard checkpoint refusals by proof

## Why

During `Auto-Deploy Hetzner Engine` run `41535679597` (`1adb1eaa2c974969ef32c0330bbd3aed94e97a99`), `server/scripts/legacy-engine-checkpoint.mjs` called `legacyNativeCensusMemoryAdmission(memory.value, nativeArtifact.prototypeCacheBytes)` after `loadNativeCensus`. Because `nativeArtifact` is a CDP `RemoteObject` handle (`{ type: 'object', objectId }`) rather than the custody descriptor, `nativeArtifact.prototypeCacheBytes` evaluated to `undefined`, causing `legacyNativeCensusMemoryAdmission` to return `null` and refuse before `guardCall` (`checkpointInvoked: false, inspectorClosed: true, cleanupConnections: 0`).

## Changes

1. **`server/scripts/legacy-engine-checkpoint.mjs`**: Pass `custodyIntent.nativeCensus.prototypeCacheBytes` (already validated by `loadLegacyNativeCensus`) to `legacyNativeCensusMemoryAdmission`.
2. **`server/scripts/engine-release-seal.py` & `scripts/ci/read-scoped-release-recovery.py`**: Resolve any unpinned expired routine owner (`preguard-checkpoint-refusal-proved`) that bound a window, wrote its one-shot `.legacy-checkpoint-intent`, and refused before `guardCall` (`checkpointInvoked: false, inspectorClosed: true, cleanupConnections: 0`), once its window has expired, its owned v3 thaw is recorded in `engine_maintenance_thaws`, the serving runtime is idle/unfrozen with Inspector closed, and all active units/requests/holds are absent.
3. **Regression Tests**: Added coverage in `tests/operations/legacy-census-source.test.mjs` and `tests/operations/terminal-failed-routine-owner.py`.
