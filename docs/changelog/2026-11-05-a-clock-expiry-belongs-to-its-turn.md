# A clock expiry belongs to its turn

Two horse turns on the serving engine on November 5 (hand 039c0140, turn
street, and hand 8d98aeb8, turn street) ended with a forced check from the
time bank clock instead of a decision from the brain. In both hands the horse
had taken a deliberate time bank tank on the preflop street and its action
landed in the same instant its action clock ran out. The same seat was first to
act on the flop, so the clock expiry still saw "this seat is current" and spent
an automatic time bank for a turn that had already ended. On a tournament
table that activation is retained by the durable hand lane and published about
0.7 seconds later, by which time the flop turn was running, so the 20 second
bank countdown was armed on the flop turn. The flop turn's own start then reset
the per turn bank flag, nothing released the countdown when the horse acted on
the flop, and 20 seconds after the activation the countdown fired during the
turn street: it cancelled the brain's decision for that street and recorded a
forced check, which in the hand record looks exactly like a blind post.

What changes:

- Every turn clock remembers which turn it was armed for (street, number of
  actions so far, seat). A clock or bank countdown that outlives its turn now
  spends no bank and forces nothing; it is ignored and counted as
  stale_turn_clock_expiry_ignored.
- A deferred automatic bank activation carries the turn that spent it. If it
  reaches publication after that turn has ended it is retired (use it or lose
  it) instead of being armed on the next turn, counted as
  time_bank_activation_retired_turn_ended.
- A seat's action always ends any bank it holds, for horses and humans alike,
  whatever the per turn flag says. A bank left running with the flag off was
  the orphan that fired later.
- A horse's deliberate bank tank now acts at least 2.5 seconds after the
  enforcement deadline instead of exactly on it, so it never races the tick
  that grants the bank.
- Every forced check or fold the engine makes at a seat now names its reason.
  When the seat is a horse it fires horse_turn_resolved_without_decision, the
  reason variant, and whether a brain decision was in flight, and writes an
  engine_recovery_events row. activation.sql reads these receipts, so a day
  with one clock resolved horse turn is visible without reading the engine
  log.

Tests: server/src/engine/aClockExpiryBelongsToItsTurn.test.ts reproduces the
production sequence with a pinned clock, and
server/src/engine/AHorseTurnTheClockResolvesLeavesAReceipt.law.test.ts pins the
receipt. Read only verification SQL for horse forced actions per day lives
beside the evidence report in the archives.
