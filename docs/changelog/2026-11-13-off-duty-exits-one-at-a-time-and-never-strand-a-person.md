# Off-Duty Exits Go One At A Time And Never Strand A Person (2026-11-13)

Raised by the Human vs Horse owner (coordination inbox, 15:24Z) on this lane's
work-schedule exits (#10607).

- Horses that share a work window reach its end together, so one rotator cycle
  could stand a whole table up at once (the loudest tell a floor has), and a
  person at that table could be left playing alone.
- `HorseWorkSchedule.offDutyExitNow`: at most one off-duty exit per table per
  cycle. While a person is playing there and the table would drop below four,
  the exit waits up to 10 minutes (`OFF_DUTY_PERSON_GRACE_MS`) for an on-duty
  replacement; after that the horse goes home anyway, so the schedule is always
  kept, and the seeder's rescue (which fires below the same floor) refills the
  person's game. HIT AND RUN and the big-pot orbit still decide when. Roster
  and policy exits keep their immediate door.
- A table that had a shift-change exit is not thinned again in the same cycle
  by a discretionary departure (a table change or a session ending). A person
  waiting for a seat and the stop-loss exit still run.
- Deferred exits count in `/health` `horseWorkSchedule.offDutyLeavesDeferred`.
- Declined in the same reply: counting fallbacks to the capped tick in
  ClusterController. The release door gate refuses an engine whose uncapped
  database doors are missing and both are installed, so that fallback cannot
  fire.
