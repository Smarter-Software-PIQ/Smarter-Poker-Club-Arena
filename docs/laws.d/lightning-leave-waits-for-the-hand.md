# tests/lightning/lightning-leave-waits-for-the-hand.law.test.ts

Dan 2026-11-12: Lightning "Leave Next Hand" stops matchmaking at once but leaves the table only after the current hand ends for the player (it settles, they fold, or the room closes). The button is wired to the waiting leave, nothing suppresses the action bar or cancels pre-actions while that hand plays, and a settled hand is never folded on the way out.
