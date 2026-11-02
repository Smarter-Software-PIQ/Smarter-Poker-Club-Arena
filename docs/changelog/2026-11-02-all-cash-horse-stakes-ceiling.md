# All cash horse stakes ceiling

Owner clarification November 2: horses cannot play any cash stakes above .50/1 until further notice. Restrict horses only; preserve the tables and human play. This replaces the earlier PLO-only ceiling and preserves the prohibited pineapple, 6+, and PLO8 variants. Tournament participation is unchanged.

HorseCashSchedule.ts previously applied its actual-blind check only to variants starting with `plo` (lines 28–42). The maintained helper now applies it to every cash variant. The new migration replaces the existing horse-only database admission helper; it changes no table, seat, wallet, or tournament row. Existing fleet admission and rotator calls consume the same policy, with departures through normal leaveTable cash-out. Engine installation is required for runtime departure and scheduling behavior.

Regression: the expanded engine matrix failed six tests before the change. Native PostgreSQL tests exercise the installed horse seat guard for Club and Diamond cash, preserve human/tournament entry and settlement/exit, retain legal .50/1 admission, repeat installation and prove table configuration unchanged. Existing 60% curve tests remain.

Validation: 18 focused engine tests pass after the change; six failed against the previous implementation. The native PostgreSQL 17 qualification passes, including the new all-cash matrix through the real trigger. Server TypeScript passes. Protected merge, database installation and engine/runtime proof remain pending.
