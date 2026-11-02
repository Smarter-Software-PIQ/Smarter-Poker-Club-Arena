# Bound repeated native census prototype traversal

The original EED recovery census exceeded its 59-second transport allowance on
a roughly 3.5GB live heap. Physical checkpointing was not invoked and Inspector
cleanup remained unknown. This source change does not retry that operation or
claim that its live heap now fits.

The ABI-pinned predicate preserves the first two prototype steps, then memoizes
completed deeper walks using a fixed 8192-slot index, eight bounded probes and
at most 4096 escaped local handles. Identity hashes only select slots;
`StrictEquals` verifies every hit. Saturation and collisions use the original
walk. Proxy/context/deadline checks, marker-at-depth256 acceptance, overflow
limits and all five owner classes remain mandatory. Refused walks are not
cached. The explicit enclosing scope releases every cache pin after the call.

An additional 1MiB reserve is exported by the addon and bound through the build
manifest, artifact descriptor, native-only heap/process admission and scale
receipt. Managed result output remains 772608 bytes. Existing 32MiB cleanup,
8x process reserve, 12ms/MB estimator and 40/59-second limits remain unchanged.
The observation reader accepts both historical nine-field descriptors and the
new ten-field descriptor with its exact typed reserve.

The existing builder retains its original 32-deep handle proof and additionally
qualifies saturation, forced test-only hash collisions, bounded pins and fresh
calls. The existing native resource route runs new saturation and depth-boundary
cases; the deadline fixture uses heterogeneous prototypes to retain an actual
in-predicate refusal after memoization.

Prior isolated Mac tests passed semantic and handle-lifetime boundaries. Small
paired tests showed substantial deep/heterogeneous traversal savings, unchanged
overall shallow time and some residual shallow callback overhead. Those tests
do not qualify production heap cost, Linux delivery, cleanup or live adoption.
Integrated local qualification passed all12 bounded native cases, the original handle-scope proof and added saturation/collision/fresh-call probes, five Node source checks,23 scale-controller checks,14 startup checks,406 affected Vitest tests, both TypeScript checks and1822 source bindings. The heterogeneous deadline fixture initially refused memory before querying;100k owners plus100k distinct prototypes restored the original roughly200k-object footprint and then proved actual deadline refusal with all cleanup assertions unchanged. No production guard was relaxed.

The combined reader also preserves reviewed stage/code refusals from the current-serving kernel observation. Its169-case suite and maintained wrapper passed, with four existing platform-specific skips on Mac; Linux must execute without those skips. The diagnostic source was independently reproduced before correction and supplied by the explicitly owner-authorized BB coordination task. Protected delivery, Linux resource/full-cardinality qualification, current custody recovery and live adoption remain required.
