# A full-ring feeder starts with the last two to sit

2026-11-08. Dan, verbatim: "FOR 9 HANDED GAMES, ONCE 4 OR MORE PLAYERS ARE ON
THE WAITING LIST, IT WILL REMOVE THE LAST TWO PLAYERS TO SIT IN THE FULL GAME
AND MOVE THEM TO THE 'FEEDER GAME'. THEN THE 2ND TABLE STARTS. THOSE 2 PLAYERS
ARE 'FIRST TO MOVE' AND WILL MOVE OVER ANYTIME ANOTHER PLAYER FROM THE MAIN
GAME, LEAVES OR BUSTS, IF A NEW PLAYER JOINS THE FEEDER GAME, THE MAIN GAME
DOESN'T GET A NEW PLAYER UNTIL THE FEEDER GAME HAS 7 PLAYERS. THEN FIRST ON THE
LIST MOVES. IF ITS A 6 MAX GAME, 'FEEDER GAME' GAME STARTS HEADS UP."

Asked the same day, he chose:

- the two Main chairs the bump empties **stay empty until the feeder has 7**;
  a Main player who leaves or busts out is replaced right away by a bumped
  player;
- 6-max: **no bump**, two people on the list start the feeder heads up (as
  today);
- 6-max move-up: **any open Main seat**, first on the list (as today).

## What changed (migration `20261108193515`)

Full-ring games only (handedness 7 to 9; the gate is handedness - 2, so 7 for
nine-handed). 13 enabled games on 2026-11-08; the 43 short-handed games are
untouched.

1. **Four on the list opens the second table.** With Main 1 the only table,
   the feeder opens and the two players who arrived at Main 1 most recently
   get a `balance` move to it ("Balancing The Tables. Moving To The Feeder
   Table After This Hand."). Their two chairs are recorded as held in the new
   `cash_cluster_feeder_starts` row. The list then fills the feeder one name
   at a time through the existing offer step.
2. **Held chairs are taken everywhere a chair is counted**: the census (so
   must-move, seat changes and breaks see them as reserved), the open-seat
   count (Join Game door, lobby, list offer) and the buy-in gate.
3. **Release.** Each time the feeder has 7 players (not counting anyone
   already moving out), one held chair is released and the first on the
   must-move list takes it.
4. **First to move.** The two bumped players are first on the list and may
   take any Main chair that really opens (a leave or bust-out), whatever the
   feeder count.
5. **The feeder keeps its game.** Anyone else moves from the feeder to a Main
   only while the feeder has 7, one per chair. While a full-ring game has a
   feeder, a Main's open chair belongs to the must-move list
   (`fn_cash_main_chair_is_the_lists`): the Join Game door seats a newcomer at
   the feeder, the list offer never calls a name to a Main, and a direct
   buy-in at a Main (a tap on the empty chair, or a horse) is refused
   SEAT_RESERVED, which the fleet already treats as an ordinary race.
6. A feeder start ends when its Main or feeder stops being live, when the live
   feeder is down to one player with nobody waiting, or when nothing is held
   and no bumped player is still on the feeder. A bump move that never landed
   gives its chair back.

No money path is touched and the engine needs no change; the migration
installs on merge.

## Verified

Every anchor the migration patches was confirmed to occur exactly once in the
production function definitions (read-only). The migration was applied to a
local Postgres 16 holding the production text of the census, the open-seat
count and the tick's affected steps, and this sequence was run:

| step                 | Main 1 | feeder  | held | what happened                                               |
| -------------------- | ------ | ------- | ---- | ----------------------------------------------------------- |
| 3 on the list        | 9      | -       | -    | nothing opens                                               |
| 4th joins            | 9      | opening | 2    | feeder opens; p9 and p8 (last to sit) get balance moves     |
| bump lands           | 7      | live 2  | 2    | Main open seats 0                                           |
| 4 from the list sit  | 7      | 6       | 2    | nothing moves; a direct buy-in at Main is refused           |
| 7th sits             | 7 -> 8 | 7 -> 6  | 1    | one chair released, p9 moves up                             |
| Main player leaves   | 7 -> 8 | 6 -> 5  | 1    | p8 (bumped) moves up at once                                |
| another leaves       | 7      | 5       | 1    | nobody moves (feeder under 7)                               |
| feeder reaches 7     | 7 -> 8 | 7 -> 6  | 0    | one chair released, first on the list moves; start complete |
| 6-max, 2 on the list | 6      | opening | -    | feeder opens, nobody moved (unchanged)                      |

Pinned by `tests/a-full-ring-feeder-starts-with-the-last-two.law.test.ts`.
