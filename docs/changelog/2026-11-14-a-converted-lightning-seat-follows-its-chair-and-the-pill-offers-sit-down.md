# A converted Lightning seat follows its chair, and the pill offers Sit Down (2026-11-14)

Client only. No engine (`server/`) change and no database change, so it publishes
on the normal client route without an engine window.

## What Dan saw

> "I WAS PLAYING LIGHTNING GAMES AND FOLDED AND WAS MOVED TO THE NEXT HAND...
> BUT THEN I WASN'T DEALT IN, IT WAS LIKE I WAS 'OBSERVING' MY AVATAR WAS NOT
> IN THE 'HERO LOCATION' AND I DIDN'T RECEIVE MY CARDS. EVEN AFTER A HARD
> REFRESH I WASN'T ABLE TO CLICK ON THE ACTION BAR PILL TO SIT DOWN. (IF A
> USER EVER CLICKS THE ACTION BAR PILL FOR A GAME, IT SHOULD OPEN THE DROP DOWN
> MENU TO 'SIT DOWN')"

## What happened, read from production rows

- 14:53:57 UTC: KingFish bought into `PLO4 1.00/2.00 Lightning Games Feeder`
  (table `72db7c6a`, game `c79d8ec2`, then in MUST MOVE) and played it.
- 14:59:32 UTC: the game converted to Lightning (epoch 9). His pool session
  `95a5b737` opened on that anchor seat with 552.60.
- The pool dealt him hand 59297194 (14:59:45) and 59297270 (15:00:28). Both
  folded on the clock after 38 seconds. Screenshot 1 is the feeder table
  projecting somebody else's hand (59297203) with "Seat Reserved, You'll Be
  Dealt In Next Hand"; screenshot 2, after his hard refresh, is the same
  table projecting his own hand 59297270, his seat on the far side showing
  TIME BANK, his cards face down, and the footer offering "Join Lightning".

## The cause

1. **The converted seat waited for a tap.** `useLightningAnchorHandoff` found
   the open room on his anchor seat and only offered "Your Game Is Now
   Lightning. Your Seat Is Ready." with VIEW GAME. The tab stayed on the
   physical table, which never deals a pool seat; it only projects other
   Lightning hands.
2. **The offer could not render.** That notice (and "Joining Lightning...")
   lived in the LAST branch of the action footer chain. A funded anchor seat is
   never in the public projection, so an earlier branch always matched first:
   "Seat Reserved, You'll Be Dealt In Next Hand" while the seat row was read as
   his, "Join Lightning" once the projection zeroed the hero seat. The
   2026-10-26 between-hands work moved the room's own ended notices out of this
   chain for the same reason and left these two behind.
3. **A hard refresh rebuilt the same state.** The refreshed anchor tab mounted
   the same hand-off and the same hidden notice.
4. **The pill menu had no way in.** The tap menu (2026-11-13) offered Sit Out,
   Leave Table Next Hand and Leave Table to a player nothing was dealing.

## The fix

1. **The tab follows the chair** (Dan 2026-09-05, the must-move re-point). When
   the hand-off reads an open pool session anchored at this exact table for this
   funded seat, it registers the room and re-points the tab in place, exactly
   once per identity and room. Same slot, same `activeIndex`: no table switch
   (CLAUDE.md 10.6 is about moving focus, which this never does). The Join
   Lightning intent path shares the same one-shot follow.
2. **A missed signal is recovered without a timer.** The room signal is a
   Broadcast, delivered at most once. The hand-off now also asks once when a
   conversion cue the anchor already receives changes: the engine starting to
   project Lightning hands here (`lightning_observer`), or the game's mode read.
   No change, no read; no interval, no channel.
3. **Nothing can shadow the way to the seat.** "Joining Lightning..." is the
   first branch of the footer chain. The conversion VIEW GAME, now only a
   fallback for a re-point the container refuses (a player-watch tab), is
   mounted over the table area beside the room's ended notices.
4. **Sit Down on the pill.** TablePage reports `canSitDown` (a cash table where
   nothing deals the hero: no seat on this felt, an anchor projecting Lightning
   hands, or a converted seat whose room is open). The tap menu then leads with
   Sit Down and drops Sit Out and Leave Table Next Hand. Sit Down asks the
   owning table page, which uses the door the table already has: the converted
   seat's room, Join Lightning (amount only, nobody picks a chair), a recheck
   for a funded anchor seat whose room is not known yet, the first open chair's
   buy-in, or the waiting list. A seated player keeps Sit Out; a sitting-out
   one keeps I'm Back. Tournament tables are unchanged (their seats are
   assigned).

## Tests

- New law `tests/lightning/a-converted-lightning-seat-follows-its-chair.law.test.tsx`
  (13 cases; 7 fail against the previous source).
- New law `tests/unit/thePillOffersSitDown.law.test.tsx` (5 cases; 3 fail
  against the previous source).
- Updated, deliberately, in the same commit: the three cases in
  `tests/lightning/lightning-phase-6-review-fixes.test.tsx` and the first case
  of `tests/lightning/funded-anchor-handoff.test.tsx` that pinned "follows only
  on View Game". They now pin the automatic, single follow and keep View Game as
  an explicit door. The funded-anchor consumer passes the new
  `tableGameLightningState` input it evaluates.

## Already-affected players

Nothing to settle. Folding on the clock is the engine's normal timeout path:
the folded hands moved no chips beyond the blinds and calls the seat had made,
and the seat and its stack were never touched. Any converted seat still sitting
on an anchor is carried to its room the next time its table mounts or its cue
changes.
