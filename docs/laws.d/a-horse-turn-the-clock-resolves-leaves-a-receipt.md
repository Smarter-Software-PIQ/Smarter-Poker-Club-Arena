# server/src/engine/AHorseTurnTheClockResolvesLeavesAReceipt.law.test.ts

Every forced check or fold the engine makes at a seat names its reason, and when the seat is a horse it fires horse_turn_resolved_without_decision (with the reason and whether a brain decision was in flight) and writes an engine_recovery_events row, so a horse turn the clock resolved can never again hide behind the same 'forced' origin a blind post carries.
