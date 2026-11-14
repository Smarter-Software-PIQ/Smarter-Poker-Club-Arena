# The Engine Deals Fixed-Limit Omaha 4, 5 And 6 Card

Owner ruling, November 14, 2026: "LIMIT GAMES NEED TO HAVE PLO4, PLO5 AND PLO6 AS WELL AS PLO8 ... OMAHA 4 CARD FIXED LIMIT, OMAHA 5 CARD FIXED LIMIT, OMAHA 6 CARD FIXED LIMIT, OMAHA 8o FIXED LIMIT ... AND THEY ARE ALL ALWAYS CLASSIC GAME SET UP." Omaha 8o Fixed Limit is the existing `flo8`.

## The variants

`flo4`, `flo5` and `flo6` are the pot-limit games' deals with fixed-limit betting:

- **Cards and hand rules** (`VariantRules`): 4, 5 and 6 hole cards, exactly two used with exactly three from the board, high only, full deck.
- **Betting** (`BettingStructure`): fixed limit, the same rules as `flh` / `flo8` (small bet = big blind on preflop and flop, big bet = twice it on turn and river, four wagers a street).
- **Seats** (`tableSeating`, both copies): 8, 7 and 6, the same ceilings as PLO4 / PLO5 / PLO6.
- **Jackpot** (`RakeConfig`, both copies): `flo4` and `flo5` already carried PLO4 / PLO5's bars. `flo6` is ineligible, as PLO6 is (Dan 2026-11-13, "PLO6 IS NOT SUPPOSED TO HAVE BBJ"). The rake specification and its checksum are unchanged; the database opens `flo6` tables with `bbj_percent` 0, so neither side takes a drop.
- **Kill pots**: a fixed-limit feature, so the three join `flh` / `flo8`.

## Horses

- The horse decision programme's nine-variant universe (`KNOWN_VARIANTS`, the per-variant packs, the Phase 13 joint contract, learning captures, corrective review) is unchanged and keeps its fixed order. The new games are dealt (`DEALT_VARIANTS`, `isDealtVariant`) but outside that universe, so a joint sample, pack or learning capture is never applied to a game nobody has measured; each of those layers already refuses an unknown variant by name.
- `HorsePolicyRegistry` routes the three to the **reference** owner, as NLH is. Without a registration a horse's decision throws ("Horse policy variant is not registered"); with it, the reference brain reads the deal, the Omaha rules and the fixed-limit betting from the two modules above. `HorsePolicyRegistry.test.ts` now decides all three on every street.
- Omaha family reads (`HorseMind`, `HorseWinnerRead`, observer reads, the self tuner) ask `isOmahaVariant` instead of spelling `flo8`; style family `omaha_other`, like `plo8` / `flo8`.
- Preflop and postflop shifts (`HorseVariantProfile`): the Omaha card effect on top of the fixed-limit effect. Equity samples for `flo5` / `flo6` match PLO5 / PLO6.
- Cash eligibility (`HorseCashSchedule`): every fixed-limit game shares the 5/10-blind ceiling through `isFixedLimitVariant`. Limit classification, niche variants and tag coverage include the three.

## Order of delivery

The engine deals a variant it does not know as two-card Hold'em, so no `flo4` / `flo5` / `flo6` game may open before this engine serves. This change activates in the certified 04:00 Chicago window. The database migration that admits the three in the creator and opens their Classic games on the .25/.50 to 5/10 ladder follows only after the serving engine is verified to contain it.

## Verification

- Server type check clean.
- 346 server test files covering variants, betting, rake, seating, kill pots, horse families, policy registration and digests: 9,448 passed.
