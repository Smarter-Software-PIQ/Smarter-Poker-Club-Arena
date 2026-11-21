# Upgrade 10 is counted where it acts

Measured 2026-11-21 (read-only): `horse_upgrade_evidence_daily` showed upgrade 10 invoked on 0 of 1,893,500
no-limit hold'em decisions on Nov 18 to 20, while `holdem_gear_shift_reach_seen` (the 0.90 reach, option
holdemGearShiftReach, on by production row since 2026-11-15) fired 700 to 3,000 times a day under no upgrade's name.
`upgrade10_gear_shift_engaged` has never fired and `upgrade10_fast_window_engaged` fired 152 times in nine days. The
fast window's OFF switch (a read withdrawn from a player the window calls calm) fired no counter at all.

## Counters only (no decision changes)

- `upgrade10_fast_window_calmed_seen` fires where the fast window withdraws a read: the flop-stab OFF, the
  preflop-calm withdrawal of rfi and threeBet, and the back-inside withdrawal in `opponentExploitRead`. It is covered
  by the ledger receipt `upgrade10_*`.
- `holdem_gear_shift_reach_seen` and `upgrade10_fast_window_calmed_seen` are upgrade 10 evidence needles
  (HorseUpgradeActivationManifest), so the per-Horse evidence counts them. `upgrade10_fast_window_ready_seen` stays an
  opportunity counter, not invocation evidence.

No read changes: on 12,291 live opponent profiles `opponentExploitRead` and `flopStabStatRead` return the same reads
as main, with and without the 0.90 reach. upgrade10IsCountedWhereItActs.test.ts pins that every replayed read is
the same with telemetry armed and disarmed, that the new counter fires on a read if and only if a long-window read is
withdrawn, and the evidence mapping.

## Considered and dropped

A precedence fix that let the gear-shift branch's 0.95 line apply once the long mean has crossed the envelope edge
was built as an unused argument and dropped: it had no caller, changed none of the 12,291 real profile reads, and
moved a read by only 1 to 2 hands in replay, so an unused path does not go into the engine.

## Limits

- The gear-shift branch (0.95, long mean inside the edge) still engages on no replayed hand: the long mean crosses the
  edge before the 12-hand fast window is 95% credible beyond it.
- The opportunity-gated statistics rarely hold 8 fast opportunities (the fast window ages every hand): riverCall
  never, foldToBet 0.8% of profiles, threeBet 1.8%. Not changed here.
- Omaha and fixed limit have no 0.90 reach. Not changed here.
