# A new engine serves a V31 playbook only after it replays and retests

Phase 3 (part 2) of the R8 plan approved by Dan on 2026-11-06 ("strict
re-check rule"). Applies to contract v3 playbooks only; contract v2 (R7 and
earlier) keeps exactly its closure rule.

## Why

A certified playbook could only serve the engine it was certified on: the
whole decision closure (about 8,900 files) changes in almost every release.
"The files did not change" is also not enough on its own: R7's decisions
tie with horse memory learning off and lose with it on, so the surrounding
brain decides the result and has to be re-measured.

## What changes

A later engine serves a v3 playbook only when all three hold:

1. **Execution fingerprint identical** (Phase 3 part 1): the playbook's own
   execution files, read from git.
2. **Replay digest identical**: every certified decision recorded at
   certification is replayed through the new engine's `decideV31Certified`
   with the new `HorseLogic.legalize`, the exact recorded RNG position and the
   recorded opponent read; action, size, receipt and full probability mix are
   hashed. This sees behaviour that crosses the execution boundary
   (legalization, state shape).
3. **A re-check round passes**: every certification table of every family
   the playbook carries, re-run on the new engine with the certification
   seeds against the certification incumbent, is a win or a tie.

**Strict:** one loss retires the playbook for good. Active becomes
`retired`, candidate becomes `rejected`, every serving binding is revoked,
and no round can ever open for it again.

- **Recording** (`HorseLogic` opts `onV31ReplayState`, offline only; never
  set live): `captureV31ReplayState` takes the consult's inputs, RNG position,
  V53 opponent read and returned decision as JSON. A deterministic recording
  pass runs after the certification receipts: both kinds, every table, 2,000
  pairs, certification seeds.
- **Corpus** (`GtoV31ReplayDigest.ts`): deduplicated, ordered by state
  SHA-256 and cut to 6,000 states, so play order and scheduling cannot change
  it. It must replay faithfully on its own recording engine (every decision
  reproduced) and hold at least 300 states, or it cannot anchor.
- **Database** (migration `20261107035438`):
  - `gto_v31_execution_anchors`, one per epoch: execution digest, replay
    digest, corpus checksum, gzip corpus (at most 8 MiB, SHA-256 addressed).
    Immutable.
  - `gto_v31_recheck_rounds`: opens only on identical digests, appends
    results, and closes once as passed, retired or abandoned.
  - Promotion and `fn_gto_v31_bind_serving` require the anchor, and a
    passed round for any engine other than the certifying one.
  - Bindings record the round and both digests.
  - `fn_gto_v31_evaluation_cells` serves an active dataset to the
    service-role evaluator; the live loader is unchanged.
- **Evaluator** (`gtoV31Evaluate.ts`):
  - After the v3 receipts it records the anchor; the execution digest is
    computed by the CI fingerprint tool itself.
  - `--recheck` loads the playbook by checksum into an evaluation store,
    never live (`replaceGtoPostflopV31Recheck` admits only candidate or
    active). It proves both digests before a hand is dealt, then opens or
    resumes the round and re-runs and records every table.
- **Qualification workflow**: a dispatch-only `recheck` operation. No timer:
  the V31 lane dispatches it after a daily update. For v3 playbooks,
  `promote` (including load-only re-binds) requires the certifying engine or
  a passed round; the serving closure is still proven closed and recorded.

- **Baseline**: a re-check reproduces the certification's incumbent exactly
  (`gtoV31RecheckIncumbent`). Re-checking the ACTIVE playbook never loads
  the live store, which would hold the playbook itself and make every table
  a meaningless tie.

## Evidence on real cells

R7's 107 sealed public-hist215 cells (read from production, read-only)
went through the recording pass in an evaluator worker thread, as the
evaluator runs, at 500 pairs per table over all 19 v3 tables:

- 299 certified decisions were recorded.
- All 299 replayed to exactly the recorded decision; none was unfaithful.
- The digest was identical after the gzip store round trip.
- The stored corpus was 38 KB.

(R7 is a v2 dataset and is never anchored; this is evidence for the replay
path only.)

## Tests

- `GtoV31ReplayDigest.test.ts` (10) records through the real
  `HorseLogic.decide` and proves:
  - capture order and duplicates do not change the corpus;
  - tampering is refused;
  - replay is faithful and deterministic and leaves the RNG as found;
  - the mix and receipt are hashed;
  - a legalization change across the boundary flips the digest and is
    refused as an anchor, and so does a playbook change;
  - the 300-state floor holds.

  Four implementation mutations are all caught.
- `GtoV31Recheck.test.ts` covers:
  - the stored corpus round-trips;
  - foreign bytes, corpus or dataset are refused;
  - the recording tap reaches only the candidate arm, on both league runs;
  - the execution digest equals the CI tool's.
- `GtoPostflopV31.test.ts`: a re-check loads active or candidate by checksum
  and never touches the live store. The existing "an active row never enters
  the candidate store" law stands.
- `scripts/ci/test-v31-strict-recheck.py` (PostgreSQL 17, its own workflow):
  - production preimages, with v2 promotion and binding unchanged;
  - every anchor, round, result and strict-loss rule, and grants;
  - 14 behavioural mutations, each caught by behaviour rather than an md5
    pin.
- `gto-v31-qualification.test.mjs`: recheck dispatch, the recheck plan
  (execution-identical, retired-for-good) and v3 serving admission.
