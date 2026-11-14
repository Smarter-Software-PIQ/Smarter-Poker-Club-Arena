# tests/an-average-stack-is-whole-chips.law.test.ts

Dan 2026-11-14: "AVG STACK SHOULDN'T USE DECIMALS, THATS THE ONLY NUMBER THAT SHOULDN'T. CHIP STACK COUNTS AND 'AVERAGES' USE WHOLE NUMBERS EVERYWHERE." Every average stack (tournament Ranking, Tables, Details, HUD, break screen, clock, info panel, cash must-move lobby) is truncated to whole chips where it is computed and where it is shown, and tournament stack figures print through `stackChips`; money keeps its cents. The law also scans every source for an average-stack division that is not truncated.
