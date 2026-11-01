# Bounded recovery wrapper groups

The db083 full-hook report timed out the aggregate recovery-request wrapper at its existing 90-second Vitest deadline. Its Python assertions were unchanged; an earlier single focused run passed in 63.454 seconds and did not reproduce that timeout.

Run the same 38 actual Python unittest methods once each through their four existing logical classes (10/15/12/1). Keep the original 90-second wrapper deadline and all Python source, assertions and 10/15-second child bounds unchanged. A collection-only actual unittest-loader check proves the selected suites are disjoint and cover the full module, so future methods cannot be silently omitted. No engine or deployment behavior changes.

Exact-candidate focused group checks, root TypeScript compilation and ordinary commit hooks are owned by the integrating parent; this prepared patch alone is not validation, delivery or live proof.
