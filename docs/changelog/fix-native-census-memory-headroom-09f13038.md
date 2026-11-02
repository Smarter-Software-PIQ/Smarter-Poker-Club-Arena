# Fix `legacy-engine-checkpoint.mjs` Native Census Memory Headroom Descriptor Lookup

## Summary

- **Root Cause**: In `server/scripts/legacy-engine-checkpoint.mjs`, `loadNativeCensus` evaluates `loadLegacyNativeCensus(custodyIntent.nativeCensus)` via `Runtime.evaluate` without `returnByValue: true` so `nativeArtifact` is retained as a CDP `RemoteObject` handle (`{ type: 'object', objectId: '...' }`). Reading `nativeArtifact.prototypeCacheBytes` on the CDP handle returned `undefined`, causing `legacyNativeCensusMemoryAdmission(memory.value, undefined)` to return `null` and fail cutover with `"native census memory headroom refused"`.
- **Fix**: Pass `custodyIntent.nativeCensus.prototypeCacheBytes` (already verified inside `loadLegacyNativeCensus` against the manifest and native addon before `nativeArtifact` is returned) to `legacyNativeCensusMemoryAdmission`.
- **Regression Coverage**: Added source-contract assertion in `tests/operations/legacy-census-source.test.mjs` verifying `legacyNativeCensusMemoryAdmission(memory.value, custodyIntent.nativeCensus.prototypeCacheBytes)` and forbidding `nativeArtifact.prototypeCacheBytes`.
