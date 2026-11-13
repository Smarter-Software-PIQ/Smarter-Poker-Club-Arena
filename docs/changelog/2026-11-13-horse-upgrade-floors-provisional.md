# The Upgrade Counter Floors Are Provisional Until A Live Day Is Measured

`2026-11-12-horse-activation-hardening.md` gave `upgrade01_action_line_posterior`, `upgrade02_card_removal_scored` and `upgrade06_public_timing_hint` a floor of 0.05 percent of `decide` in `HorseDataLedger.ts`. Those counters had never served when the floor was written. This withdraws the floors and keeps the denominator. No decision, wager or timing changes; no counter is removed.

## Why

The receipt audit (`fn_audit_data_receipts`) reads a floor as fact. With one set, zero fires against 1,000 or more decisions is reported as critical. That report cannot tell these apart:

1. No eligible opportunity (the denominator is every decision, preflop included, not postflop decisions).
2. Eligible opportunities and no invocation.
3. Missing telemetry for the day.
4. A real activation failure.

It is also not reset-safe off schedule: an engine that boots between 06:00 and 09:00 UTC with the previous day unaudited can run the audit before its first telemetry flush, and the new ledger rows would then read as a dark layer for a day on which the counters did not exist.

An unmeasured rate is not a rule, so it is not written as one.

## What Stands

- Each of the three receipts still names `decide` as its denominator, with no minimum. The receipt audit computes nothing for them until a minimum exists.
- The drift audit (`fn_audit_layer_drift`) still judges each counter against its own history: silent after firing on two days of the week, or a fall below 40 percent of its own median rate with at least three days and 5,000 prior fires. Both need live history, so neither can fire on an unmeasured counter.
- The proposal is recorded in the ledger comment as provisional: 0.0005 of `decide`, to be validated against the first complete live UTC day. For scale, postflop decisions were about 26 percent of `decide` on 2026-11-11 (`decide` 1,880,398, `preflop_v7` 1,396,330).
