# tests/the-frozen-door-says-when-it-opens.law.test.tsx

Dan, 2026-11-07: while the database refuses new entries, every Join surface says when it opens. The database's `fn_maintenance_break_state()` is the one authority (it reads the same break row and release boundary as the freeze guards). Lobby boards and the Lightning page show "Opens In m:ss" in place of Join, the banner stays up until the release boundary passes (not when the engine resumes), and every refusal names the wait ("Seats Reopen In About 47 Seconds"). The Lightning page never reports the freeze as a failure.
