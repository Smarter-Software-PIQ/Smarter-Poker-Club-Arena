# tests/mtt-lateness-ignores-an-event-nobody-entered.law.test.ts

The newest `fn_tournament_launch_lateness_metrics` counts a waiting MTT only when it has a registered or playing entrant. An event nobody entered is cancelled at start + 30 m by `emptyPastStartEvent.ts` and belongs to TournamentNeverStarted (row 450194: the daily empty pilot-club freezeout made every 19:05Z `MttStartedLate` read 2). The migration is versioned after the 5 s freeze-jitter fix `20261128161915` (#12377), pins its installed body as the preimage and keeps its predicate, so it cannot replace that fix (row 450128).
