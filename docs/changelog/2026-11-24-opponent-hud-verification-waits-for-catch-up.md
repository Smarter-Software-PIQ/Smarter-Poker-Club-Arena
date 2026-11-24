# The opponent HUD's nightly verification waits for the catch-up

On 2026-11-24 the opponent lifetime HUD was switched on at 05:08 Chicago with a sync point 28 hours old. The
first alert tick ran the 04:40 verification of the previous day while the switch-on catch-up was still reading,
so it compared profiles that had not yet absorbed that day's hands and raised `OpponentHudDrift` (1,867 of 1,892
profiles, 620,057 hands "not counted"). Eight minutes later the catch-up finished, and a read-only comparison
showed every one of the day's 646,086 player-hands in its profile, none extra.

The verification now runs only when no catch-up is in progress: not while the switch-on or boot catch-up runs or
is due to be re-run, and not while a load-gap catch-up reads. A day that falls due during a catch-up is not
consumed; the next alert tick after the catch-up verifies it. A catch-up that starts while a verification is
reading makes that verification report "not verified" (`deferred: 'catchup_in_progress'`) and leave the alert as
it was. A completed catch-up whose sync point is still held for an uncounted gap is not "in progress": a day inside
that gap is real drift and is still reported. No count is rewritten and nothing is added that runs on its own.
