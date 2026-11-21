# Human vs Horse capture toolkit

The maintained copy of the tools the Human-vs-Horse capture owner uses to read one declared observation window of a serving engine release:
complete-window census, Lightning outcomes, human hand keys, witness originals from the Horse decision journal, export batches, priors,
faced-wager origins, the tight/maniac witness packet, rule fires, cohort participation and the per-Horse roll-up. Everything here is
read-only on production: database reads run with `default_transaction_read_only=on`, journal reads run in a container with no network,
one CPU and a read-only journal mount, and every tool refuses to overwrite an existing output.

Provenance: ported 2026-11-15 from the evidence archive copy `capture-toolkit-v2` (TOOLS.sha256 digest `ac697de2f39e5149` at the port),
its census/selection/export dependency `postseal-capture-manifest-v6` (now `manifest/`), and the successor session's additions
(`reconcile.py`, `analyze.py`, `host/preserve-part.sh`, `host/preserve-window.sh`, `verify-release.sh`). A capture that was declared
against the archive copy keeps using the archive copy until it is read; this directory is for captures declared after it.

The frozen grading method is NOT part of the toolkit and is not copied: `TIGHT-MANIAC-METHOD-v1.md`, digest `af0bd14cbae3d66a`, lives
beside each declared observation in the evidence archive. `build_packet.py` implements its classifier and verdicts.

## Layout

| Path                                                                   | Role                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read-window.sh`                                                       | end-to-end closed-window reader gated on `declaration_guard.py` (`DECLARATION.json` + `DECLARATION.sha256`)                                                                     |
| `write_window_artifacts.py`                                            | non-overwrite generator for `PRESERVED.md`, `REPORT-OBSERVATION.md`, `PHASE1-GRADE-POST-WINDOW.md`, `EVIDENCE-INDEX.md`                                                         |
| `declaration_guard.py`                                                 | pre-evaluation `DECLARATION.json` + SHA-256 initializer and hard gate (M3, M13)                                                                                                 |
| `build_attribution.py`                                                 | `hand_history.engine_build` + `ca_engine_deploy_attempts` attribution, cutover window splitter, boundary table (M9)                                                             |
| `score_decisions.py`                                                   | LOO measured-range classifier, actual-hand EV scorer, hand-clustered bootstrap CI, top-human share, card firewall                                                               |
| `blind_review.py`                                                      | 1:1 action-matched blind-review batch builder (`0600` key in `0700` dir) and canonical Bar `e'` label scorer (M6)                                                               |
| `gap_targets.py`                                                       | targeted missing-spot hand-key selector and offline action-sequence classifier across 6 under-observed spot classes                                                             |
| `run-capture-steps.sh`                                                 | census and Lightning outcomes per 2-hour segment, merge, human keys, selector, export batches                                                                                   |
| `post_capture.py`                                                      | batches, raw_batches, keys_light, keys_batch, priors, origins, fires, cohort, gap_targets, score_folds, blind_batches, score_blind_labels, build_boundaries                     |
| `run-originals-host.sh`                                                | journal reads (witness, export, roll-up, raw gzip batches) run detached on the engine host (`nice -n 19 ionice -c3`, memory/maintenance precheck), collected with sha256 checks |
| `preserve-host.sh`                                                     | Mac-side start/close/status/stop/ensure-reader/rollover of bounded host preservation and `hvh-reader:<sha10>` tags                                                              |
| `run-originals.sh`                                                     | the older ssh-bound journal reads (kept; prefer the host runner for long batches)                                                                                               |
| `operator-lock.sh`                                                     | one named operator per capture folder and one running step at a time                                                                                                            |
| `reconcile.py`, `build_packet.py`, `rollup_aggregate.py`, `analyze.py` | post-read reconciliation, witness packet, roll-up, report numbers (with top-human share)                                                                                        |
| `witness-reader.mjs`, `rollup-reader.mjs`, `raw-reader.mjs`            | journal readers, run inside the retained reader image of the serving release                                                                                                    |
| `host/preserve-part.sh`, `host/preserve-window.sh`                     | bounded byte-copy preservation of the window's journal segment files on the engine host                                                                                         |
| `verify-release.sh`, `release-inventory.tsv`                           | read-only check of the serving release against the Horse change inventory and the worker fleet                                                                                  |
| `manifest/`                                                            | census, Lightning outcomes, selector and export tools of protocol v4/v5 with their tests                                                                                        |
| `RUNBOOK.md`, `TESTS.md`                                               | operating order and test record carried over from the archive, with the repository section appended                                                                             |

## Configuration (environment; defaults are the owner's Mac layout)

