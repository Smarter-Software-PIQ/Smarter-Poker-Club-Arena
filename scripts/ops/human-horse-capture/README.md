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
| Path | Role |
|---|---|
| `run-capture-steps.sh` | census and Lightning outcomes per 2-hour segment, merge, human keys, selector, export batches |
| `post_capture.py` | batches, keys_light, keys_batch, priors, origins, fires, cohort |
| `run-originals-host.sh` | journal reads (witness, export, roll-up batches) run detached on the engine host, then collected with sha256 checks |
| `run-originals.sh` | the older ssh-bound journal reads (kept; prefer the host runner for long batches) |
| `operator-lock.sh` | one named operator per capture folder and one running step at a time |
| `reconcile.py`, `build_packet.py`, `rollup_aggregate.py`, `analyze.py` | post-read reconciliation, witness packet, roll-up, report numbers |
| `witness-reader.mjs`, `rollup-reader.mjs` | journal readers, run inside the retained reader image of the serving release |
| `host/preserve-part.sh`, `host/preserve-window.sh` | bounded byte-copy preservation of the window's journal segment files on the engine host |
| `verify-release.sh`, `release-inventory.tsv` | read-only check of the serving release against the Horse change inventory and the worker fleet |
| `manifest/` | census, Lightning outcomes, selector and export tools of protocol v4/v5 with their tests |
| `RUNBOOK.md`, `TESTS.md` | operating order and test record carried over from the archive, with the repository section appended |

## Configuration (environment; defaults are the owner's Mac layout)
| Variable | Default | Used by |
|---|---|---|
| `HVH_SHA`, `HVH_IMAGE` | required | serving release (40 hex) and its retained reader image |
| `HVH_OPERATOR` | required for reading steps | operator lock |
| `HVH_SUBJECT_CONFIG` | archive `human-horse-handoff-audit-01a1cbbc/evidence/subject-config.json` | census and selector exclusions (private; never committed) |
| `HVH_REPO` | this repository | `scripts/dr/native-supabase-export.py` and the CA certificate |
| `HVH_SUPABASE_LINK` | `/Users/smarter.poker/Documents/club-arena` | the supabase-linked directory for read-only psql |
| `HVH_PSQL`, `HVH_SUPABASE_CLI` | `/opt/homebrew/bin/psql`, `/opt/homebrew/bin/supabase` | database reads |
| `HVH_ENGINE_HOST` | `ca-engine` | ssh alias of the engine host (`none` skips the Prometheus read in verify-release) |
| `HVH_JOURNAL_DIR` | `/var/lib/club-arena/horse-decisions` | journal directory on the engine host |
| `HVH_TOOLKIT` | the script's own directory | where `run-originals.sh` finds `operator-lock.sh` when copied into a capture folder |
| `HVH_HEALTH_URL`, `HVH_HEALTH_JSON`, `HVH_RELEASE_INVENTORY` | engine `/health`, unset, `release-inventory.tsv` | verify-release |
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
