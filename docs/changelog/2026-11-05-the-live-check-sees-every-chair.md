# The Live Phone-Table Check Sees Every Chair (2026-11-05)

Dan 2026-11-05, after Mongo's BigWade (#9546) and Danimal's collapsed ring
(#9605): the avatars' positions must never be able to change during live play.

`readMobileTableLayout` (tests/e2e/support/mobileLiveTableLayout.ts) runs on
real live phone tables after every release (post-deploy live-table
verification) and on every harness ring in table-proportions.spec.ts. It now
also requires:

- **Chairs Drawn Out Of Seat Order**: the chairs as drawn (nudges included,
  empty chairs and the hero counted) run clockwise in seat order from wherever
  the hero rotation starts the ring.
- **Chairs N And M Drawn On One Spot**: no two chairs within 24px.

`tests/unit/liveChairOrderCheck.test.ts` proves a correct ring passes and that
Danimal's collapse, Mongo's displaced chair and two stacked chairs are caught.
This is a check, not a repair: the causes are fixed in #9546 and #9605.
