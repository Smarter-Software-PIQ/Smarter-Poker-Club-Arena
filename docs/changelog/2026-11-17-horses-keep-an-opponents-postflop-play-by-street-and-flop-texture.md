# Horses keep an opponent's postflop play by street and by flop texture (measurement only, no decision changed)

A Horse's saved read of an opponent held one postflop betting rate and one fold-to-a-bet rate: flop, turn and river
together, every kind of flop, whether or not he raised before the flop. A player who bets most flops and then slows
down ends up with a moderate rate and is treated the same on every street. An audit of 721 live Omaha hands measured
the two halves apart for one regular: on paired boards his bets were trips or better 60 / 77 / 72 percent of the time
on the flop / turn / river, while on unpaired flops more than half of his bets were a draw or one pair.

This change starts keeping those halves apart. It records and carries the evidence. It does not use it: every Horse
decision is exactly what it was.

## What changed

- The database learner that already writes every accepted hand into the shared opponent profiles now also keeps a
  record by street and by flop texture (new column `horse_exact_profiles.street_counters`, migration
  `20261117175407`). Seventeen cells, each with its own count of chances and of times taken:
  - by street (flop, turn, river): he could bet with no bet in front of him, and bet; he faced a bet or a raise, and
    folded; he had bet or raised, was raised, and folded;
  - by flop texture (paired, rainbow, two-tone, monotone): he raised last before the flop, could bet the flop with no
    bet in front of him, and bet; and the same for anyone, raiser or not.
- Each cell counts at most once per hand and fades by its own chances, not by hands or days: the chance 30 chances ago
  counts half. A street a player rarely reaches keeps its old evidence.
- Only what every seat saw is counted: the hand's public actions and its board cards. No hole cards and no showdown.
  The same rule as the existing counters decides which actions count (a forced or unattributed fold teaches nothing).
  A double-board hand has two flops, so it teaches the street cells and no texture cell.
- Cash and tournament, table sizes, games and table speeds stay apart, and Horses and humans are kept alike, because
  the profile row keeps them apart.
- The record travels with the opponent's shared profile row to the decision workers. An Omaha decision carries it in
  its own state and in its read frame (version 18), so the second look and an exact replay carry the same record. A
  Hold'em decision carries nothing. `HorseMind.omahaStreetReadOf` answers it; a cell with fewer than 8 chances answers
  "unknown".

## What did not change

- No decision reads the record. With the column empty or full, the decision is byte for byte the same: proven on the
  fifty recorded PLO4 and PLO5 turn and river decisions (three random seeds each, with the release options and again
  with every Omaha option that reads an opponent on), through the decision worker (first look, second look, exact
  replay), and by a source check that nothing outside the read's owner and its transport names it.
- No history is replayed and nothing is back-filled. Every existing profile starts with no record and fills from the
  hands played after the migration is installed. A cell needs 8 chances before it answers, so the read becomes
  available per player and per street as he plays.
- No option, no switch and no engine release is part of this change. The engine half reaches tables only at a
  certified engine activation.

## Installation

The migration adds a column to a table every accepted hand writes and replaces the accepted-hand learner function, so
it is declared for the daily maintenance window (`@install-window: daily-maintenance`). After merge the Apply Merged
Migration route queues it and the daily 03:30 America/Chicago run installs it inside the 04:00 freeze. The engine reads
a missing column or an empty record as "no record", and the database learner does not need the new engine, so either
may be installed first.

## Proof

- `scripts/ci/test-horse-exact-public-memory.py` (isolated PostgreSQL 17, workflow Horse public memory): the SQL
  reducer and the engine reducer give the same increments on 11 named hands and 240 seeded random public action logs
  with boards (`scripts/ci/fixtures/horse-street-read-vectors.json`); the fading rule agrees to 1e-12 through 120
  hands; hole cards written on the actions change nothing; exact cell values through the accepted receipt; no
  back-fill; forced and preflop-only hands leave the record unchanged; refused without the board columns; both install
  orders converge; rerun idempotent.
- `server/src/engine/HorseOmahaStreetRead.test.ts`, `horseDecision/anOpponentIsReadByStreetAndFlopTexture.law.test.ts`
  (registered in `docs/laws.d`), `horseDecision/aStreetReadThroughTheWorker.test.ts`,
  `HorseOmahaStreetReadChangesNoDecision.test.ts`.
