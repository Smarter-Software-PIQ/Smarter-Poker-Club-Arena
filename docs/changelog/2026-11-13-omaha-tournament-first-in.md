# Horses Stop Walking The Big Blind In Omaha Tournaments

Owner order, Dan 2026-11-12 21:14 Chicago, after a person won the PLO4 Dinner Break MTT.

## What The Audit Found

Every PLO tournament a person entered in five days was read (nine events; five MTTs of 46 to 59 entries, 3,284 hands). One MTT and one three-player spin were won by a person; seven were won by Horses. One win in six MTT entries is within luck for a field of equals, so the win is not the evidence. The hands are:

- Share of hands in which every player folds to the big blind: heads-up 51 to 63 percent, three-handed 61 to 69 percent, four or five handed 26 to 55 percent, six or more 17 to 28 percent.
- Heads-up, the small blind's first action when unraised (148 production decisions): fold 47 to 71 percent at every stack depth.
- The winner entered late with about two big blinds, doubled four times, and from twenty big blinds on took his chips from pots nobody contested. Heads-up for the title the Horse folded its small blind unplayed 9 times in 23 hands.

## Why

The first-in bars for short-handed and short-stacked tournament play are written on the Hold'em strength scale and read against the Omaha strength value, which runs far lower (measured heads-up: median 0.22, 75th percentile 0.40). The Omaha push/fold jam bar (about 0.47 to 0.58) and the blind-against-blind limp floor (0.22) admit roughly the top fifth of Omaha hands. In a harness on the previous source the heads-up small blind folds 70 percent at 4 big blinds, 84 percent at 8, 54 percent at 15 and 48 percent at 60.

## The Change

`server/src/engine/HorseOmahaTournamentFirstIn.ts` reads the hand's true percentile among Omaha hands and replaces the preflop engine's FOLD, and only its fold, in Omaha high tournaments:

- True heads-up, small blind first in: plays every hand. Up to 30 big blinds effective it raises the pot; deeper it completes.
- Small blind against the big blind alone at a larger table: the same.
- First in from a non-blind seat with two opponents left (the button three-handed, or the button when the seats in front folded): plays its top 80 percent; pot raise up to 30 big blinds, 2.5 big blinds deeper.
- Heads-up big blind facing one raise: calls its top 75 percent when the call is at most half the final pot; it moves in when the call is 40 percent of its stack or more.
- Outside true heads-up the engine's own tournament risk premium narrows the share (two points of range per point of premium, at most half the range), so a pay jump still tightens play.
- Three or four of a rank and the other class folds stay folds. Every raise, call and jam the engine already chose is untouched.

Option `omahaTournamentFirstIn` (default on; `false` keeps the earlier folds; an object replaces the shares for league arms), registered in the ledger with the receipt `omaha_tournament_first_in`.

## Measured

Mirrored self-play matches: the same deals played once from every seat, one seat on the arm, the rest on the unchanged brain; 3,000 hands per cell; production options, opponent memory off; chip result in big blinds per hand for the arm seat, averaged over all its seats (standard error).

Heads-up, small blind pot-raises every hand:

| Stack | PLO4         | PLO5         | PLO6         |
| ----- | ------------ | ------------ | ------------ |
| 5     | +0.19 (0.05) | +0.22 (0.05) | +0.27 (0.04) |
| 8     | +0.54 (0.03) | +0.48 (0.03) | +0.49 (0.03) |
| 12    | +0.52 (0.05) | +0.45 (0.05) | +0.45 (0.05) |
| 16    | +0.25 (0.04) | +0.16 (0.04) | +0.14 (0.03) |
| 25    | +0.26 (0.01) | +0.22 (0.01) | +0.18 (0.01) |
| 30    | +0.25 (0.05) | +0.06 (0.06) | +0.16 (0.03) |

Playing 85 or 70 percent of hands earned less than 100 percent in every cell of all three variants. Completing instead of raising earned +0.01 to +0.16 where raising earned +0.14 to +0.54.

Heads-up big blind against a small blind that raises every hand (PLO4): calling the top 50 percent +0.19 to +0.22, the top 75 percent +0.27 to +0.34, every hand +0.25 to +0.36 (standard errors 0.05 to 0.10). Against the unchanged, tight raiser the same defence measured about zero three-handed.

Three-handed, PLO4, 10 big blinds: small blind against big blind raising every hand +0.33 (0.03); button playing 80 percent +0.19 (0.03); both together +0.52 (0.05). At 6 big blinds the blind rule earns +0.23 (0.04) and the button rule about zero.

Six-handed, PLO4, 9,000 hands per cell: widening the cutoff, hijack and under-the-gun seats measured +0.02 to +0.04 with standard errors of 0.02 to 0.04. NOT established, so those seats are unchanged.

## Limits

- The opponents in every match are Horses. The gains are against the brain that folds too much; once every Horse plays this way the heads-up gain shrinks to what the big blind's defence leaves. A person who already raises every button loses that free money; this does not measure play against people.
- Chips, not prize money: the matches do not price pay jumps. The risk-premium narrowing is the engine's existing premium applied by rule; it was not separately measured.
- Six-handed and deeper play, postflop play in the larger pots this creates, and Hi-Lo are untouched and unmeasured here.
- Two frozen historical corpora replay Omaha tournament decisions this changes; following the repository convention they pass the off arm and keep every recorded byte.

Law: `server/src/engine/HorseOmahaTournamentFirstIn.law.test.ts` (the pure rule, and end to end through `HorseLogic.decide`: heads-up small blind folds at most 5 percent with the rule and 40 percent or more without it, PLO4, PLO5 and PLO6, 4 to 30 big blinds; cash and Hi-Lo identical with and without).

## Mode and ownership

The rule engages only when the table engine declares the hand a tournament
(`gameMode: 'tournament'`). A caller that passes no mode is left alone, so the
legacy guess from the size of the big blind cannot switch it on at one stake
and off at another. The tournament objective (Phase 7) still evaluates and
owns the final action after the rule; a test holds that with the rule on.
