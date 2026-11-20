# The Limp-Only VPIP Floor Can Reach Tables Judged At Ten Hands (vpipFloorLimpOnlyTenHandWindow, Default Off)

Owner, 2026-11-17 14:34 Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops." And 18:38, of Horses the limp does not keep near the floor: "and if they aren't the get booted and replaced with a new horse."

## What was found

`vpipFloorLimpOnly` (on in production) deliberately left one kind of floored cash table on the old floor: a table known to be judged the Action or Madness way, the whole sitting at ten hands with no warning and no grace (`vpipFloorLimpOnlyTenHandTable`, receipt `vpip_floor_limp_only_not_governed_ten_hand_window`). On those tables the floor still widened ranges and still called raises. Production on 2026-11-19 carried 17 such tables, all at a 40% floor (NLH, PLO4, PLO5, PLO6, PLO8, short deck), and the not-governed receipt fired 20,683 times that day.

## What changed

- `vpipFloorLimpOnlyTenHandWindow` (default OFF, read `=== true`). With it on together with `vpipFloorLimpOnly`, a table judged at ten hands is governed by the same one action as every other floored cash table (`vpipFloorLimpOnlyApplies` is true there): the floor widens no bar, calls no raise and raises nothing; under its line a preflop fold in an unraised pot for at most the big blind becomes the limp or the small blind's completion; raised, the unfloored decision stands. Alone it does nothing. Tournaments, All-In-Or-Fold, bomb pots and Lightning stay out, exactly as `vpipFloorLimpOnlyInScope` already excludes them.
- New receipt `vpip_floor_limp_only_governed_ten_hand_window`. With the new option off, `vpip_floor_limp_only_not_governed_ten_hand_window` fires as before.
- Test support: the sitting simulator of `HorseVpipFloorLimpOnly.test-support.ts` gains `sittingMode` (the whole sitting judged from hand ten, eviction on the spot) and the variants PLO8 and short deck.
- A follow-up switch-list migration registers the option so a switch row can name it. It writes no row.

## Not changed

Option off, every decision is the one it was, draw for draw. Nothing is switched on by this change. The floor, window, eviction and two-hour bar are untouched.

## Evidence

Tests: `HorseVpipFloorLimpOnlyTenHandWindow.test.ts`. Measurement (declared before the run, audit archive `repairs/TENHAND`): see `docs/horse-option-authority.d/vpipFloorLimpOnlyTenHandWindow.md`, which states the Horse VPIP, the eviction rate and the floor cost for each production variant and whether the evidence for switching on is MET.
