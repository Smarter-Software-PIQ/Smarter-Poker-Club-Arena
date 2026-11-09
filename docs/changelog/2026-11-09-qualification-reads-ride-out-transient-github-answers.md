# 2026-11-09: held-out qualification reads ride out transient GitHub answers

Every job of a held-out run is unrecoverable once the run exists:

- a second dispatch is refused, because the original run holds the family's partition
  (`assertIncrementalFamilyRuns`);
- a rerun is refused once a cell's Execute step has started
  (`assertIncrementalUnconsumedRecovery`);
- the assemble job cannot be rerun after any cell executed.

Every GitHub REST read on the path refused on its first non-OK answer. These reads are:

- `authenticateIncrementalPlan`, run in the plan job, in each cell's `--prepare` and Execute,
  and in assemble;
- `authenticateFeatureAblationProviderAttempt`, run in Execute just before the first deal;
- `providerState` and the artifact custody reads.

So a single 5xx, a dropped connection or an exhausted `GITHUB_TOKEN` rate limit (roughly 370
calls per run, against a per-repository hourly budget shared with other workflows) burned the
family before a hand was dealt. Dispatching in a quiet hour lowers the contention but does
not remove the dependency.

## Change

All of these reads now go through one policy, in two twins with identical behaviour:

- `readGithubWithRetry` in `server/src/benchmark/IncrementalPressureQualification.ts`;
- `server/scripts/feature-ablation-github-read.mjs`, for the plain-ESM scripts. Assemble's
  `--finish` runs under plain Node and cannot load TypeScript.

What is waited out, inside the step that needs it:

- a network error or timeout;
- any 5xx;
- a 429;
- a 403 that carries a rate-limit signal (`Retry-After`, `x-ratelimit-remaining: 0` with a
  reset, or a "rate limit" body).

How long it waits:

- it honours `Retry-After`, or the primary-limit reset;
- otherwise it backs off exponentially, up to 60 s;
- a secondary limit gets at least 60 s.

Every wait stops at a deadline measured from process start: plan 10 min (job limit 20),
each cell step 75 min (job limit 240, prepare plus Execute), assemble 20 min (job limit 30).

Everything else (401, 404, other 4xx, a 403 without a rate-limit signal) is returned
unchanged, at once, to the caller's existing refusal. Response content checks are untouched.
Reads are GETs, so repeating one changes nothing. An artifact body that fails mid-stream still
refuses. A sustained GitHub outage longer than the deadline still refuses; that dependency is
inherent to provider-authenticated runs.

The deal-time provider check in Execute is kept on purpose: the dealing wrapper repeats it
before dealing, by design. This change makes it survive transient answers rather than
removing it.

## Defect found while testing

`Number(headers.get('retry-after'))` is `0` when the header is absent. That turned every 403
into a 250 ms retry until the deadline, including permission refusals. Absent headers are
now treated as absent.

## Proof

- `server/src/benchmark/QualificationGithubRead.test.ts`, 29 cases, runs the same table on
  both twins with a virtual clock. It covers:
  - 5xx, network failure, primary reset, `Retry-After` and the secondary limit;
  - immediate return of 401, 404, 409, 422 and a 403 without a rate-limit signal;
  - the deadline is never passed, and a reset beyond it is not waited for;
  - a network failure past the deadline rethrows;
  - the twins share their constants;
  - the budgets fit the workflow's job limits;
  - no raw GitHub `fetch(` is left on the path.
- `IncrementalPressureQualification.test.ts` and `IncrementalPressureQualificationGit.test.ts`
  pass.
- The operations node tests pass, 20 of 20.
- Server `tsc` is clean.

## Consequences

- `IncrementalPressureQualification.ts` is in the decision closure, so the riverPositionDefense
  plan in #10132 is redrafted on the main that contains this change.
- `server/scripts` is a release-control input, so this merges only after the Nov 9 04:00 CST
  engine seal and thaw.

## Follow-up on review (same PR)

- **JSON bodies:** a JSON body that breaks after the headers arrived (a reset or timeout mid-body, or a
  truncated proxy body) is now waited out too. `readGithubJsonWithRetry` (both twins) wraps the read and
  `json()` as one unit for every JSON endpoint: the provider's two helpers, `providerState` and the
  artifact inventory. A non-OK answer is returned unread, for the caller's existing refusal. The
  artifact zip stream is unchanged: a body that fails mid-stream still refuses.
- **Rate-limit wording:** GitHub's legacy "abuse detection mechanism" wording now counts as a rate-limit
  signal.
- **Covered outside code:** a `/commits/{sha}/pulls` association that has not caught up just after a
  merge returns HTTP 200 with `[]`. That is a success at the transport level, so the provenance check
  still refuses it. It is handled before dispatch by reading the association, rather than in code.
- **Remaining limit:** the plan job's 10-minute budget cannot cover a primary-limit reset more than
  10 minutes away, because the job itself is limited to 20 minutes. The plan job makes six reads.
