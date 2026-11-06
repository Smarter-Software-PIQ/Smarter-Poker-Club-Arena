# tests/a-built-free-buy-matches-its-schedule.law.test.ts

A built Midway Free Buy matches its schedule: the database refuses an unstarted event whose format differs from its schedule slot, and the scheduler rebuilds a wrongly-shaped, unstarted, horse-only occurrence through atomic_cancel_tournament (every entry refunded) and a fresh spawn, never by event id.
