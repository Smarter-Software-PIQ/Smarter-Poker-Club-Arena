# Table layout initializes its scheduler before placing avatars

Mongo's November 1 report matched production client_crash_log records 3114–3120 on Windows Chrome and iPhone Safari, table 7955fbe3-dc01-4f9a-b626-ad8b41791d72. The served TablePage-BBo48ASM-v6.js stack at line 2, column 383773 maps to the callback passed from useProtectedCardLayout to createOpponentAvatarLayout.

The first `place()` ran before the `schedule` const and its frame state were initialized. When retained decoded portrait metadata let `prepare()` detect a changed ring synchronously during effect initialization, it called that callback and threw a ReferenceError. The per-table boundary then displayed Table Not Displayed. Reloading could hit the same lifecycle again.

Initialize the existing frame scheduler before the first placement. Preserve synchronous initial placement, frame coalescing, animation behavior and cleanup. No game, seat, chip, engine or database writes change.

Regression: protectedCardLayoutStartup.test.tsx mounts the real hook and opponent layout with decoded image pixels, then changes the hand and anchor identity. It fails before the correction with `Cannot access 'schedule' before initialization`; it also checks that the resulting frame is coalesced and cancelled on unmount. Focused layout suites and TypeScript results are recorded in the incident checkpoint. Publication/live proof remain separate from source validation.

Real-time law: existing hand/revision and DOM layout events retain their ownership; no snapshot diff or polling added.
