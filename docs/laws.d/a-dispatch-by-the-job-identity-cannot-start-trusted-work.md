# tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts

Owner authorization 2026-11-11 (merge queue): queued code runs its own workflow files and can grant its job token write scopes, so every secret-holding job a workflow_dispatch or repository_dispatch can start refuses a dispatch from the job token (github-actions[bot]), except the three trusted job-token senders, whose receivers prove the named sender run first. The law also pins the capped ci.yml token, the fork refusal at the Money trigger reporter, and the two workflow_run readers bound to this repository's own events.
