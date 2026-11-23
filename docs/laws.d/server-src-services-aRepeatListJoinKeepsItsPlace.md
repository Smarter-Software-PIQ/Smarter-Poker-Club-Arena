# server/src/services/aRepeatListJoinKeepsItsPlace.law.test.ts

A horse already holding an open place on a game's list ('waiting', or 'notified' once the tick calls its name, the two statuses cash_game_waitlist_one_open counts as open) is never put down for that game again: the fleet reads every open place, the planner still sees only waiting rows, and keepHeldPlaces drops the repeat arrival so the existing row keeps its place and the rest of the batch insert lands instead of the database refusing all of it (23505).
