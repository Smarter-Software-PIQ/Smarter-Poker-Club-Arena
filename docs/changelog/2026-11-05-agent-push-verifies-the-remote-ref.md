# One agent push path, and proof the branch landed

On 2026-11-05 two pushes from the Mac Studio went over SSH, ran the full
`.husky/pre-push` hook (about eight minutes) while the SSH connection sat idle,
and then exited 141 (SIGPIPE) after the hook passed. No ref was pushed and git
printed no error. Retrying against a bare HTTPS URL was refused by the hook's
push baseline ("Push destination tracking main is unavailable"), because a
literal URL gives the hook no remote name to find the tracking main from.

`scripts/agent-push.sh` is now the one way to push an agent branch. It refuses
the shared clone (through the existing `guard-shared-clone.sh`), `main` and a
detached HEAD; fetches `origin main`; pushes the current branch to the remote
name `origin` with the transport switched to HTTPS and `gh` credentials, stdin
closed; returns git's real exit code; and afterwards compares
`git ls-remote origin refs/heads/<branch>` with HEAD, exiting 3 when git
reported success but the ref did not land. It never forces and never skips a
hook. CLAUDE.md section 1.2.5 and AGENTS.md now point agents at it.

The same change documents the coordination inbox in CLAUDE.md and AGENTS.md:
when a GitHub comment to another lane's owner is not possible, append an entry
to `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md`; owners read
it at session start and before each release or merge and acknowledge with an
`ACK` line.

Tests: `tests/unit/agentPushVerifiesTheRemoteRef.test.ts` uses a local bare
repository as `origin` and a stub pre-push hook to prove the verified push,
fetch of `origin main`, the hook receiving the remote name, propagation of a
141 exit, detection of a "successful" push that delivered nothing or left an
older commit, and the refusals.
