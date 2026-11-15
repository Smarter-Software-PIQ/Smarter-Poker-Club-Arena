# A Hold'em river full house leads for value (default OFF)

2026-11-15, Hold'em Strategy lane. Owner order 11:20 Chicago: the Hold'em hands audited against people are shared and built on.

The 131 flagged river decisions of the shared audit (all holding a full house or better) were replayed on main. The calls, check-backs and folds that still reproduce are under-fulls or boards that play, where the line is right. One pattern is live: out of position without the betting lead, the V11 initiative gate checks every river full house to the prior aggressor (48 of the 67 audited checks still do). On the river a check-back ends the hand with no value won.

New option `holdemRiverFullHouseValue`, read only as `=== true`, default OFF: in no-limit hold'em on the river, a full house or better that uses a hole card (not an under-full, not a trips-board boat, not the board playing) leads 70% of the time through the existing monster sizing; the rest keeps the check. Receipt `holdem_river_full_house_lead_seen`, ledger flag, league card `nlh_river_full_house_value`, evidence file `docs/horse-default-on.d/holdemRiverFullHouseValue.md`.

Off changes nothing: the 131 replayed spots are identical with the option unset, and the test pins unset equal to false.

Not measured for value yet; it stays off until its declared evaluation and review.
