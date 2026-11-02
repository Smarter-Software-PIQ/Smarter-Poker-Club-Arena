# Caption bounds precede wager placement

Required delivery blocker for the November cash policy: hosted portrait shard 5
(run 41378687675, job 125065201514) failed twice at 480px / nine seats. The
retained trace shows the hero crown rise changing from 22px to 27px after its
wager had received a permanent offset. The resulting tag moved five pixels
into the wager's two-pixel clearance, producing a three-pixel overlap.

SeatSlot already owns crown/tag measurement, but its ResizeObserver can queue
that measurement behind the table's placement. The existing finite placement
transaction now requests that measurement synchronously after artwork
normalization and before reading caption obstacles or marking wagers landed.
No artwork, font/control size, gameplay state, animation or timer changes.

The existing occupied-portrait browser regression checks the actual overlap
and retained wager stability. Both installed Chrome and pinned Chromium passed
before locally, so the before-failure evidence is the hosted trace, not a
claimed local reproduction. Final validation results are recorded in the task
checkpoint and PR checks.

Real-time law: existing player_action events remain the gameplay trigger;
seatcaptionmeasure is a synchronous local geometry request, no snapshot diff.
