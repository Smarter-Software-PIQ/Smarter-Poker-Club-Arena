# agent-push stops its own process tree

Agents launch `scripts/agent-push.sh` detached, for example
`screen -dmS name bash -c 'bash scripts/agent-push.sh > log 2>&1'`, and stopped
it with `screen -S name -X quit`. That killed the screen and the outer shell,
but the helper, `git push`, the `.husky/pre-push` hook and its vitest workers
kept running for up to 40 minutes on the shared 28-core Mac, and a run that
went green would still have pushed a branch its agent believed was stopped.
It happened three times on 2026-11-15 (coordination inbox, overwatch,
05:41:35Z).

Root cause: bash runs a trap only after its foreground child returns. The
helper ran git push in the foreground, and the hook's own HUP trap waits on
vitest the same way, so a hangup reached nothing that could act on it, and
once the launching shell was gone nothing signalled the helper at all.

Fix: every step of the helper that can take time (fetch, execution preview,
the load wait and the push) now runs as a job in its own process group and
the helper waits on it with `wait`, which a trapped signal interrupts. On
SIGHUP, SIGINT or SIGTERM, or when a one-second watcher sees the helper has
been reparented because its launcher died, the helper terminates that group
and every process descended from it (SIGKILL after five seconds), prints one
`STOPPED:` line naming the reason and whether a push had started, and exits
129, 130 or 143 without pushing. Its existing guarantees are unchanged: it
refuses the shared clone, main and a detached HEAD, never forces, never skips
a hook, returns git's real exit code and verifies the remote ref.

PUBLISHING.md ("Push and protected merge") now says to stop a run by its
process group and confirm with `ps` before reporting it stopped.

Tests: `tests/unit/agentPushVerifiesTheRemoteRef.test.ts` runs the helper with
a stub `git` whose push starts a worker that ignores SIGHUP and SIGINT, then
proves that SIGHUP and SIGTERM to the helper, and SIGKILL of the shell that
launched it, leave no worker running, exit non-zero and push nothing.
