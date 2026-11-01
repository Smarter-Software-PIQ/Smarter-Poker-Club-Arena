# Stall progress requires a recorded hand

The existing `fn_ca_table_stall_watch_ingest` closed a stall as `table progressed`
when its table disappeared from the silent-table sample. A complete count of
silent samples does not establish that a particular table dealt another hand.
Fourteen linked October 31 episodes used that outcome; none had a hand-history
row between detection and the recorded closure in the read-only investigation.
Seventeen further episodes ended because a tournament break began; those are
intentional-wait observations and remain distinct from progress.

The correction replaces that absence inference in the existing ingestion
transaction with an indexed, exact-table hand-history witness after the alert's
detection and no later than the observation. The alert retains that hand's ID
and timestamp. An absent, malformed, stale, future or foreign-table witness
keeps both the alert and its watch state. No schedule, game, money, release or
financial repair is introduced. Existing intended-wait classification remains.

Validation and delivery are recorded in the task checkpoint. This source is not
installed or live merely because this document exists.
