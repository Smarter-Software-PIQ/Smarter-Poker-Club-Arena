# 2026-11-17 - the Classic PLO VPIP floor comes down to 40

Owner value, 2026-11-17: "lower the vpip down to 40%", and 50% stays for the
Madness games only.

## Shipped

- Classic plo5 and plo6 tables now keep a 40% VPIP floor instead of 50%.
- The floor was never stored in one place. `fn_cash_game_floor_from_template`
  resolves the template default first and then raises it with `GREATEST`
  against the `ca_classic_vpip_floors` config row, so the live value was the
  larger of two numbers that both read 50:
  `fn_cash_template_defaults('classic','plo5'|'plo6')` and the config row.
  Changing either alone is a no-op, because `GREATEST` keeps the other at 50.
  Both now read 40.
- Open Classic plo5/plo6 clusters were re-resolved, and the live tables that
  carry their own materialized copy of the floor were brought across.

## Madness is untouched, and that is enforced

The trigger's `madness_without_lightning` branch pins `vpip_floor` to 50
explicitly, before the `GREATEST`, so neither source above can reach it. Two
other things depend on that number staying 50:

- `server/src/services/HorseMadnessSelection.ts` identifies a Madness table by
  `Number(table.maintain_percent_min) === 50` and only there orders its horse
  candidates by measured PLO performance.
- `20261024200548_plo5_one_two_madness_without_lightning.sql` carries an
  `@live-proof` asserting that cluster still reads 50.

The migration's verify block refuses the whole change if either stops holding.

## Verified live

Active clubs, after the change:

| Surface                                    | VPIP floor | Live tables |
| ------------------------------------------ | ---------- | ----------- |
| Classic PLO5                               | 40         | 5           |
| Classic PLO6                               | 40         | 9           |
| PLO5 Madness (`madness_without_lightning`) | 50         | 4           |

Nothing outside the PLO5 Madness cluster carries 50 any more.

## Deliberately not changed

- **The retired certification clubs.** 48 tables there still read 50.
  `fn_guard_retired_club_mutation` makes a retired club's gameplay records
  read-only, and those tables are spent `Cert HU` / `Cert RH` /
  `Crest Cert Template` fixtures, not games anyone sits at. Excluding them is
  why the table update filters on `c.lifecycle_status <> 'retired'`.
- **Every other variant's floor.** plo4 30, nlh 20, pineapple 25, flo8 25,
  plo8 30, short_deck 20, flh 15 are all unchanged. The owner value named the
  Classic PLO floor, and raising a floor that already sits below 40 would not
  be lowering anything.
- **`vpip_window` and `maintain_hands`.** The window a floor is judged over is
  a separate decision from the floor itself and was not part of this ruling.
- **The Short Deck tables named Madness.** `SHORT_DECK 0.25/0.50 Madness` and
  `SHORT_DECK 0.50/1.00 Madness` run the generic `madness` template, whose own
  default floor is 40, and they read 40. Only the plo5
  `madness_without_lightning` profile pins 50. Raising those two to 50 would
  mean extending that pin in the trigger, which is a change to live short-deck
  play and was not made on an inference; it is flagged to the owner instead.
- **`HorseMadnessSelection`'s `=== 50` check.** Left exactly as it is, because
  tests and the live-proof depend on it. Only a comment was added recording
  that 50 is now the Madness pin rather than a value Classic PLO also shares.
