# Horses remember a player's shown river strength across a restart (default off)

A Horse judges how honest a player's river bets are from what he showed after betting the river: his first river bet
of each hand by size (under half the pot, half to two thirds, two thirds to the pot, over the pot), how many of those
bets were called and shown down, and how many of those were two pair or better. That evidence lived only in the
engine's memory and was rebuilt at every daily restart from the last 72 hours of hand history. A player who bets the
river for value a few times a week was therefore a stranger again after each restart: on 2026-11-14 one cash regular
had 1 shown river bet inside 72 hours against 13 in 14 days, and the read needs 3 before it says anything.

## What changed

- The database learner that already writes every accepted hand into the shared opponent profiles now also keeps a
  durable copy of this evidence (new column `horse_exact_profiles.shown_river`, migration `20261115144258`). It
  counts the same public facts the engine counts: the size of each player's first river bet, whether the public
  showdown list names him, and whether the hand he showed is two pair or better. A mucked hand is a shown loss with no
  hand. Cash and tournament, table sizes, games and table speeds stay apart, and Horses and humans are kept alike.
- The record fades by shown bets, not by days: each time a player's river bet is shown down, everything older counts
  a little less, so the bet shown 40 shown bets ago counts half. A player who rarely gets called keeps his old
  evidence; a player who is called often has a record that follows his recent play.
- The record travels with the opponent's shared profile row into each decision, only behind the new option
  `styleLongShownMemory` (default off, explicit true only), and in the decision's read frame (version 16) to the second
  look and to exact replay. For each bet size the read takes the record's figure when it holds more shown bets than
  the 72-hour memory, otherwise the 72-hour figure. It never adds the two, because the record already contains the
  hands of the last 72 hours.
- A decision reads only a record accepted before its own time.
- Receipts: `style_long_shown_memory_seen` (a read took a bet size from the record) and
  `style_long_shown_memory_older_seen` (and the record began more than 72 hours before the decision).
- Forward only. Nothing is back-filled or replayed: each profile starts its record with its owner's first river bet
  after the migration is installed. With the option off, or with no record on file, every decision is exactly what it
  was. The engine and the migration may be installed in either order. The migration installs in the daily
  maintenance window (it adds a column to a table every accepted hand writes and replaces that table's learner).

## What it changes in live play, once switched on

Against a player who bets the river and shows strong hands, the existing responses engage after a restart instead of
waiting for three new shown bets inside 72 hours: a one-pair bluff-catcher calls his river bets less, and a large bet
from him earns more respect. The record needs to hold more shown bets in a size than the 72-hour memory before it
speaks for that size, and the read needs 3 shown bets, so after the migration is installed it starts to matter for a
player once 3 or more of his river bets have been shown down and some of them have left the 72-hour memory: about
four days for the regular above (about one shown river bet a day), longer for a player who is called less often.
