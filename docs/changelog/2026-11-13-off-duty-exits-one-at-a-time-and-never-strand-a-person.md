# Off-Duty Exits Go One At A Time And Never Strand A Person (2026-11-13)

Raised by the Human vs Horse owner (coordination inbox, 15:24Z) on this lane's
work-schedule exits (#10607).

- Horses that share a work window reach its end together, so one rotator cycle
  could stand a whole table up at once (the loudest tell a floor has), and a
  person at that table could be left playing alone.
- `HorseWorkSchedule.offDutyExitNow`: at most one off-duty exit per table per
  cycle; none while a person is playing there and the table would drop below
  four (the seeder's rescue floor: it brings an on-duty horse, and the off-duty
  one goes home on a later cycle); HIT AND RUN and the big-pot orbit still
  decide when. Roster and policy exits keep their immediate door.
- A table that had a shift-change exit is not thinned again in the same cycle
  by an ordinary session end, unless a person is waiting for the seat.
- Deferred exits count in `/health` `horseWorkSchedule.offDutyLeavesDeferred`.
- Declined in the same reply: counting fallbacks to the capped tick in
  ClusterController. The release door gate refuses an engine whose uncapped
  database doors are missing and both are installed, so that fallback cannot
  fire.
