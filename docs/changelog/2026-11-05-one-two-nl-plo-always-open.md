# 1/2 No Limit And 1/2 PLO Are Always Open To Sit Down

Dan, 2026-11-05: "1/2 PLO AND 1/2 NO LIMIT SHOULD STILL SHOW 'EMPTY TABLES' EVEN IF NO HORSES ARE PLAYING, DO NOT REMOVE THEM ALL TOGETHER... KEEP WITH THE SCHEDULE THE HORSES ARE ON... IF A HUMAN PLAYER WANTS TO PLAY THEM, THEY NEED TO BE 'AVAILABLE TO SIT DOWN AND PLAY'".

Cause: the November 2 lobby default (`cashBoardVisible`) hides every cash game showing zero players until the player selects Show Empty Tables, and that choice resets each visit. The November 4/5 horse union cash schedule seats horses on the 1/2 games only in their windows, so outside them the games read zero and dropped off the board. The tables themselves stayed open in the database (read on production: every enabled Midway 1/2 game has its live Main 1 and was returned by `get_club_home`).

Fix: `alwaysShownEmptyCashGame` exempts open 1/2 games in nlh, plo, plo4, plo5 and plo6 from the hide-empty default. Closed, deleted and disabled games stay hidden. Every other stake and game keeps the November 2 default. No change to the horse schedule, engine, database, seating or money.

Regression: `tests/cash-lobby-active-defaults.law.test.tsx`.
