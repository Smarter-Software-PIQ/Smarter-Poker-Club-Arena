# 2026-11-09: the feature-ablation assemble CLI always ends

`server/scripts/feature-ablation-assemble.mjs` ran `main(...).catch(...)` and relied on Node
exiting by itself. The locked contract it loads (`src/benchmark/FeatureAblationQualification.ts`)
imports `IncrementalPressureDevelopment.ts`, which in turn loads `src/hub/ChannelHub.ts`. Its
module-level `channelHub` starts a 30 s lobby interval in its constructor, and nothing ever
unrefs it. So `--prepare` wrote `attempt.json` and `jobs.json` and then never exited. Every
held-out cell would have sat until its 240-minute job timeout without dealing a hand, with the
partition already reserved. `--assemble` would have hung the same way, until its 30-minute
limit.

The plan job was not affected, because `featureAblationQualify.ts` closes `channelHub` in
`finally`. No provider run had ever reached `--prepare`, which is why nobody had seen this.
The independent pre-dispatch review of the family 283 registration (#10132) found it.

Fix: `finishCli(run)` settles the run, keeps any exit code it set (a rejection exits 2 with
the existing refusal message), flushes stdout and stderr, and then exits explicitly. Output
files are already written synchronously.

`server/src/scripts/featureAblationAssembleExit.test.ts` drives the real helper in a child
process after loading the same contract module. Four cases:

- the bare import is still alive at 8 s, which proves the hazard is real;
- a successful run ends with code 0;
- a rejection ends with code 2 and prints the refusal;
- an exit code the run set is kept.

Deliberately not changed:

- `src/hub/ChannelHub.ts`: it is engine runtime and part of the 336-file decision closure, so
  changing it would force another plan redraft.
- `tests/operations/*.test.mjs`: these run inside the qualification plan job itself, where a
  failure would burn the partition.

Merge timing: `server/scripts` is a release-control input
(`scripts/ci/read-engine-prequalification.py` `CONTROL_INPUTS`). This change therefore merges
only after the Nov 9 04:00 America/Chicago engine release has sealed and thawed, so it cannot
void that night's reservation.
