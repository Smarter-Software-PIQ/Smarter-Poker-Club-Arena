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
  pid reused in a later second is not signalled; ps start times have
  one-second resolution), prints one `STOPPED:` line naming the
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
too, except the helper itself and its watcher. It can still under-kill a child that starts a session of its own after
its parent has exited: such a process is in neither the group nor the parent
walk.

## Second review (of b18e25b7)

An independent review of b18e25b7 (`hu-audit-01UxDLnM/reviews/REVIEW-HU-R2-TOOL-b18e25b7-independent.md`)
found two blocking defects, both fixed here:

1. The fetch and push steps were a shell function, so the recorded step was
   a forked bash with git as its child. A stop that killed the helper's
   shells by name (`pkill -f agent-push.sh` matches the helper, its watcher
   and that forked bash, never git) left git push running as an orphan while
   the helper printed STOPPED. The long steps now run the real command
   (`owned "${REMOTE_GIT[@]}" push ...`), so the recorded pid is git itself,
   and the watcher keeps a once-a-second snapshot (pid and start time) of the
   step's whole tree, so its workers are still found and stopped after the
   step's own pid is gone.
2. A helper leading its own process group whose parent was gone counted
   itself among the group's orphans and SIGKILLed itself after five seconds:
   no STOPPED line, exit 137. It now excludes itself and its watcher.

Also from that review: the watcher decides "the helper is gone" with
`kill -0` (no fork), so a failed `ps` on a loaded Mac is not read as a dead
helper; a pid without a recorded start time is signalled only as the
helper's own child or as an orphan in its group; the watcher is signalled
only while it is still the helper's child; the step's pid is recorded before
its start time is read; the helper prints one line when the lost-parent rule
is off; a stop during the push says the push "may or may not have updated
the remote ref", and the watcher no longer claims to have terminated a step
that had already ended.

The delta review of that fix (`reviews/REVIEW-HU-R2-TOOL-4550cae7-delta-independent.md`,
ACCEPT WITH NOTES) led to five more small changes: git's own arguments carry
the inert setting `agentpush.helper=agent-push.sh`, so a stop or check by
name also reaches git push; a step that fails on its own has what is left of
its snapshot stopped; a helper that is a zombie its parent has not reaped
counts as gone; the watcher is waited for before the state files are
removed; and the "nothing left" wording says what was found, not more. In
the tests, the clean-up kills only a pid that still has the start time the
stub recorded, and the stop cases keep their state files in the fixture.

The review of that commit (`reviews/REVIEW-HU-R2-TOOL-73cdaaa9-delta-independent.md`)
found that waiting for the watcher could hang the helper for ever when it was
launched with SIGTERM ignored (the watcher inherits the ignore and outlives a
SIGTERM). The watcher is now stopped with SIGKILL, after the check that it is
still the helper's child, and the helper says in one line when SIGTERM was
ignored at launch, since then neither its TERM trap nor its steps can be
stopped by a SIGTERM. A test launches it that way, under both bashes, and
expects a verified push and that line; with SIGTERM in place of SIGKILL it
hangs (measured: both cases fail at the 60-second limit).

## The detached-launch rule (review B2)

One rule, independent of timing: the helper stops when its parent process
goes away, from its first instant (a helper whose parent is already pid 1
when it starts counts as gone), unless SIGHUP was ignored on entry, that is
it was launched with `nohup`, or `AGENT_PUSH_DETACHED=1` is set. The helper
detects the nohup case by trapping SIGHUP and sending it to itself once at
start: `trap -p` shows a signal ignored on entry in bash 5 but not in the
bash 3.2 that macOS ships, and this probe gives the same answer in both.
Before, `nohup ... & disown; sleep 2` was stopped while `nohup ... &` with a
launcher that had already exited ran on. Those two launches are not stopped
when their parent goes away, but they stay in the launcher's process group,
so a launcher that kills its whole group takes them too. The rule reads an
orphan as reparented to pid 1 (macOS); under a Linux child subreaper, a helper
whose launcher exited before it started is not stopped by it. The supported detached launch is the
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
complete a verified push. Added for the second review, each
under the PATH bash and, on macOS, under /bin/bash 3.2 as well (with the
three signal cases): a worker that also ignores SIGTERM is SIGKILLed after
five seconds and the STOPPED line is still printed; SIGTERM to the helper
and its watcher together (what `pkill -f agent-push.sh` does) still stops
git push and its workers; a helper that leads its own process group stops
cleanly, with its STOPPED line, when its parent goes away. A source pin
holds the pid re-check before SIGKILL, the held stop during a step start,
the absence of `set -m`, and that the push step is git itself.