| Variable                                                     | Default                                                                   | Used by                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HVH_SHA`, `HVH_IMAGE`                                       | required                                                                  | serving release (40 hex) and its retained reader image                                                                                                                                                |
| `HVH_OPERATOR`                                               | required for reading steps                                                | operator lock                                                                                                                                                                                         |
| `HVH_SUBJECT_CONFIG`                                         | archive `human-horse-handoff-audit-01a1cbbc/evidence/subject-config.json` | census and selector exclusions (private; never committed)                                                                                                                                             |
| `HVH_REPO`                                                   | this repository                                                           | `scripts/dr/native-supabase-export.py` and the CA certificate                                                                                                                                         |
| `HVH_SUPABASE_LINK`                                          | `/Users/smarter.poker/Documents/club-arena`                               | the supabase-linked directory for read-only psql                                                                                                                                                      |
| `HVH_PSQL`, `HVH_SUPABASE_CLI`                               | `/opt/homebrew/bin/psql`, `/opt/homebrew/bin/supabase`                    | database reads                                                                                                                                                                                        |
| `HVH_ENGINE_HOST`                                            | `ca-engine`                                                               | verify-release only: `none` skips the engine-host Prometheus read; every other tool connects to the sanctioned alias `ca-engine` literally (tests/an-agent-cannot-lock-the-mac-out-of-production law) |
| `HVH_JOURNAL_DIR`                                            | `/var/lib/club-arena/horse-decisions`                                     | journal directory on the engine host                                                                                                                                                                  |
| `HVH_TOOLKIT`                                                | the script's own directory                                                | where `run-originals.sh` finds `operator-lock.sh` when copied into a capture folder                                                                                                                   |
| `HVH_HEALTH_URL`, `HVH_HEALTH_JSON`, `HVH_RELEASE_INVENTORY` | engine `/health`, unset, `release-inventory.tsv`                          | verify-release                                                                                                                                                                                        |

No credential is read from files or printed by any tool; database access uses the configured supabase CLI login.

## Tests (no production access; run in CI by `.github/workflows/human-horse-capture-tests.yml`)

```
cd scripts/ops/human-horse-capture
PYTHONPATH=. python3 -B -m unittest discover -s tests -p 'test_*.py'      # build_packet, segments, merge_census, reconcile
(cd manifest && python3 -B -m unittest test_fleet_reconciliation test_lightning_outcomes test_metrics_window test_postseal_census test_postseal_selection)
bash tests/test_operator_lock.sh "$(mktemp -d)"   # operator and run locks
bash tests/test_verify_release.sh                 # git fixture + fake health
bash tests/test_preserve_window.sh                # GNU/Linux only: fake journal, stub and real parts
```

## Refresh to the archive's toolkit v3, 2026-11-15 (session 01BbZPDhhqSDALp7kec7EfDM)

Brought up to the archive copy `capture-toolkit-v2` at TOOLS.sha256 digest `a4dade9d928499d9` (full: `a4dade9d928499d91964904b070a46e6cc4d8becf484d6aafa3d308669fc1ad4`;
the port above was `ac697de2f39e5149`). The archive copy is untouched. Every file TOOLS.sha256 lists now matches the archive apart from the repository adaptations:

- identical to the archive: `post_capture.py` (keys_variant), `witness-reader.mjs` (vpipFloor, preflopReadReceipt, streetAggressions, lastAggressor.allIn), and the new
  `window.py` (the only ISO-to-epoch conversion), `near_tight.py`, `plo6_maniac_price.py` (v2, two sets), `RUNBOOK.md` (v3 section);
- archive change applied on top of the adaptations: `run-capture-steps.sh` (census resume), `run-originals-host.sh` (stdin fix of the sha check);
- new with adaptations: `preserve-host.sh` (Mac-side start/close/status/stop of the bounded host preservation; retains the reader image at declaration),
  `HVH_JOURNAL_DIR` honoured (the host is always the sanctioned alias), the journal directory passed to the host job;
- `host/preserve-window.sh`, `host/preserve-part.sh` take the archive's v3 interface (`OPERATOR RELEASE8`; FROM/END files written by `preserve-host.sh`, END re-read
  every pass so `close` needs no restart, RING-GAP line). The repository adaptations stay as environment overrides with the archive's defaults:
  `HVH_WORK_DIR` (`/root/hvh-work-<R>`), `HVH_PRESERVE_DIR` (`/var/lib/club-arena/hvh-preserve-<R>`), `HVH_JOURNAL_DIR`, every `archive-shard-*` present instead of
  shards 1-7, and the test tunables `HVH_PART_INTERVAL`, `HVH_RETRY_SLEEP`, `HVH_LOAD_WAIT`, `HVH_DISK_FLOOR_KB`, `HVH_PART_SCRIPT`. The earlier explicit
  `WORK_DIR PRESERVE_DIR FROM END` arguments are gone; `tests/test_preserve_window.sh` uses the new interface.
- archive tests ported to `tests/` (checks unchanged; wrapped for `unittest discover`; scratch under `HVH_TEST_TMP`, default the system temporary directory, always
  removed): `test_window.py` (13 checks), `test_near_tight.py` (8), `test_plo6_maniac_price.py` (15). Results are in TESTS.md.
- `.prettierignore` is NOT changed (it is a pinned source file); these docs are committed as they are.
