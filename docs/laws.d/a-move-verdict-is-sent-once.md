# server/src/tournament/aMoveVerdictIsSentOnce.law.test.ts

A move verdict is sent once. moveTournamentPlayerAtomically resent every request under the same request id even after a definite refusal, so each "tournament move destination seat is occupied" was taken, refused and logged twice (72 lines, 36 refusals, 2026-11-25/26). A first-attempt definite refusal is now final for that identity and the manager re-plans with a fresh chair and a new id (PR #11980); lock contention, routing failures, an earlier ambiguous attempt or an outcome already unknown still get the one identical resend.
