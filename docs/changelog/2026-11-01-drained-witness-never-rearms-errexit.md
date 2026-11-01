# 2026-11-01: the drained-boundary witness never re-arms the caller's errexit

Receiver 41272121963 (target ca8250444e, owner window
`2026-10-31-horse-v63-v70-drained-next-55`) passed tests, doors and the native
scale gate, staged intake `41272121963-1` at 04:32:12Z, and the transaction then
exited 1 at 04:32:34Z, 21 minutes before the 04:55 break it was meant to wait
for:

    legacy census estimate heapUsedMb=2848 censusEstimateMs=34188 allowanceMs=30300 fits=False
    ... eed06fe5... may be replaced only at a drained hand boundary, never by a checkpoint
    [engine-release-inflight-hands] the predecessor is NOT at a drained hand boundary
    [engine-release-transaction] ... not at a drained hand boundary; no cutover this pass
    [observe-engine-release] FATAL: release attempt failed permanently (status=1)

## Cause

The #8986 pre-notice gate calls `drained_predecessor_witness` under `set +e`
so that "not drained" (exit 1) is recorded and the run carries on to the wait
loop. Only an unreadable witness is supposed to be fatal there. But the
function finished its read with a bare `set -e`. That turned errexit back on
inside the caller's `set +e`, so the function's own `return 1` then ended the
whole script at the call site. Its message ("no cutover this pass") was the
last line it ever printed.

So every intake made during play whose census could not fit died at once,
because a live predecessor is never drained mid-play. With eed06fe5's heap
above about 2,524 MB (where the census stops fitting the 30.3 s allowance at
12 ms/MB), that is every intake, the daily 04:00 Chicago one included. The
queue tests stub the function out, which is why they never saw this.

The locked read (`if ! drained_predecessor_witness`) is in a conditional
context, where errexit is ignored, so it was not affected. No other
`set +e; function; rc=$?` site in the script calls a function that re-arms
errexit. `maintenance_certificate` is called through `$(...)`, which is a
subshell.

## Fix

- The function restores the caller's errexit state exactly as it found it.
- The gate records the result with `DRAINED_WITNESS_RC=0;
  drained_predecessor_witness || DRAINED_WITNESS_RC=$?`. That form does not
  depend on what the function does with errexit.

Nothing else changes. "Not drained" still never cuts over. The witness is
still read under the lock before the locked certificate. An unreadable
witness still refuses before any notice: before this fix it exited 3 from
inside the function, and now it reaches the documented `die`.

## Tests

`tests/operations/eed-drained-cutover.test.py` `ErrexitTests` runs the real
function and the real gate block under `set -euo pipefail`:

- not drained (1): reaches the wait loop with errexit still on;
- drained (0): reaches the wait loop;
- unreadable (3, 4, 127): dies with the pre-notice refusal;
- the locked read: errexit is kept.

The not-drained and unreadable cases fail against the previous script. The
law's pinned count moves from 21 to 25.
