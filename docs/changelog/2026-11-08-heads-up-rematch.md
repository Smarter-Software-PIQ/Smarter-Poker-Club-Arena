# Heads Up Rematch (2026-11-08)

Dan, verbatim: "WHEN PLAYERS ARE PLAYING 'HEADS UP' WHEN THE MATCH IS OVER, THEY
SHOULD BOTH RECEIVE A 'PLAY AGAIN' POP UP, AND IF BOTH PLAYERS AGREE, THE MATCH
STARTS AGAIN. THEY BOTH 'BUY BACK IN' RAKE IS TAKEN AND THE MATCH STARTS BACK
OVER AT THE START OF THE HEADS UP."

His acceptance rules: both players accept before either is charged; each is
charged exactly once, through the normal buy-in path; both reach the same fresh
table; a decline, a timeout, insufficient funds, a repeat tap or simultaneous
accepts leave no partial charge and no duplicate game.

## What it does

When a heads-up Sit & Go ends, both players' result cards ask "Play Again". The
first Yes asks the opponent ("Your Opponent Wants To Play Again", 60 s). The
second Yes, in ONE database transaction:

1. opens a fresh copy of the game just played through the engine's own creation
   door, `fn_create_seat_first_game_atomic` (the platform's current blind
   schedule; every money term checked equal to the finished game's: buy-in,
   fee, guarantee, bounty, free-buy, satellite target, asset, payouts);
2. buys BOTH seats in it through the ordinary buy-in path (buy-in + fee, so the
   rake is taken exactly as in the first game), the winner in seat 1;
3. records the match.

If the game cannot be created or either player cannot pay, all of it is undone
together: nobody is charged and no game is left behind. The engine starts the
full game the way it starts every heads-up game whose seats are paid (its 5 s
REGISTERING scan), so the same two players, horse or human, play again.

## How one transaction charges two players

The person's seat purchase (`fn_take_seat_and_buy_in` and the seven layers under
it) takes its payer from `auth.uid()`, so one transaction could only ever
charge the caller, and the only explicit-payer registration door refuses
people. Rather than impersonate anybody, migration
`20261109021122_heads_up_rematch_atomic_buy_in.sql` reads those eight production
bodies, checks each against the md5 it was reviewed at, and installs a
`fn_ca_rematch_*` copy of each whose only differences are: the payer is a
parameter, each layer calls the next copy, and the two browser-session checks
are dropped (the rematch's own doors check the session instead, and a person is
charged only after accepting through them with a live session). Every charge,
ledger row, fee split, paying-club choice, lock, freeze check, daily window and
seat rule is the production text. The copies are executable by no browser or
service role. `ca_heads_up_rematch_sources` keeps the md5 pins; if any source
body changes later, the rematch answers "The Rematch Is Not Available Right
Now" before any purchase until a migration re-derives the copies. A horse
opponent is charged through its own existing door,
`fn_seat_horse_in_seat_first_game`, exactly as in its first game (10.5).

Repeat taps and simultaneous accepts serialize on the rematch row
(`SELECT ... FOR UPDATE`); the purchase runs only on the single transition from
"both accepted, no outcome" to an outcome.

## Client

`TournamentRankingHost` polls `ca_heads_up_rematch_state` every 1.5 s while the
card is up and answers through `ca_heads_up_rematch_respond`. A matched answer
means both seats are already bought, so the card only opens `/table/<id>`; it
never calls a seat purchase itself. A refused buy-back-in shows "Your Rematch
Could Not Start", and the player whose purchase was refused also gets the
ordinary reason ("Not Enough Chips For This Buy In"). Closing the card is a No.

## Measured before merge (2026-11-09, production, every probe rolled back)

The migration was generated into `pg_temp` (the only probe-only change: the
"game just ended" clock) and run against real games through the Supabase query
interface, each scenario one self-aborting transaction:

| Scenario | Result |
| --- | --- |
| Human (1.83 in wallets) vs horse, 50.00 game, both accept | `buy_in_refused`, reason `insufficient_balance` to the human only; human 0.00, horse 0.00; no game created |
| Same human with 101.83 | `matched`; ONE fresh game; human -50.00, horse -50.00, one `tournament_buyin` ledger row each; seats 1 (winner) and 2 on the same new table; pool 95.00 + fee 5.00; repeat tap, decline-after and read all returned the same table with no further charge |
| Two humans, 20.00 game, both accept | `matched`; A -20.00, B -20.00, one ledger row each; seats 1 and 2 on one table; pool 38.00 + fee 2.00; repeat taps by both changed nothing |
| Two humans, B has 0 | `buy_in_refused`, refused_by B; A 0.00, B 0.00; no game |
| Two humans, B accepts after the window | `expired` for both; nobody charged; no game |
| Two humans, B declines | `you_declined` / `opponent_declined`; A tapping again and B changing their mind charge nobody |

Simultaneous acceptance cannot be reproduced inside one rolled-back
transaction; it is serialized by the row lock described above.

Law: `tests/a-heads-up-rematch-buys-both-seats-or-neither.law.test.ts`.
