# Cash throughput binds the engine population policy

Incident 4f4b34fa-b309-4d05-9961-f434fc7b4b92 compared a current cash rate of
0.5479 hands/second with a same-hour mean of 1.5203 on November 16. The
installed admission cohort represented only the SQL horse arrival function.
The source had meanwhile enforced the owner's seat ceiling (#10723) and
changed the overnight taper (#10823), without changing that SQL function.
The old cohort could therefore compare different planned floor populations.
Readback at 13:30 UTC: the prior one and two days were 0.4073 and 0.3300
hands/second, both below today; the third day was 3.8190 and dominated the
mean. Offsets four through six were absent.

The engine now publishes a 52-bit policy fingerprint in horseWorkSchedule.
It describes the complete daily body/seat curve at a fixed reference
population and the applicable cash variant/stake admission. It does not
contain actual seats, hands, current hour, wallets or player identity. Moving
from night to peak hours under the same policy retains the same fingerprint.
The existing collector combines it with the installed SQL admission identity.
The existing same-cohort recording rules and three-day minimum remain intact.
An older engine or failed read publishes unknown, never a zero or an old
SQL-only cohort. The existing baseline-unavailable warning exposes the warmup.
Zero-hand, stalled-table and fleet-loop alarms remain independent.

This changes monitoring evidence only; it never raises the owner traffic
curve or changes gameplay. Exact engine and monitoring publication, live
policy readback, loaded rules, and alert quiet-period verification are still
required. Source/local checks are not production completion.
