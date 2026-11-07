# tests/the-frozen-door-says-when-it-opens.law.test.tsx

Dan, 2026-11-07: while the database refuses new entries, every Join surface says when it opens. The entry guard `fn_entry_purchases_frozen()` decides frozen or open; `fn_maintenance_break_state()` supplies when it ends. Lobby boards and the Lightning page show "Opens In m:ss" in place of Join, the banner stays up until the release boundary passes (not when the engine resumes), and every refusal names the wait ("Seats Reopen In About 47 Seconds"). The Lightning page never reports the freeze as a failure.
