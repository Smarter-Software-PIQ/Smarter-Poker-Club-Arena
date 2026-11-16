# A Short-Handed Maniac Is Reached (Default Off)

Short-handed and heads-up, a Horse only read a player as a maniac when his preflop raising was extreme: the regular
line there is a PFR of about 46 percent short-handed and 53 percent heads-up. A player who raises a normal amount
before the flop but bets nearly every time it is checked to him and never folds to a bet was not read as a maniac
before the flop at those tables.

New option `holdemManiacShortHandedReach`, OFF by default. With it on, in no-limit hold'em at short-handed and
heads-up tables only, a player whose bet-when-checked-to is credibly beyond every Horse (0.55 or more), who folds to
bets 0.36 of the time or less, and who has at least 15 decayed hands behind the read, takes the maniac width
(the wider of 0.35 and his own PFR). Every number already existed in the engine; none is new. Full ring, Omaha and
fixed limit are unchanged.

On synthetic players: one who bets 90 percent and folds 10 percent is reached after about 19 hands; ordinary
aggressive regulars are not reached at any sample. Not measured against people.

Receipt `holdem_maniac_short_handed_reach_seen`, league card `nlh_maniac_short_handed_reach`, evidence file
`docs/horse-default-on.d/holdemManiacShortHandedReach.md`. Test: `aShortHandedManiacIsReached.test.ts`.
