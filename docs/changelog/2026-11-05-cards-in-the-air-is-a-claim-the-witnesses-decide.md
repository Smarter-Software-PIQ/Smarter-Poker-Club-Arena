# 2026-11-05 - cards in the air is a census claim; the two physical witnesses decide

## What happened

Engine 71087373 missed seven certified breaks in a row
(`breaksSinceRestartCertified: 7` at 00:50Z on 2026-11-06), each shut by
`unparkedReasons: {cards_in_air: N}`. At the 23:20Z break the one table was
9139b7d2: it prepared a retained original hand 348 ms after the announcement
(`Hand #55574170 - 2 players` at 23:20:01.301) and parked UNSTARTED at the
pause gate (`Parked between hands` at 23:20:01.536). Nothing was dealt and
nothing was written. The engine census counts any set `handController` as
cards in the air, so the restart certificate stayed shut for the whole break.

The engine-side fix landed separately in #9615
(`isPreparedOriginalHeldForMaintenance`, 997ea9814), but an
engine fix only runs once the engine is replaced, and the replacement needs
the certificate the bug keeps shut. The release could not cut over through the
door it repairs.

## What was measured live (01:00Z break, 2026-11-06)

| Witness                                                      | Reading                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine census `unparkedReasons`                              | `{cards_in_air: 3}`: tables bcca79f3, 21f7e3b0, aed78e3f                                                                                       |
| Engine log, each table                                       | `Hand #N` prepared, then `Parked between hands` within 330 ms of the 00:58:00 announcement (aed78e3f: crash-recovered hand parked at 00:51:22) |
| Engine `handsInFlightTotal`                                  | 0 (it already read 0 during the last-hand notice, with 3 tables still playing, so it is not decisive)                                          |
| Database, incomplete `hand_state_snapshots` written in 600 s | 0                                                                                                                                              |
| Database drained-boundary witness                            | `moving_tournament_hands=3`, the permits the three unstarted hands reserved                                                                    |

Every dealt hand writes an incomplete snapshot and keeps writing until it
completes. Zero such rows in ten minutes means no cards are in the air.

## What changed

`maintenance_certificate` in `engine-release-transaction.sh`: `cards_in_air`
is a census claim, not a witness. It is no longer an automatic refusal; it is
admitted ONLY when:

1. `handsInFlightTotal` is present and exactly 0, and
2. `engine-release-inflight-hands.py --max-age-seconds 600` answers quiet:
   no incomplete hand snapshot written in the last ten minutes, so a hand
   stuck for minutes still refuses.

The drained-boundary mode is deliberately not used: it counts the tournament
hand permits the unstarted hands reserved, and a successor re-adopts those
from their rows (the retained-original custody path, as aed78e3f's own crash
recovery shows). Every bank, custody, accounting and unknown reason still
refuses before the database is asked. The bounded F06 classes alone keep
their unchanged proof. `STRICT_RESTART_CERTIFICATE=1` still refuses
`cards_in_air` outright.

## Laws

- `tests/a-stopped-bank-that-can-never-be-released-does-not-hold-the-restart-shut.law.test.ts`
  section 5: admitted only with zero live hands and the in-flight database
  proof at 600 s; refused on database answers 1, 3 and 127, on a non-zero, absent or
  string live-hand witness, and beside any bank reason. The set is pinned to
  exactly `{"cards_in_air"}`.
- `tests/operations/eed-drained-cutover.test.py`: strict refuses; ordinary
  hands the claim to the database proof (exit 5), never admits it on the
  census alone.
- Source pins in `noServingReleaseBuysACustodyException.law.test.ts` and
  `a-preparation-that-can-never-resolve-is-not-a-hand.law.test.ts` follow the
  new gate text: still exactly one `return 0`, no bypass words.
