# Small-fleet dealing is still a real hand

Incident 076ff467-7c46-4966-b67d-35eaafcfce22 missed the November 16 daily cutover because the original selection found no candidate with complete current evidence. Its latest physical copy lacked four installed migrations. A subsequent fresh-schema Backup run 43876952794 exposed a connected qualification defect: rollback rehearsal failed after 300 seconds despite real committed hands.

At 13:58 UTC Backup's isolated database contained five hands committed in the preceding five minutes. Its healthy engine reported one expected dealing table and `dealRate.handsInWindow: null`. DealRateVerifier returned before counting hands below its three-table alarm denominator. The rehearsal required that unavailable metric as well as a fresh database hand, so healthy small fleets could never qualify.

The producer now observes the count for one or two tables, including startup grace, without changing the floor alarm, silence denominator, maintenance guards or dead-fleet verdict. Read failures remain unknown. The predecessor rehearsal accepts its original fresh committed-hand witness after open play, with unchanged health, runtime identity, maintenance and time-budget checks. This supports rollback to an older serving engine whose count producer is still unavailable at that size. Candidate soak and positive dealing evidence remain required.

Regression tests failed before the producer and consumer corrections. Focused verification, protected integration, Backup certification, engine publication and live proof are recorded separately; deployment remains pending.
