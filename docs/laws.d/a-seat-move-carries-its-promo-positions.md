# tests/a-seat-move-carries-its-promo-positions.law.test.ts

A cash seat move (balance, must-move or swap) carries every restricted promo position (principal, winnings and integrity custody keyed to table_stack) from the table the player leaves to the table he arrives at, inside the move's own transaction, and refuses the move if anything is left behind; a stale position on the old table refused hand #60380607 and froze table dbbc148e for six hours on 2026-11-21.
