# The V31 pre-screen can run on its own, with the repository's own database identity

**In plain English.** The quick qualification pre-check (#10105) only ran as the first step of a full evaluation. To try it on real data, an agent copied a database key onto the Mac, which it must never do. The qualification workflow can now run the pre-check by itself (`operation: prescreen`). It uses the repository's own database secret and stops after the check: no evaluation round is opened and nothing is recorded. An optional `engine` input checks an exact earlier commit, such as an old epoch pin, so a known-bad pin can be refused on demand.

## What changed

- `.github/workflows/gto-v31-qualification.yml`:
  - The `operation` choice now includes `prescreen`.
  - There is a new optional `engine` input.
  - The plan and pre-screen steps run for `evaluate` and `prescreen`.
  - The epoch step stays `evaluate`-only.
  - The evaluator step is now explicitly `evaluate` or `recheck`, so `prescreen` reaches neither.
  - `promote` is unchanged.
- `scripts/ci/gto-v31-qualification.mjs`:
  - `invocation` admits `prescreen` and an `engine` input. The engine must be a full commit and is refused for every other operation.
  - GitHub sends every declared input, so evaluate, promote and recheck dispatches still pass with `engine: ''`.
  - The `plan` phase serves `prescreen`. With `engine` set it requires that commit to be on protected main. Without it, it plans exactly as evaluate would. Either way it writes nothing to the database.
- `scripts/ci/gto-v31-prescreen.mjs`:
  - Workflow mode accepts `prescreen` and checks the plan against the dispatch.
  - The header now says local mode is for a person with already-exported approved credentials, never a sourced `.env` or a revealed key.
- CLAUDE.md and AGENTS.md: new standing rule on checks and credentials.
- `.agent/audits/2026-11-08-SECURITY-INCIDENT-prescreen-credential-copy.md`: sanitized incident record and rotation assessment.

## Tests

- `gto-v31-qualification.test.mjs`: a stand-alone prescreen takes an optional exact engine. Evaluate, promote and recheck refuse one. Short, zero, injected and array engines are refused.
- `gto-v31-prescreen.test.mjs`: the prescreen dispatch plans and screens, and the epoch, evaluator and promote steps are closed to it. Its database identity is the repository secret. The existing order test is updated for the widened condition.

## Outside the V31 decision closure and execution fingerprint

These are the same files #10105 changed, and no closure or fingerprint file names them.
