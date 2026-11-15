# The engine queue never shows the past

2026-11-14. Reported by Dan with a screen recording of Whytegold502 (Android
tablet, the Google app's browser): "It's sitting him out, even when all he did
was fold. It's auto folding him."

## What was read

- `hand_history` for his seat at Kings Club Classic PLO4 0.25/0.50. From
  01:57:21 to 02:14:34 UTC, 24 of the 25 turns he had to answer on the clock
  ended `origin: forced` at 17.0 to 17.5 seconds, the turn clock. One fold got
  through. Each pair of timeouts sat him out, he pressed I'm Back, posted, and
  was timed out again.
- Before that, in the same page load (01:47), his own answers took 4, 8, 13,
  16, 19 and then 26 seconds. The time to answer grew with the age of the page.
- `client_error_events`: 19 `STALE_ACTION` refusals for him tonight and none
  for anybody else. Set against the hand record, his taps reached the engine 5
  to 22 seconds after the clock had already expired, or in the first second of
  his next turn. He was answering turns that were over.
- The recording agrees. His table shows a raise still waiting on another
  player while the engine was already 17 seconds into his own clock. The
  Sitting Out bar, which is read from his seat and not from the event queue,
  was already counting.
- The same device took over two seconds to open IndexedDB fifteen times and
  ran 109 request deadlines out tonight, against 2 for every other player
  together. Its main thread is saturated.

## The cause

`EngineStateClient` puts every engine frame in one FIFO and dispatches one
EVENT per macrotask, each a full synchronous render of the table. State frames
wait behind the events in front of them. The queue had an order and no clock:
on a device that renders an event slower than the engine emits them it only
grows, and the table, including the player's own `turn_change`, is shown later
and later. A reload empties it, which is why each new page played normally for
a few minutes.

This was read from the code and from his timings. It was not measured on his
tablet, which nobody here can profile. The new report below is how it will be.

## The fix

Two bounds in the queue, both measured from when a frame arrived.

- Behind by 400 ms: the drain stops yielding between events, for a burst of at
  most eight. Each event still reaches its listener on its own and in order.
  Nothing is lost; a paint and a timer wait per event are saved.
- Behind by 3 seconds, on a visible page: the table is brought to the present.
  Every queued state frame is applied in order. An event the engine says is
  still owed, one carrying `replay_until` (the hub's own rule for what it hands
  again to a client that missed it), is delivered tagged `replayed`. The newest
  `turn_change` is delivered under the same rule as the live path. Every other
  queued event is a moment that has passed, exactly what a client that had just
  reconnected would never have been sent, and the hole is reported once as
  `engine_event_gap`, which the table already recovers from.

A device that keeps up reaches neither bound. A hidden tab, whose timers the
browser throttles, is left alone until it is shown again.

Each time a table is brought to the present the client reports
`EngineStateClient.inbox_skipped_to_present` (at most once a minute) with how
many events were passed over and how late the queue was.

Client only. No engine or schema change. Pinned in
`tests/engine-event-ordering.test.ts`.

## Animations

Section 10.6 says an animation plays every time it is owed. On a device three
seconds behind, the animation for a moment that has passed is no longer owed in
any sense the player can use: showing it is what folded him. The first bound
exists so that an ordinary slow moment costs no animation at all, and only a
device that still cannot keep up reaches the second.

## Not done here

Why one render of the table costs that device so much is a separate question.
This change makes the table correct on a slow device; it does not make it fast.
