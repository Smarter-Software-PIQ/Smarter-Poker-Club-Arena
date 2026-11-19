# The window rehearsal is a required check (2026-11-18)

## Why

Incident `d2d79c4f`: PR #11303 auto-merged the moment the release freeze lifted
at 20:19 UTC. Its migration had never been installed against production's
schema because `Window migrations install against production's schema`
(`window-migrations-install-before-merge.yml`) was failing on its restore step
for every migration PR at the time, and the check was not required. The
migration carried a PL/pgSQL name clash that only fails when the function runs;
it broke every hand-manifest capture from 20:12:48 to 21:04:56 UTC.

## What changes

`main protection` (ruleset 21163380) requires the check, pinned to GitHub
Actions (integration 15368) so no other producer can satisfy it.
`scripts/ci/apply-main-ruleset.mjs` declares it in `REQUIRED_CHECKS`, which
`tests/no-merge-gate-without-a-producer.law.test.ts` checks against the job
names the workflows actually run.

## Why it cannot block an unrelated PR

- Every same-repository PR runs the job. With no migration it finishes in
  seconds with "Nothing to rehearse" and reports success.
- A fork PR skips the `scope` job, so the rehearsal is `skipped`, which a
  required check accepts.
- Measured from 19:22 to 00:47 UTC on 2026-11-18 (after `723e7baaf5` fixed the
  restore step): 33 completed runs; 24 rehearsed a migration and installed
  green, 8 had no migration and passed, 1 failed on a transient `pg_dump`
  statement timeout while capturing production's schema. Re-run the failed job
  (`env -u GH_TOKEN -u GITHUB_TOKEN gh run rerun <id> --failed`); bot re-runs
  are excluded by the workflow itself.
- A PR opened before this workflow existed has no run of it. Push to it or
  update its branch once and it reports.

## Applying the ruleset change

The live change is one added entry in `required_status_checks`:

```json
{ "context": "Window migrations install against production's schema", "integration_id": 15368 }
```

GET `repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/rulesets/21163380`,
append that entry, PUT the result back with every other field unchanged. Do not
run `apply-main-ruleset.mjs` itself: it predates the two Actions-pinned checks
(`Money trigger declaration authority`, `Weekly refusal receipt cover`) and the
squash-only merge rule, and would drop them.
