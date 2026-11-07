# tests/an-empty-event-cancel-takes-the-lane-one-at-a-time.law.test.ts

2026-11-07: the engine asks atomic_cancel_tournament for one empty past-start event at a time across the process, because the database admits one cancellation at a time through its exclusive terminal-settlement lane. A CANCELLATION_GLOBAL_LANE_BUSY or CANCELLATION_BARRIER_BUSY refusal (55P03, nothing written) is asked again after a minute without an error report; every other refusal keeps the thirty-minute clock and its report.
