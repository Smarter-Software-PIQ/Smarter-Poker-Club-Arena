# The V31 playbook's execution has its own file and its own fingerprint

Phase 3 (part 1) of the R8 plan approved by Dan on 2026-11-06.

## Why

A certified playbook is bound to the engine commit it was evaluated on, and
re-binding it to a later engine today needs the whole decision closure
(about 8,900 files) to be byte-identical. That closure changed in 5 of 5
recent releases, so any promoted playbook would be stranded within hours of
the next deploy. The code that decides what the playbook itself does once
the brain hands it a spot is a small, separable part of that closure.

## What changes

- **The V31 consult moved verbatim** out of `HorseLogic.decidePostflop` into
  `server/src/engine/HorseV31CertifiedPolicy.ts` (`decideV31Certified`), with
  the solver miss helpers and the execution-match rule in
  `HorseGtoExecution.ts`. Three mechanical substitutions only:
  `this.legalize(intended31, player, gs, vi)` is the caller's bound
  `legalize`, `isTournamentMode(gs)` is the caller's `isTournament`, and the
  decidePostflop locals arrive as named inputs. `gtoV31ExecutionMatches` is
  still exported from HorseLogic for every importer.
- **Proof of a pure move:** a behaviour digest of all eighteen v2
  certification tables (both kinds, every family) with R7's 107 sealed cells
  installed, hashing every per-table result and every playbook receipt
  (cell, hand key, sampled and final action and amount): identical before
  and after at 300 pairs per table (89 playbook decisions,
  `ac8d7fa4...`) and at 3,000 pairs (824 decisions, `467a1605...`).
- **`scripts/ci/v31-execution-fingerprint.mjs`**: the execution set at any
  commit, read from git: value imports and literal paths from
  `HorseV31CertifiedPolicy.ts` and `GtoPostflopV31Loader.ts`, stopping at an
  acknowledged boundary (HorseMind, HorseOpponentExploit, HorseEval,
  BrainTelemetry, GtoCharts, GtoPostflop, HorseNlhOpenSize, the Supabase
  client), type-only imports not followed, plus the native kernel. 18 files
  today, against ~8,900 in the decision closure. Fails closed on an
  unresolved or dynamic import, a missing entry or a stale boundary.
  Behaviour that crosses the boundary (legalize, the RNG, the mixture roll,
  the V53 hand-off) is the replay digest's job (Phase 3 part 2), together
  with the database's strict re-check round.

## Tests

- `scripts/ci/v31-execution-fingerprint.test.mjs` (5, real git histories):
  boundary and type-only edges, boundary/unrelated edits keep the digest,
  execution and kernel edits change it, a type import turned value import
  joins the set, unresolved/dynamic/stale refuse, and the real engine is
  closed and under 40 files. Added to the qualification workflow.
- `GtoDepthCeiling`, `GtoV31CertifiedCorpusLaw` and `HorseDataLedger` read
  the moved code from its new files (same assertions).
