# server/src/engine/horseComplaints/a-replay-keeps-the-live-decision-rules.law.test.ts

A horse decision replayed from its recorded public node (HorseComplaintReplay.stateAt) gets the state the live engine handed the brain: schema version 1, which arms the authoritative legal-menu check, and the table's recorded all-in-or-fold rule, so a replayed answer never leaves the recorded menu and an AoF chart call replays as the all-in the live engine commits (#8196), not as a call on a fold / all-in menu.
