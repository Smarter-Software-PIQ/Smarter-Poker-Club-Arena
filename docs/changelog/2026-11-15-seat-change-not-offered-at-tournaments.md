# 2026-11-15: Seat Change is not offered at a tournament table

Fifth table-menu delivery, after #10924, #10933, #10947 and #10977.

## A switch that changed nothing

Checked live at a running MTT table (Sunday Funday Kickoff, watched without a
seat) after #10977 published: the menu offered "Seat Change ON". That switch
only shows or hides the must-move Seat Change button, and `CashClusterHUD` draws
that button at cash cluster tables alone (`!tableState.isTournament &&
tableState.clusterId`). At a tournament the press flipped a stored preference
and nothing on the screen moved: the silent button Dan reported on 2026-11-14.
Tournament seats are assigned, so there is nothing for the row to do there.

The same live check confirmed #10977 at a running Lightning PLO5 1/2 table: the
menu shows the disabled "Seat Change, Off In Lightning" row, and a spectator is
offered no seat-only row.

## Change

- `seatChangeEnabled` in TablePage is false at a tournament table. It is not
  Lightning there, so `seatChangeOffInLightning` stays false and the menu draws
  no Seat Change row at all.

## Proof

- `tests/unit/seatChangeSaysWhyItIsOff.test.tsx`: the page reports seat change
  off at a tournament (fails on the previous code), and the menu then draws no
  Seat Change row.
- Every post-deploy live proof that presses the switch runs at cash tables, so
  none of them changes.

Client only. No engine, schema or money path.
