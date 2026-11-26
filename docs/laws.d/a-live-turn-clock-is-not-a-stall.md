# server/src/engine/aLiveTurnClockIsNotAStall.law.test.ts

`msSinceProgress()` and `runTableWatchdog()` share a single authoritative `hasLiveBoundedInHandClock()` predicate so an active, bounded, server-owned turn or runout/discard clock never fires false `TableStoppedDealing` pages (incident 9313cabc), while between-hands stalls, lost/expired/corrupted deadlines, recovery re-arms (`forceArmTurnTimer`), and turns past the hard wall-clock ceiling always surface immediately.
