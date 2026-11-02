# Horse cash schedule and game restrictions

Owner instruction November 1, effective November 2 00:00 America/Chicago (06:00 UTC): no horse cash play on Pineapple, 6+ / Short Deck, PLO8 or any PLO above .50/1.00. Tournament participation is unchanged. Reduce the current daily cash schedule by 60 percent.

The October 26 schedule already used 0.5 of the original curve. The dated policy retains that before midnight and uses 0.2 afterwards: 40 percent of the current schedule. The same sampled policy reaches the floor planner and new-body admission. Whole-body and table rounding retain playable minima. Current live-table counts naturally vary; policy arithmetic alone does not prove realized table-hours.

Fleet admission and the existing session rotator share the game predicate. The rotator uses its existing leaveTable door, respects pending exits and stay-clock refusals, and does not mutate stacks or delete seats. Tournament seats are excluded from that pass. The database guard independently refuses restricted new horse seats across roster exemptions, preserves existing stack/exit writes and already-owned same-game moves. The cluster's existing opening decision uses the dated capacity scale; no new scheduler, recurring repair or publisher is added.

Native isolated PostgreSQL qualification applies the exact migration against captured predecessor definitions with hash refusal on drift. It exercises the timestamp boundary, stake limits, tournament/human/settlement/move preservation, function grants and all capacity inputs 1 through 32 with both feeder modes. A local-only helper default supplies the future date to exercise the installed trigger before midnight; no production fixture is used. Engine tests cover all 1,440 minutes, UTC/Chicago boundary and connected planner/seeder/rotator wiring.

Delivery is pending protected checks, merge, database installation and verified engine adoption. Scheduled activation and post-midnight observed departures/table-hours are separate acceptance evidence.

Hosted Client shard 7 required an explicit Classic movement-rule preservation assertion in every tick migration. The exact predecessor patch retained that rule; installation now additionally refuses if its call is absent. The 11 Classic law tests and exact native PostgreSQL qualification pass with this assertion.
