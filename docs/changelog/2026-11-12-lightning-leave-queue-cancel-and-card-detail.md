# Lightning Leave Next Hand: Survives A Reload, Can Be Cancelled; Session Card Detail

Dan, 2026-11-12, asking for every follow up to the Leave Next Hand fix (#10623)
to be built, wired and tested.

## The queued leave survives a reload or reconnect

The queue lived only in the page's memory, so a refresh or a dropped socket
mid-hand forgot it while the database's stop mark still refused new deals: the
player sat idle. `useLightningLeaveAfterHand` (src/lightning/lightningLeaveNextHand.ts)
now owns it, saved per player per pool session
(`ca:lightning-leave-after-hand:v1:<user>:<pool session>`). It runs the leave
owner exactly once, only after the engine's own snapshot for the page is
applied (or the room has closed) and the player's hand is over.

## The player can cancel it

Tapping "Leaving After Hand" calls the new `fn_lightning_resume_playing`
(migration 20261112203847), which withdraws the caller's own stop mark so they
keep being dealt in. It refuses, changing nothing, when the session already
ended (the leave then finishes), the Cluster is frozen, or responsible gaming
refuses play. `useLightningLeaveStop` gained `reset()` so the next press sends
the stop again instead of reusing the withdrawn one. Probed on production in a
self-aborting transaction: first call withdrew the mark, second answered
`withdrawn: false`; nothing committed.

## Session card detail

Duration reads the exact time ("8m 49s", not "8m"), and the session statistics
name the applied Auto Top Ups beside Total Buy-In whenever there were any.

## Cash Session Complete card: checked, no change

Its Buy In is `fn_my_cash_session_baseline`, the open session's baseline, which
already counts every add-on, rebuy and top-up (KingFish's Lightning cash
session reads baseline 415 = 400 + 15). It shows Buy In, Peak Stack and Net,
so it already reconciles; the Smarter.Poker art reached it with #10623.

## Live hand check

Production end-to-end specs never play a hand (`production-e2e-synthetic-hand-guard.yml`,
CLAUDE.md 11.5), so the full lifecycle is proved through the real button and the
real queue in `tests/lightning/lightning-leave-after-hand-lifecycle.test.tsx`:
mid-hand wait, single leave at the boundary, reload mid-hand, cancel, refused
cancel.
