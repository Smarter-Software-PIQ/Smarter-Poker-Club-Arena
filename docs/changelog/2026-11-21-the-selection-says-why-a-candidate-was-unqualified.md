# The daily selection says why a candidate's prequalification was unavailable

**2026-11-21.** The 03:30 Chicago selection (`daily-engine-selection-2026-11-21`, run 44878744050) kept
serving bb21dc82 and deferred ac1d44ba as `prequalification unavailable`. The helper
(`read-engine-prequalification.py`) had answered `qualification inputs differ from selected control`:
owner-window booking #11590 (f13be90d) rewrote pinned constants in `server/scripts/*`, which are inputs of the
qualification projection, so every candidate merged before the booking could no longer qualify against the
cutoff control. The selector threw that sentence away (stderr was captured and discarded), so the receipt
gave no cause and the release lanes searched for one for hours.

The deferral keeps its `reason` string unchanged and now carries `detail`: the helper's last refusal line,
at most 300 characters (or `no refusal text`). Law: `tests/operations/daily-engine-selection.test.py`
`test_deferred_prequalification_keeps_the_helpers_refusal` (errors against the old selector).

The booking churn itself is removed by the three-hourly scheduled cutover (#11609), which needs no per-window
constants; the freeze baseline's yield to a later booking was fixed by #11601.
