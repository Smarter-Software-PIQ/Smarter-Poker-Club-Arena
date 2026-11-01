# Delayed tournaments stay in the lobby

Saturday Mystery retained all 112 entries when a manually imposed start hold prevented its 8 PM start, but the lobby excluded unstarted events as soon as their advertised start time passed. The owner explicitly requires delayed tournaments to remain discoverable and forbids agents from imposing new-tournament holds without an explicit owner instruction.

The schedule visibility filter now retains unstarted events with valid scheduled dates, including across midnight and DST. Terminal events remain excluded; the existing Start Pending clock describes the delay without claiming that play started. Registration, financial records, maintenance safeguards and the running-event history rule are unchanged.

The canonical shared owner policy and its portable copy now prohibit inferred start holds from cleanup, closure, audits or recovery. Explicit holds must record the exact owner instruction, source, scope and release condition. This is an agent operating requirement, not a claim that PostgreSQL can authenticate natural-language owner intent or that privileged access is technically incapable of violating policy.

Regression tests reproduce disappearance on the previous implementation and cover the start boundary, a 30-minute delay, midnight/DST, and cancellation. Operational recovery and the independently verified 8:30 start were recorded separately; this change is the durable lobby correction.
