# 2026-11-09: the qualification provider's git reads are bounded

`authenticateIncrementalPlan` (`server/src/benchmark/IncrementalPressureQualification.ts`)
read git through `execFileSync` with Node's default 1 MiB `maxBuffer`. The decision-closure
binding (`plan.sourceBinding`, first used by the riverPositionDefense family 283 plan)
reads `git ls-files server`. That listing already prints 1,534,341 bytes, so the call threw
`spawnSync git ENOBUFS`.

The throw comes after provenance and lineage pass, in the plan job and in every cell's
`--prepare`. By then the held-out partition is reserved. A dispatch at that code would
therefore have burned family 283 without dealing a hand:

- a new dispatch is refused because the original run holds the partition;
- a rerun is refused because the skipped cell has no Execute step.

No CI run had reached this branch. The independent pre-dispatch review found it.

Fix: one helper, `qualificationGit`, with `QUALIFICATION_GIT_MAX_BUFFER` (256 MiB), used for
every git read in the provider.
`server/src/benchmark/IncrementalPressureQualificationGit.test.ts` proves three things:

- a raw call fails on more than 1 MiB of output, and the helper returns it;
- the real server listing reads without error;
- the provider has exactly one raw git call, and it carries the ceiling.

Mutation-checked: removing the ceiling fails all three tests.

Not changed:

- `server/scripts/feature-ablation-assemble.mjs` runs only `rev-parse`, `status` and
  `merge-base`, whose output is small. It also sits under `server/scripts`, which is a
  release-control input (`scripts/ci/read-engine-prequalification.py` `CONTROL_INPUTS`);
  editing it after the 04:30Z reservation would void that night's engine release.
- `FeatureAblationQualification.ts`'s helper also reads only small output.

Consequence: this file is in the riverPositionDefense plan's `runtimeSourceFiles`. The
plan is redrafted on the main that contains this fix before family 283 is registered
(#10132).
