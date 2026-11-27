# Post-Cutover Audit Receipt

Since November 26, every cutover cycle gets an audit receipt on the cutover log (#11599) without a chat having to be awake for it.

## When It Runs

`.github/workflows/post-cutover-receipt.yml` follows two workflows:

- The engine receiver (`auto-deploy-hetzner.yml`), when a cutover started it (`repository_dispatch`). It posts SEALED and REFUSED and names itself on its `Receiver:` line.
- Stage (`stage-engine-release.yml`), which posts KEEP-SERVING and names itself on its `Stage:` line.

A secret-free gate job runs `scripts/ops/post-cutover-receipt.mjs --find` first. It answers whether that exact run posted a `Cycle:`/`Result:` comment that has no receipt yet. Stage runs many times a day, and most runs (readiness ticks, runs before the cutoff) post no result, so most runs stop at the gate and never touch the database secret.

## What It Does

When the gate says yes, the audit job runs `scripts/ops/post-cutover-audit.mjs` against production, read-only: psql in a read-only transaction through `--db-url-env`, behind the audit's mutating-SQL guard. It expects the release that must be live after the cycle: the `Sealed SHA` for SEALED, the `Serving SHA` for KEEP-SERVING. If only live health fails while a freshly booted engine settles, it audits once more after 90 seconds. It then replies on #11599 with `Post-cutover audit for run <id>`, every check's verdict and the audit time in Chicago time.

## The Sweep

GitHub can skip or delay a `workflow_run` event, and then a cycle would silently get no receipt. Every gate therefore also looks back over the last 12 hours of the log: when its own run needs no receipt, it picks the oldest cycle result that is at least 15 minutes old and still unanswered, and the audit job answers it with a line saying it is a late receipt that audits production as it is now. Stage completes about four times an hour, so a missed receipt is answered within minutes, without a timer and without touching any release control. Cycles posted before the workflow existed are never swept. One audit runs at a time across all runs, and each re-reads the log before posting, so a cycle is never answered twice. A crashed audit still posts an `OVERALL ERROR` receipt with the reason, so a broken audit is reported once rather than retried on every Stage run.

When `switch_records` does not pass, the receipt names the repair: `node scripts/ops/horse-option-switch.mjs records`, which opens the docs-only records PR.

## Why It Cannot Confuse The Release Tools

A receipt never starts with `Cycle:` and never carries a `Result:`, `Sealed SHA:` or `Cycle:` line; the formatter throws if one ever could. It is posted once per run. The workflow only reports: it has no schedule, cannot dispatch or deploy anything, asks for `contents: read` and `issues: write` only, refuses a job-token dispatch or re-run, and accepts only this repository's own receiver and Stage files on main. It is not a release control and no release workflow waits for it.

## By Hand

Run the workflow with `receiver_run_id` set to a receiver or Stage run id. Locally: `node scripts/ops/post-cutover-receipt.mjs --run-id <id> --dry-run`.

Tests: `tests/unit/postCutoverReceipt.test.ts`, `tests/unit/postCutoverAudit.test.ts`, `tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts`.
