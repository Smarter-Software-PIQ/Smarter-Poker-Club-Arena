# Fixed Limit Games: Named In Full, Read By Their Blinds, Classic Only, Their Own Icon

Owner ruling, November 14, 2026 (Dan, from the lobby, on the "FLH 2/4" and "FLH 1/2" cards):

> FORCED LIMIT GAMES CAN HAVE HIGHER STAKES. THOSE GAMES CAN GO UP AS HIGH AS 5/10. LIMIT GAMES NEED TO HAVE PLO4, PLO5 AND PLO6 AS WELL AS PLO8. AND IT SHOULD BE DISPLAYED AS "FIXED LIMIT 1/2" AND FOR OMAHA GAMES IT SHOULD SAY "OMAHA 4 CARD FIXED LIMIT" OMAHA 5 CARD FIXED LIMIT OMAHA 6 CARD FIXED LIMIT, OMAHA 8o FIXED LIMIT. GAME LIMITS SHOULD BE .25/.50 .50/1.00 1/2 2/5 AND 5/10 AND ALL LIMIT GAMES SHOULD HAVE THERE "OWN ICON" THEY SHOULDN'T BE USING THE SPADE ICON. AND THEY ARE ALL ALWAYS CLASSIC GAME SET UP.

## What was wrong

- A fixed-limit game read by its BET sizes: blinds 1/2 printed "FLH 2/4", blinds 2/5 "FLH 5/10" and blinds 5/10 "FLH 10/20". The 5/10-blind game therefore looked above the 5/10 ceiling the stake guard actually holds limit games to, and Dan's ladder (.25/.50 to 5/10, the blinds) matched nothing on the board. The November 3 change had already made the requested levels blinds, but kept the bet-size label.
- Titles used the codes FLH and FLO8.
- Limit cash rows wore the Classic spade chip.
- Action, Madness and Lightning limit games could be created, and two were enabled in Midway Union; a 0.10/0.25 Classic rung sat below the ladder.

## What changed

- `stakesLabel` (client and engine mirror) and `fn_cash_stakes_label` read every game by its blinds. Bets are unchanged (small bet = big blind, big bet = twice it). `stakesSortValue` and `bigBlindFromStakesLabel` follow.
- Names come from one table, `src/lib/fixedLimitNames.ts`: Fixed Limit Holdem (spelled out, Dan's follow-up the same morning: "they need to say Fixed Limit Holdem (spelt out) not abbreviated"), Omaha 4 / 5 / 6 Card Fixed Limit, Omaha 8o Fixed Limit. The lobby title, variant column, filter chips, create flow, felt chip and default table name use it; the database names games with the same words (`fn_cash_game_ensure`, the creator) and the migration rewrites every open limit game's and table's generated name ("FLH 2/4 Classic" -> "Fixed Limit Holdem 1/2 Classic"). Host-typed names are untouched.
- Limit rows on the premium lobby carry `data-limit-format` and their own chip, `public/game-card-icons/fixed-limit-chip-v1.png`: the Classic chip's ring with the spade removed from the face by polar median reconstruction and a chiselled brushed-steel "FL" emblem rendered in the spade's construction (polished rim, groove, two-facet face, drop shadow). It takes Classic's silver treatment.
- Classic only: the creator refuses a non-Classic limit game (`LIGHTNING_VARIANT_NOT_ALLOWED`, already read by the client), `fn_cash_game_ensure` resolves any limit order to Classic, `fn_lightning_variant_allowed` and `LIGHTNING_EXCLUDED_VARIANTS` name every limit game, and the create flow disables limit variants under Lightning Games.
- The Lightning switch: `cash_games_lightning_variant_allowed` reads `fn_lightning_variant_allowed`, so once Fixed Limit Holdem is refused there, a limit game with its Lightning switch on refuses every later write, the switch-off included. Midway's "FLH 0.25/0.50 Lightning Games" was the one such game (switch on, cluster in must_move, nothing in Lightning). The migration clears its switch exactly as the operator door's `disable_lightning` does for a must-move cluster, refuses the whole file if any limit cluster is actually in Lightning, and its proof asserts no limit game is left with the switch on. The first draft of the migration missed this; a fixture carrying the real constraint reproduced the refusal and now passes.
- Ladder: the create flow offers exactly .25/.50, .50/1, 1/2, 2/5 and 5/10 for limit (the 2026-08-31 "big blind must be twice the small blind" filter existed only because the label printed the bets). Every rung already exists as a Classic game for both limit variants in Midway Union. The migration switches off, the owner's way (`enabled = false`; seated players keep playing; tables close once empty), the 0.10/0.25 rung and every non-Classic limit game, recording each on its event log.

## Omaha 4, 5 and 6 card fixed limit

The engine side (`flo4` / `flo5` / `flo6`: deal, exactly-two Omaha rules, fixed-limit betting, seat ceilings 8 / 7 / 6, Omaha 6 Card with no jackpot like PLO6, horses on the reference brain) ships in its own pull request through the certified 04:00 Chicago engine release. The client already names them; the database opens their Classic games only after the serving engine deals them, because an engine that does not know a variant deals it as two-card Hold'em.

## Verification

- Migration exercised end to end on a local PostgreSQL 16 fixture with the production preimages (names rewritten, tables renamed with suffixes kept, closed tables and retired clubs untouched, events written, creator refusal, ensure resolving to Classic); every preimage confirmed present exactly once in production by a read-only query.
- Client type check clean; the tests touching every changed module pass.
