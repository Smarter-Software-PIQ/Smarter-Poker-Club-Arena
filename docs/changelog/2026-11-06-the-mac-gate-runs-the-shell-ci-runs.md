# The Mac Gate Runs The Shell CI Runs, And Waits For A Quiet Machine

2026-11-06.

Two things cost #9630 three pre-push runs on the Mac Studio on 2026-11-05.

1. **Bash 3.2.** macOS ships bash 3.2; CI and engine-01 run bash 5. The
   release shell tests spawn `bash` from PATH, so on the Mac they ran the host
   transaction under 3.2, where an empty array expanded under `set -u` is an
   unbound-variable error. The gate refused a change production would have
   run. `.husky/pre-push` now puts a bash 4+ (Homebrew's, installed on the
   Mac Studio) first on PATH through a private directory holding only that
   link, so no other tool moves. With no bash 4+ installed nothing changes.
2. **Load.** Other sessions' suites held the 28-core Mac at a 1-minute load of
   60 to 140. Shell tests with 3-second spawn budgets failed on timing, and a
   correct push was refused after 25 minutes. `scripts/agent-push.sh` now
   waits, up to `AGENT_PUSH_LOAD_WAIT_SECONDS` (default 900, 0 disables), for
   the load to fall below 1.5x the core count before it pushes. It only
   delays the push; the hook and every check are unchanged, and after the
   budget it pushes anyway.

Also recorded in PUBLISHING.md: on the Mac, merge and edit PRs with
`env -u GH_TOKEN -u GITHUB_TOKEN gh ...`. The exported fine-grained token is
refused `mergePullRequest` and `updatePullRequest`; `gh`'s own login is the
identity agent-push.sh already uses. Agent Autopilot stays disabled.
