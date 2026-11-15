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

## The fix, and why this design

Every step of the helper that can take time (fetch, execution preview, the
load wait and the push) runs as a background job of the helper, which waits
on it with `wait`; a trapped signal interrupts `wait` at once.

The jobs stay in the helper's own process group. The first version of this
change (6016f5d6) put each step in a process group of its own with `set -m`;
Hand Analysis's independent review measured that a SIGKILL of the helper's
group then left the push running as an orphan, and that the same happened
when the remote host_terminal call that launched it returned (review B1). A
group SIGKILL cannot be trapped, so the only design that survives it is one
where the kernel takes the steps with the group, as it did before this
helper owned anything. That is also the simpler design: no second group, and
a step reading the terminal keeps the foreground group it had before.

Stops, and what each does:

- SIGHUP, SIGINT or SIGTERM: the trap terminates the step and every process
  descended from it, waits up to five seconds, then sends SIGKILL to each
  that is still the same process (its start time is re-checked first, so a
  reused pid is never signalled), prints one `STOPPED:` line naming the
  reason and the phase, and exits 129, 130 or 143. A stop that lands while a
  step is being started and recorded is held until the record exists, then
  acted on.
- The parent went away: a one-second watcher signals the helper, which stops
  the same way (exit 129).
- The helper alone is killed outright: the watcher, which outlives it, reads
  the running step from a private state file and terminates its tree.
- SIGKILL of the helper's whole process group: the kernel takes everything.

When the helper leads its own process group, members of that group that were
orphaned (their parent exited and they were reparented to pid 1) are stopped
too. It can still under-kill a child that starts a session of its own after
its parent has exited: such a process is in neither the group nor the parent
walk.

## The detached-launch rule (review B2)

One rule, independent of timing: the helper stops when its parent process
goes away, from its first instant (a helper whose parent is already pid 1
when it starts counts as gone), unless SIGHUP was ignored on entry, that is
it was launched with `nohup`, or `AGENT_PUSH_DETACHED=1` is set. The helper
detects the nohup case by trapping SIGHUP and sending it to itself once at
start: `trap -p` shows a signal ignored on entry in bash 5 but not in the
bash 3.2 that macOS ships, and this probe gives the same answer in both.
Before, `nohup ... & disown; sleep 2` was stopped while `nohup ... &` with a
launcher that had already exited ran on. The supported detached launch is the
`screen -dmS` line above (PUBLISHING.md, "Push and protected merge").

A `STOPPED:` line is not proof that nothing landed. During the push and
verify phases the push may already have reached the remote, so the line now
tells the agent to read the remote ref (`git ls-remote`) before reporting the
run stopped, and PUBLISHING.md says the same.

Steps that are not owned jobs (the `gh auth status` probe, the two guards and
the `ls-remote` reads) still delay a stop until they return. Bash runs the
background jobs of a shell without job control with SIGINT ignored; the
helper's own SIGINT trap stops them with SIGTERM.

Its existing guarantees are unchanged: it refuses the shared clone, main, a
detached HEAD and uncommitted tracked edits, never forces, never skips a
hook, returns git's real exit code (141 included), exits 3 when the remote
ref is not HEAD and prints `[agent-push] VERIFIED: origin refs/heads/<b> = <sha>`.

## Tests

`tests/unit/agentPushVerifiesTheRemoteRef.test.ts` runs the helper with a
stub `git` whose push starts a worker that ignores SIGHUP and SIGINT, and
proves, with nothing pushed in each case: SIGHUP, SIGINT and SIGTERM leave no
worker; the death of the launching shell stops it; a SIGKILL of the helper's
whole process group leaves no worker and no member of the group; a SIGKILL
of the helper alone is followed by its watcher stopping the step; a launcher
that returns while the helper runs in the background without nohup leaves
nothing running. Three detached launches (nohup with a lingering launcher,
nohup with a launcher that exits at once, and `AGENT_PUSH_DETACHED=1`) each
complete a verified push. A source pin holds the pid re-check before
SIGKILL, the held stop during a step start, and the absence of `set -m`.
