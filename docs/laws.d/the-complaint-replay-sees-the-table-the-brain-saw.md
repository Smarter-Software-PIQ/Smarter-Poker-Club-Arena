# server/src/engine/HorseComplaintReplaySeesTheDealtTable.law.test.ts

The horse complaint replay (Phase 5.3) rebuilds a decision with the dealt census the live engine publishes (`dealtSeatIds`, every seat in the snapshot) and with the accepted decisions only: the persisted forced blind posts and the uncalled-bet return never enter `actionHistory`. Without the census an under-the-gun opener whose neighbours had folded replayed as a cutoff; with the posts counted as its own acts a blind opener never got the V73 continue read. Pinned clock.
