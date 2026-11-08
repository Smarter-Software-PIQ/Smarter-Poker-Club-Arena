# 2026-11-08 - Satellites are named for the event they feed

Dan, verbatim: "If its a satellite, it should say 'Satellite Into 40 Chip Freezeout'"

Migration `20261108213926_satellites_are_named_for_the_event_they_feed.sql`.

- A satellite's name is now `Satellite Into <target>`, read from its own target
  link (`satellite_target_id` / `satellite_target`), with the target's
  guarantee phrase removed because the satellite itself guarantees nothing:
  "40 Chip Freezeout - 1.5K GTD (NLH)" -> "Satellite Into 40 Chip Freezeout (NLH)".
- Set by the existing copy trigger on every insert (and on a change of name or
  target), so every spawner gets it without server changes.
- Typed names were sometimes wrong about the seat's destination (read
  2026-11-08: "Funday PLO Opener Satellite 5" feeds Sunday Funday PLO Closer;
  "Prime Time Satellite 5" and "25 Chip Daily Rebuy (NLH) Satellite 5" both feed
  25 Chip Bankroll Builder). The new name always tells the truth.
- Twins: the owner sheet has two schedules feeding one event at one minute for
  one entry. The scheduled-occurrence unique index would have made the second
  read as a duplicate and silently not spawn, so a name already held at that
  minute only by other schedules is numbered "#2". A second spawn of the same
  schedule is still refused.
- The lifecycle guard admits exactly this rename (plain or "#N") on a
  registered event, inserted by reading the installed definition under an md5
  preimage check.
- 109 open satellites renamed (2 numbered "#2"); probed in a self-aborting DO
  block with zero refusals. Completed and cancelled history keeps its names.
