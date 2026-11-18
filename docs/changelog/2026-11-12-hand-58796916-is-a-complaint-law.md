# Hand 58796916 Is A Complaint Law

Tests only. No engine behaviour changes.

The owner's reported hand (PLO4 cash, 2026-11-12: a Horse moved all in with a straight on a flush-completing river into two players who had called two barrels) now sits with the other complaint replays as `server/src/engine/horseComplaints/plo4-straight-jams-flush-river-into-two-callers.law.test.ts`. The fixture is the recorded hand with the engine's own public snapshot at the river decision, anonymised to seat numbers; the Horse's own cards are the only cards in it.

The law replays today's brain at that recorded node for the live hybrid profile and every base style: no profile moves all in at any seed (all check). The control, V40 off, moves all in again, so the law is not vacuous. Opponent memory is off in the replay, as in every complaint law.
