# A Seat That Leaves The Top Lane Drops Its Shift

Dan, 2026-11-02, Sunday Funday Late PKO Table 2: "WHY IS JAM_DEGEN SITTING IN
THE MIDDLE OF THE TABLE ALL OF A SUDDEN?"

## What happened

useProtectedCardLayout lowers the phone layout's top-lane seats so their art
clears the jackpot plate, writing an inline `translate` and
`--sp-top-seat-shift` on the pod. On a nine-seat table the lane is
`.seat-wrapper--top`, and TablePage only gives a top seat that class when
`!tableState.isTournament`.

The engine restarted at 05:54:50 UTC. On reconnect the tournament table
rendered one snapshot as a cash table, its two top seats carried
`seat-wrapper--top`, and the hook shifted each by its own art: jam_degen's
taller VIP Vigilante art 110px, WadeJr's Cyborg 39px. When `isTournament`
returned, both seats became cap-only and left the lane, and both the per-pass
reset and the unmount cleanup only visited pods still in the lane. The shifts
stayed for the rest of the session: jam_degen's seat sat 71px below its mirror,
on the felt. A fresh load showed both seats with no shift, on the rail.

## The fix

Every pass clears the shift and its cache from any cap or top pod outside the
current lane, and the unmount cleanup clears every cap and top pod. The shift
belongs to the lane, not to the seat.

## Test

`tests/unit/protectedCardLayout.test.tsx`: a pod shifted in the lane, then
re-rendered cap-only, carries no translate and no shift. Fails before, passes
after.
