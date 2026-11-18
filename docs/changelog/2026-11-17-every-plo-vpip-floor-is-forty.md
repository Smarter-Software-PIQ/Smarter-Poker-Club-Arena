# 2026-11-17 - PLO5 Madness comes to 40 as well, and stops being known by a number

Owner ruling, 2026-11-17: "lower the vpip down to 40%", and then, when the
first pass left the Madness cluster at 50, "PLO5 MADNESS NEEDS TO GO TO 40".

The earlier migration (`20261118004324`) took Classic plo5/plo6 to 40 and
deliberately held Madness at 50. That was a misreading of the ruling. This
finishes it: after `20261118025205`, nothing in the estate carries a 50% VPIP
floor.

## Shipped

- `fn_cash_game_floor_from_template` no longer pins `vpip_floor` to 50 for the
  `madness_without_lightning` profile. The branch still supplies the rest of
  the madness ruleset; 40 is already that template's own default.
- The `madness_without_lightning` clusters and their live tables moved to 40.
- Both the pre-image and post-image of the trigger are hash-pinned, so a
  drifted source or a mistyped transcription is refused rather than installed.

## The number was an identity, which is the part that could have broken quietly

`server/src/services/HorseMadnessSelection.ts` decided a table was Madness by
`Number(table.maintain_percent_min) === 50`, and only there ordered horse
candidates by measured PLO performance.

- Moving the floor to 40 and leaving that check alone would have switched the
  ordering off silently. The condition would simply stop matching. No test
  fails, nothing is logged.
- Dropping the floor clause instead would have been worse. Lightning and Action
  plo5 tables run the same bomb pot, big-blind ante and nit game, and now the
  same 40 floor, so they would have started being ordered as Madness.

The identity moved to the ruleset the trigger itself keys on,
`rules_profile = 'madness_without_lightning'`, kept inside the plo5 scope the
ordering was measured on. `HorseFleetManager` now carries that profile through
its cluster join. `tests/every-plo-vpip-floor-is-forty.law.test.ts` pins it,
including that no executable line decides Madness from `maintain_percent_min`
again, and two new selector cases prove a 40-floor Madness table is still
ordered while a Lightning table never is.

## Three stale live-proofs retired

Moving the Classic floor invalidated `@live-proof` expressions on two October
migrations, and this change invalidates a third. They are correct history, and
their bytes are pinned, so they are retired through the maintained registry in
`scripts/ci/applied-migration-aliases.json` rather than by editing the files:

| migration        | proof it pinned              | superseded by    |
| ---------------- | ---------------------------- | ---------------- |
| `20261024212524` | Classic plo5 floor = 50      | `20261118004324` |
| `20261024213131` | Classic plo5/plo6 floor = 50 | `20261118004324` |
| `20261024200548` | Madness cluster floor = 50   | `20261118025205` |

Without this, `migration-ledger-reconciled.yml` would have gone red on its next
run - it evaluates proofs older than 24 hours, so the breakage was latent, not
immediate.

## Deliberately not changed

- **Every other variant's floor**: plo4 30, nlh 20, pineapple 25, flo8 25,
  plo8 30, short_deck 20, flh 15. The ruling was about the PLO floors.
- **Lightning and Action tables** already read 40 and keep it.
- **The retired certification clubs** keep 50 on spent fixtures;
  `fn_guard_retired_club_mutation` makes those records read-only by design.
- **`vpip_window` / `maintain_hands`** - the window a floor is judged over is a
  separate decision and was not part of this ruling.
- **Everything else `20261024200548` established** - the profile, the bomb pot,
  the big-blind ante, the nit game - is unchanged and still live. Only its
  floor assertion is superseded.
