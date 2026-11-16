# An All-In-Or-Fold Closing Seat Calls A Lone All-In From The Nash Caller Table

2026-11-12. Hold'em Strategy lane. Finding HVH2D-NLH-005 of the two-day Human
vs Horse study. Engine source: `server/src/engine/HorseLogic.ts`, the
"NASH CALL VS JAM" block only. No migration.

Status: built as a draft for review. ON HOLD by the owner. It must not be
released before the guaranteed-pool correction (#10612 with #10618) is serving
and verified and the owner lifts the hold.

## What happened

At All-In-Or-Fold hold'em tables, a Horse facing a single all-in folded hands
that were profitable calls. Ordinary tables answer that spot from the Nash
caller table, which reads the all-in player's seat, the caller's seat, the
depth and the dead money. All-In-Or-Fold tables were excluded from it and fell
to a fixed strength bar that reads none of those.

Measured on development data, at 12 big blinds or less, from the seat that
closes the action (nobody left to act behind, so the call ends the hand):

- Against Horse all-ins: 41 folds. 17 gave up a profitable call against the
  table's range, 11 against a range half as wide, 0 against a top 10 percent
  range.
- Against human all-ins: 3 folds, 0 profitable.

"Profitable" means the hand's equity beat the price of the call by more than 3
points.

## The change

At an All-In-Or-Fold table the Nash caller table now answers a lone all-in
when both of these hold:

1. The effective stack is 12 big blinds or less
   (`NASH_AOF_CLOSING_CALL_MAX_BB`).
2. The hero closes the action: every other player still in the hand is all in
   (`everyLiveOpponentIsAllIn`, public seat flags only).

When the table says call, the Horse goes all in, which is what a call of an
all-in is at such a table. When it says fold, the Horse folds.

What is deliberately not changed:

- Any seat with a player still to act behind. The table prices the first
  caller only and nothing prices an overcall, so those seats stay with the
  fixed bar.
- Any depth above 12 big blinds at an All-In-Or-Fold table.
- Every table that is not All-In-Or-Fold. Nothing there changes at all.
- First-in all-ins, multiway pots, Omaha, and `HorsePreflop.ts`.
- The random draw stays where it was.

## Proof

`server/src/engine/AnAofClosingSeatCallsFromTheNashTable.test.ts`, 21 cases
over five anonymised decision-time requests from the production journal, each
checked on 12 seeds. The journal recorded fold for all five.

- Only one saved request is a closing seat: Q9s in the small blind with the
  big blind sitting out, 7.4 big blinds effective. Unedited, it changes from
  fold to all in.
- 44 with 3 big blinds and both blinds still behind stays fold. With the two
  blinds marked folded (an edit, stated in the test) it goes all in.
- 55 in the small blind with the big blind behind stays fold. With the big
  blind marked folded it goes all in at 12 big blinds and folds at 12.25,
  while the same request on a table that is not All-In-Or-Fold calls at 12.25.
- A7s on the button at 15 big blinds stays fold, from the closing seat too.
- K3o stays fold everywhere: the table folds it.
- The same five requests with only the All-In-Or-Fold flag cleared give the
  answers main gave before the change.

On the previous source 5 of the 21 fail: the three closing-seat calls, the
12 big blind line, and the constant.

## Risks And Limits

- Thin calls against all-in players tighter than the table assumes. Against a
  top 10 percent range none of the measured folds was a profitable call.
- Chip value only. Payout pressure and bounties are not in the table; the
  tournament arbiter still runs after it.
- Development data only. Nothing is established about human all-ins: 3
  decisions.
- One saved request is a real closing seat. The other closing-seat cases are
  saved requests with the players behind marked folded.

## Acceptance, Declared Before Any Window

After release, closing-seat folds at 12 big blinds or less that give up a
profitable call against the half-width range fall toward zero, and no losing
call appears, by the same 3 point test.

## 2026-11-15: Built Behind A Default-Off Option

Owner order 2026-11-15 08:05 Chicago: build the parked items behind options.
The rule above now acts only with `aofClosingSeatNashCall: true` (HorseDecideOpts,
read as `=== true`). With the option absent or false the Nash caller block keeps
main's exclusion of All-In-Or-Fold tables, so every All-In-Or-Fold decision is
exactly main's.

Why default OFF and not a defect repair: the fixed All-In-Or-Fold strength bar is
a deliberate policy, not a broken path; the evidence is development data against
Horse all-ins only (17 of 41 folds gave up a profitable call against the table's
range, none against a top 10 percent range, 3 human folds, none profitable); the
change reaches tournament tables, where chip value is not prize value; and the
owner's hold on HVH2D-NLH-005 stands. Lifting it is the owner's decision.

- New receipt `aof_closing_seat_nash_call_seen` (ledger and activation.sql),
  fired only at an All-In-Or-Fold table, so only with the option on.
- Ledger flag `aofClosingSeatNashCall` (default OFF). League: refused matchup
  `aof_closing_seat_nash_call` (the league deals no All-In-Or-Fold table; 0 of
  2,000 pairs diverged as written, seed 20261115).
- Regression: every case that expects the new answer passes the option; a new
  block pins the default: with the option absent or false the ten saved
  requests and the edited closing seats fold on every seed and from the
  journal's state, and the not-All-In-Or-Fold twins answer identically with
  the option on and off.
- Decision packet: agy-holdem-elite-c2072436/PACKET-aof-closing-seat-20261115.md.
