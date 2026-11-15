# tests/a-moved-player-never-posts-to-enter.law.test.ts

Owner rule (Dan, 2026-11-15): a player moved to a new table in a must-move game never posts to receive a hand. Every move reason (must_move, break, balance and seat_change, swaps included) arrives `entry_hold = 'moved'`, not agreed. The engine never registers that arrival to wait for or post the big blind, and the marker clears on admission with nothing billed. The player posts only when the big blind reaches their chair, or owes missed blinds after sitting out.
