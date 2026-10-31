# 2026-10-31: owner-ordered drained :55 activation of Horse V63-V70

Dan ordered the next :55 deploy (12:07 Chicago), the GTO opening-range work
made fully live (15:33 Chicago), and chose a checkpoint-free cutover after
eed06fe5's full-heap census was shown not to fit its pinned budget.

This appends owner window 68, `2026-10-31-horse-v63-v70-drained-next-55`
(contains 61229f0de1, the V70 merge, which also contains the drained-predecessor
cutover #8986 whose witness migration 20261031212432 is installed), eligible
23:20-05:20 UTC, one activation at Chicago :53 notice / :55 activation, and
selects its exact activation-floor witness. It begins after the MTT window's
23:15Z expiry and ends before the 2026-11-01 daily notice. Every historical
window byte is unchanged and pinned.

Expected behaviour (from #8986): `fits=False` for the census, then a strict
drained-boundary check each pass. A pass whose certificate does not open with
>= 260000 ms left, or whose witness is not quiet, refuses cleanly and the break
thaws on its own clock (about a 5-minute pause); the first quiet pass activates.
