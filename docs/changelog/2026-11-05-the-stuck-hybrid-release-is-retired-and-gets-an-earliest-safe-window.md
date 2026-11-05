# The stuck Hybrid release is retired and the Hybrid gets an earliest-safe window

The 06:45Z-12:45Z window announced the Hybrid release at Chicago minute 53.
Under the Phase 1 hourly schedule the engine answers `use_hourly` to any
recovery window that would still be running at the next :58 notice, so the
announcement never froze anything and the run (41995246530-1) stayed behind as
an announced owner. Every later release refused with "cannot compete with
active runtime owner".

Three changes, all through the reviewed release lane:

- The waiting-release withdrawal tool gains one narrow profile for an announced
  owner that never froze. It retires the run only when there is no freeze row,
  no maintenance owner, no later boundary, no maintenance in progress, a
  matching and fresh leader on the still-serving engine, no released hold file,
  an uncommitted request whose own deadline has passed, and an announcement
  older than its whole seven-minute window. Anything else still refuses. The
  seal file grew past the old 256 KiB source bound, so the bound is now 1 MiB.
- A fresh owner-window request now waits, before any reservation or runtime
  entry, until :05:30-:49:00 of an hour. That keeps the whole seven-minute
  window clear of the hourly :58-:05 break. Resumed reservations, Phase 1
  cycles and the certified profile behave as before.
- A new earliest-certified owner window, 13:45Z-19:45Z November 5, admits one
  activation of a target containing the Hybrid merge. The expired minute 53
  window keeps its order, witness and expiry.

No migration, direct host write, watcher or timer is added.
