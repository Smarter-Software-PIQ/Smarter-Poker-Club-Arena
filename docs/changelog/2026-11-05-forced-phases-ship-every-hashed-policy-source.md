# Forced phases ship every hashed policy source (2026-11-05)

## What the horses lost

On Oct 26 Dan ordered "FORCE ACTIVATE EVERY PHASE NOW WITHOUT QUALIFYING"
(#8182). From then until Nov 5 01:56Z phases 8, 10, 11, 12, 13 and 14 made
live decisions on the owner's authority: on the last day of release eed06fe5
the receipts read phase12_applied 36,288, phase13_applied 4,622,
phase11_applied 1,081, phase10_applied 66 and phase14_execution_intended 11.

From release 67bc0e85 (Nov 5 01:57Z), and on 8017564a and 71087373 after it,
every one of those counters was zero. Every phase authority read "unselected"
at every boot, phase10_selection_none and phase13_selection_none climbed into
the hundreds of thousands, and the horses played the plain reference decision
in PLO4, PLO5/6/8, FLH, FLO8, multiway and river-correction spots while every
dashboard said the phases were still ordered on.

## Why

Each phase recomputes its policy digest at boot by hashing the exact bytes of
every file in HORSE_REFERENCE_DECISION_SOURCE_FILES (and its own list), read
from /app/<path> inside the engine image. The forced activation issues an
authority for the running code only when that digest exists; a null digest
means no authority, and the phase falls to shadow.

#8605 (merged Oct 29, first served Nov 5 01:57Z) added two paths to the hashed
list on purpose, because the native public215 kernel's bytes shape public215
decisions: native/public_hist215_wtl.cc and
scripts/build-public-hist215-native.mjs. server/Dockerfile compiled both in a
builder stage and copied only the compiled .node into the runtime image. The
serving container (71087373) holds /app/native/build and
/app/native/legacy-census and no /app/scripts at all. The first digest read
threw, every digest was null, horseOwnerForcedAuthority returned null for
every phase, and nothing recorded why: the digest readers swallowed the
missing file and the forced-activation path had no receipt for a null digest.

## Fix

- server/Dockerfile copies native/public_hist215_wtl.cc and
  scripts/build-public-hist215-native.mjs into the runtime image from the
  build context, so the digest hashes exactly the reviewed bytes on main.
  Nothing is dropped from the hashed list.
- server/src/engine/HorsePolicySourceManifest.ts is the one union of every
  path any phase digest hashes (reference, phase 8, catastrophe guard, phases
  10 to 13, the Phase 14 corrective kernel and the feature authority).
- The image build runs dist/engine/horsePolicySourcesShippedMain.js right
  after the runtime emit; an unreadable hashed path fails the build with the
  list of paths, so an image like 67bc0e85 can no longer be produced.
- At boot the engine names any unreadable hashed path (console error, error
  reporter, telemetry fire horse_policy_source_unreadable). It does not stop
  dealing; the build gate is what refuses the image.
- A null digest fires horse*owner_forced_authority_digest_unavailable and
  horse_owner_forced_authority_digest_unavailable*<phase> on every forced
  admission (Phase 14 included) and logs once per phase and variant, so the
  condition is visible in horse_brain_telemetry the day it happens.

The forced-activation semantics are unchanged: every phase still applies
without qualifying, exactly as ordered. No strategy changed.

## Law

server/src/engine/aHashedPolicySourceShipsInTheEngineImage.law.test.ts
resolves every hashed path against the Dockerfile's runtime-stage COPY set,
checks the two #8605 paths are copied from the build context, checks every
path exists in the server tree, pins the build gate's position and pins both
receipts. Adding a path to any hashed list without a matching COPY fails CI.

## Verifying the next release

/Volumes/SmarterArchives/agent-evidence/hybrid-release-20261105/forced-phases-per-release.sql
(read-only) lists phaseN_applied, phase14_execution_intended, the
selection_none counters and both new receipts per engine release from
horse_brain_flush_receipts. On the first release carrying this fix the
phaseN_applied counters must be non-zero again within the hour and the
digest_unavailable receipt must stay at zero.
