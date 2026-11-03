# Fix `legacy-engine-checkpoint.mjs` Native Census Memory Headroom Descriptor Lookup

## Summary

- **Root Cause**: In `server/scripts/legacy-engine-checkpoint.mjs`, `loadNativeCensus` evaluates `loadLegacyNativeCensus(custodyIntent.nativeCensus)` via `Runtime.evaluate` without `returnByValue: true` so `nativeArtifact` is retained as a CDP `RemoteObject` handle (`{ type: 'object', objectId: '...' }`). Reading `nativeArtifact.prototypeCacheBytes` on the CDP handle returned `undefined`, causing `legacyNativeCensusMemoryAdmission(memory.value, undefined)` to return `null` and fail cutover with `"native census memory headroom refused"`.
- **Fix**: Pass `custodyIntent.nativeCensus.prototypeCacheBytes` (already verified inside `loadLegacyNativeCensus` against the manifest and native addon before `nativeArtifact` is returned) to `legacyNativeCensusMemoryAdmission`.
- **Regression Coverage**: Added source-contract assertion in `tests/operations/legacy-census-source.test.mjs` verifying `legacyNativeCensusMemoryAdmission(memory.value, custodyIntent.nativeCensus.prototypeCacheBytes)` and forbidding `nativeArtifact.prototypeCacheBytes`.
- **CI Accounting Qualification Boundary Fixes**:
  - Updated `scripts/verification-harness/horse-legacy-test-learning-purge.py` default `observed` timestamp from `1791068400000` (`2026-10-03T23:00:00Z`) to `1791158390000` (`2026-10-04T23:59:50Z`), keeping legacy test observations below the `1791158399999` purge cutoff while remaining within the 30-day (`2592000000` ms) `fn_append_horse_adaptive_observations` window.
  - Updated `scripts/ci/test-cashier-conservation-sealed-days-postgres.py` (`pressure-fixture`) so the 500 unsealed "today" legs are stamped forward from today's UTC midnight (`((now() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC') + (i*interval '1 millisecond')`) instead of `now() - (i*interval '1 second')`, preventing runs within the first 500 seconds after `00:00:00Z` from spilling rows into yesterday and sealing them.
