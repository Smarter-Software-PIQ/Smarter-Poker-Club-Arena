# Empty-event cancellation uses its original bounded admission

Incident 88afa4d5-b7f9-4431-adde-eb2b740b6c25 fired on November 16 at
19:45:26 UTC. Empty MTT `45d1c21f-2a5d-4781-a281-6c412081541f`, Daily 25
Chip Freezeout, was due at 19:00 UTC. Its original cancellation was refused
with `CANCELLATION_GLOBAL_LANE_BUSY` ten times between 19:32:42 and 19:44:49.
Each single-shot refusal deferred admission for another minute. Cancellation
naturally committed at 19:45:58; the immutable version-2 receipt proves no
entrants, seats or refunds, and exact-zero escrow closure. Alertmanager sent
its resolved signal at 19:46:36. No manual lifecycle or financial write was
used to clear the incident.

GameServer's empty-event request omitted `throughCancellationLane`, already
used by tournament cancellation callers to find a gap between overlapping
hand settlements. It now uses that same bounded original-request admission
for both empty MTT cancellation and fixed-satellite expiry. Single-flight
ownership remains held during admission. The existing ownership predicate is
rechecked after each pause, so stop, maintenance or a superseding admission
cannot begin another attempt. Successful and non-lock answers are never
repeated, and the existing fallback remains after the bounded budget. SQL
financial exclusion, cancellation receipts and eligibility rules are unchanged.

The discovery regression failed on the original code: its cancellation owner
was released after the first busy answer. With the repair it retains the
owner through two refusals, commits on the third answer in the same request,
clears the durable empty-top-up count only afterward, and does not re-cancel
on the next discovery pass. Additional coverage preserves unknown/refused
outcomes and stops bounded admission when ownership ends. Focused evidence
and release/live verification remain in the incident's owning checkpoint.
