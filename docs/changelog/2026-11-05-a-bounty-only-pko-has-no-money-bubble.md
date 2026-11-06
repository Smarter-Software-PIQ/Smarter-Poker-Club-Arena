# A Bounty Only PKO Has No Money Bubble

A free, unguaranteed PKO whose place pool is zero pays only for knockouts. The engine used its lifecycle ladder (36 places on the Afternoon Free Buy, November 5) as a money bubble, announced hand for hand at 37 players and paused every table until place 36 busted for a prize of 0.

The hand for hand stage now recognizes a bounty only PKO after the prize pool is final, never starts hand for hand for it, and releases any latch an earlier manager left behind with a `bubble_burst` reason of `bounty_only_pko_pays_no_places`. A PKO with a funded place pool, a guarantee or a paid entry keeps its bubble unchanged.

Proof: `server/src/tournament/BountyOnlyPkoHasNoBubble.test.ts` runs the maintained stage verbatim.

## The Winner's Head Moves When The Knockout Settles

On the same event Danimal's knockout was paid and his head grew in the ledger six seconds after the hand ended, but his table badge kept the old head. A head re-read started when the busted seat left the table (before the bounty committed) could land after the knockout's own badge update and put the old head back until the 30 second poll. The table now discards any head read that started before the latest knockout and reads again, re-reads the ledger heads on every knockout broadcast, and reads once more eight seconds after a bust so the head is right even if the broadcast never arrived. Proof: `tests/unit/aKnockoutHeadIsNeverOverwrittenByAStaleRead.test.ts`.
