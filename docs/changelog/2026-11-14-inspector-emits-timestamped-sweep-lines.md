# The restart inspector reads the elimination sweep in order (2026-11-14)

Incident #3 (Midnight Free Buy b6d94533, 01:30-01:58 CST): busts were recorded
two to three per pass, about 2.5 s apart, with a 4-22 s gap every few busts,
while a backlog of over 100 waited a median 440 s. Production rows ruled out
the rebuy-window explanation (no prompt was opened after 01:30). The focus
templates said what was logged but not when, so what ends a pass could not be
read.

`scripts/ci/inspect-engine-restart-evidence.py` now also emits, for the focus
prefix only:

- `engineLog.sweepLines`: up to 4,000 masked elimination-sweep lines with
  their timestamps, in order (Eliminated, BOUNTY, horse_rebuy_decision, bust
  batches, sweep and scheduler reports), plus process-wide elimination
  scheduler lines; `sweepLinesDropped` counts any beyond the cap.
- `eliminationSeries`: aggregate scheduler queue depth, oldest wait, slots,
  dispatch outcomes, sweep duration and per-step sweep timing for the window,
  read from the local Prometheus (127.0.0.1:9090) with a fixed query list.

Still read-only and masked: the prefix, ids, numbers and strings never leave
the host, and Prometheus is read with GET only. Non-engine CI change.
