# 2026-11-19 - The Lightning Games VPIP floor is 25

Owner ruling, 2026-11-19, 1:38 PM Chicago: "LOWER THE VPIP IN LIGHTNING GAMES
TO 25% ACROSS THE BOARD FOR ALL LIGHTNING GAMES, NO LIMIT OR PLO".

## Shipped

- `fn_cash_template_defaults` answers 25 for the Lightning Games format
  (template `madness`, historical `action`) in nlh, plo4, plo5 and plo6. It
  answered 40 for every non-Classic template before.
- The open Lightning games (40 `cash_games` rows, 13 of them running Lightning
  today) and their open tables (12) moved to 25. Migration `20261119195413`.
- The screens print 25: the Lightning Games format card, the lobby note and the
  table badge's list of real game rules (`LIGHTNING_VPIP_FLOOR`).

## What did not change

- The window (ten hands), the judgement with no grace, the eviction and the
  two-hour bar.
- Every Classic floor.
- Madness without Lightning (PLO5 Madness): 40. Its trigger branch borrowed the
  madness template's floor, so it now states its own 40.
- A legacy Action or Madness row in a variant Lightning does not deal (plo8,
  flo8, flh, short_deck): 40. Three such tables exist; nobody has sat at them
  since 2026-10-25.
- A retired club's rows, which are read-only.

## Why the template and not the twelve tables

The floor is copied, never set: creator to snapshot, trigger on every snapshot
write, opener to a new table, `fn_cash_apply_ruleset` to every open table on
every cluster tick. A table row changed by hand is rewritten from its game
within one tick, and a game row changed by hand is rewritten from the template
at its next snapshot write.

## When it reaches play

No engine release is needed. The judgement is in the database
(`fn_nit_enforce` reads `fn_nit_policy`, which reads the table row at every
hand boundary). A table engine re-reads its rule row at most 60 seconds apart,
and a Lightning pool hand reads the host table's rules when it is dealt.
Lowering a floor can only help a seated player: nobody at or above 40 is under
25, and these games have no warning or grace state to carry over.

## Proof

- `tests/the-lightning-games-vpip-floor-is-twenty-five.law.test.ts`
  (`docs/laws.d/the-lightning-games-vpip-floor-is-twenty-five.md`).
- The migration was rehearsed on a local Postgres seeded with a read-only copy
  of production's `cash_games`, clustered `tables` and `clubs` rows: 40 games
  and 12 tables moved, nothing else did, a second run wrote no row, a game
  created or re-seeded afterwards resolves 25, and a write to a row that is not
  a Lightning row makes the install refuse itself.
