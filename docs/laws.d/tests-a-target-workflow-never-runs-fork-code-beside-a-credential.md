# tests/a-target-workflow-never-runs-fork-code-beside-a-credential.law.test.ts

The repository is public, so anyone can open a pull request from a fork, and a
`pull_request_target` workflow runs with the repository's secrets even for that
pull request. On 2026-11-26 every such job already followed one of two safe
patterns: check out the default branch only and treat the pull request as data
(settlement-lane-doctrine, hand-path-shared-writes, migration-ledger-reconciled),
or read the pull request's code only behind an `if:` that admits a head in this
repository (pr-engine-doors, window-migrations-install-before-merge,
money-trigger-recovery). The law keeps it that way for every current and future
`pull_request_target` job: a job that holds a secret and reads the pull
request's code (a non-default checkout, or a fetch of `refs/pull/` or the head
commit) must be fork-gated in its own `if:` or through a job it needs, and an
ungated job that holds a secret must name the default branch on every checkout.
