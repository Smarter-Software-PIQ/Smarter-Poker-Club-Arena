# A chair is shown the moment it is taken

Owner report 2026-11-17 (PLO5 1/2 Madness, Kings Club): WooWoo bought in and the Player Record read "At A Table", but every other viewer's felt still drew "+ SIT" in his chair until he was dealt in. Required: the player's avatar appears the moment they tap +, with their sixty seconds to buy in, and stays through the buy-in.
Owner: Claude session_01BNteGc5iKyH8Xo7vLTtP4J. Worktree /Volumes/SmarterWork/agent-work/extreme-capacity/claude-pending-seat-avatar-1794948219, branch fix/pending-seat-avatar from origin/main ed74fcf2098.

Root cause: viewers draw seats only from the engine's published roster, and the engine read `table_seats` (loadSeatedPlayers) only at the hand boundary. A cash buy-in commits in `atomic_table_buyin` from the browser straight to the database, so the engine learned of it only when the next hand was prepared. The + tap was known only to the tapper's own screen (TablePage pendingSeat).

Repair (display only, no money or hand path touched): engine `SeatArrivalDisplay` and `POST /seat_arrival` (hold on the + tap with the player's own profile identity and a 60 s window; release when the sheet closes unpaid; seated after the RPC commits, which reads the committed seat rows). Published on the live, idle, resync and observer payloads as nonparticipant seats with `seat_arrival`; the hand roster supersedes them at adoption (two missed rosters drop a committed arrival). Client maps `seat_arrival` to a "Buying In" / "Joining" badge, ignores the hero's own buying-in echo, and sends the three events.

Not changed: the buy-in RPC stays the only door to a seat; a held chair is not exclusive in the database (another client's tap on it is refused by the seat-occupied guard, the RPC is not). Horse buy-ins (HorseFleetManager, in-process) send no event; they are shown when any arrival event or the hand boundary reads the roster.

Tests: server/src/engine/aChairIsShownTheMomentItIsTaken.law.test.ts (reproduces the missing chair mid-hand, then pins every publication path, the window, refusals, release, adoption, anonymity), server/src/handlers/seatArrival.test.ts, tests/unit/aChairIsShownTheMomentItIsTaken.test.ts.
Status: see PR. Implemented, tested, merged, published and live-verified are recorded separately in the PR body and final report.
