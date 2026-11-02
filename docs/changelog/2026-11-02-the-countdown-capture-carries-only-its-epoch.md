# 2026-11-02: the countdown capture carries only its epoch

Every Phase 1 hourly cutover since the routine-cycle unbrick died at the
cutover second. Host journal for run 41469215622-1 (target 26aaaa3f, the
16:00Z break) after the fixed 15:58:05Z announcement:

    16:00:13 engine-release-transaction.sh: line 273: cc825674…: unbound variable
    16:00:13 1793635505: integer expression expected
    16:00:13 engine-release-transaction.sh: line 653: cc825674…: unbound variable
    16:00:13 [engine-release-recover] announcement-only owner retained

`bind_phase1_window` runs inside `$(legacy_checkpoint_countdown …)` and
`$(maintenance_certificate …)`, whose stdout is the break-end epoch and break
remainder. It calls `source_target_is_current`, which prints
`ENGINE_RELEASE_SUPERSEDED_BY=<sha>` to stdout whenever the target is behind
protected main. Main moves every few minutes, so every hourly attempt captured
that line ahead of the epoch, `set -u` arithmetic on it died, and the crash left
an announcement-only owner that refused every later receiver.

Now `bind_phase1_window` sends that informational line to stderr; its proof
and refusals are unchanged. The admitted countdown value must be a bare
positive integer, and the locked recheck must name the same epoch, or the entry
refuses before mutation instead of crashing inside the break.

Tests: `tests/operations/countdown-capture-epoch.py` executes the real
`bind_phase1_window` inside a capture with a target behind main (bare epoch,
arithmetic succeeds), reproduces the production failure on the previous text
(`<sha>: unbound variable`), and runs the new guard against a polluted and a
bare value. Wired into the Engine Build Resource Containment workflow.
