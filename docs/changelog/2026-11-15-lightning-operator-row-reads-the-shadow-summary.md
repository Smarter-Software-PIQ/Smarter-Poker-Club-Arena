# The Lightning operator row reads the shadow summary (2026-11-15)

## What failed

Lightning > Operator answered HTTP 500 (`statement_timeout`, 8 s) at 2026-11-14 12:21:45Z (8,088 ms) and 22:04:51Z (8,103 ms) for club `fade0000-0000-0000-0000-000000000001` (79 clusters). The certificate run's 500 on the same page has the same cause.

## Cause

`fn_lightning_operator_overview` builds one row per cluster with `fn_lightning_operator_cluster_row`. For a cluster with a shadow comparison this week, the row ran the full `fn_lightning_shadow_report` and kept five fields of its first version pair: verdict, comparisons, mean difference and the two versions. The report averages fourteen metrics per pair and unpacks every comparison's TOASTed metrics documents about fifty times.

Measured read-only on production, 2026-11-15, warm cache:

| part                                | buffers | time   |
| ----------------------------------- | ------- | ------ |
| the 77 rows without shadow data     | 17,373  | 194 ms |
| the 2 shadow rows, as installed     | 318,832 | 912 ms |
| the same 2 summaries, read directly | 63,606  | 212 ms |

On a cold cache the installed form passes 8 s.

## Change

Migration `20261115010232` patches the installed row under its production md5 (`dc81e3aa…`), with two anchors that must each match exactly once. The row reads the summary itself, with the report's rules:

- the same window;
- the same current snapshot binding;
- the same seated filters;
- only windows with both scores count as comparisons;
- the same first pair;
- the same verdict rules and output keys.

Each JSON document is unpacked once with `jsonb_to_record`. The report itself, the overview, the operator gate, owner rights and grants are unchanged. The single-cluster view and rollout readiness call the same row, so they get the same speedup with the same output.

One difference, on malformed data only: the report errors on a non-numeric component metric; the row no longer reads those metrics, so it no longer fails on them.

## Verified

- `tests/unit/lightningOperatorRowShadowSummary.pg.test.ts` runs on real PostgreSQL 17. The pre-images are production byte for byte (md5 checked).
  - The 15 cases reach every verdict, both empty outcomes, stale snapshots, unseated and mismatched rows, missing scores, several pairs, and reads two days back, three days ahead and far in the future.
  - Each case is read before and after the patch on the same rows. Every row is byte-equal, and every summary equals the report's first pair.
  - The guard refuses a different installed image.
  - A busy week drops from 93,297 to 12,207 buffers.
  - Grants and SECURITY DEFINER are kept.
  - Each of 7 mutations of the patch fails it: no binding, calibration pair not last, windows counted as comparisons, no reliability rule, no seated rule, uncapped window end, no shadow binding.
- `tests/lightning-operator-row-reads-the-shadow-summary.law.test.ts` pins the patch against the fixture of production bytes.

## Not done here

Installation follows the Apply Merged Migration route after merge. Live proof: the Operator page loads, the overview answers within budget on a cold read, and unauthorized callers are still refused.
