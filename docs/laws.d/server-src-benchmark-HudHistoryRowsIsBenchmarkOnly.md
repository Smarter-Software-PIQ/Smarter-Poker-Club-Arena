# server/src/benchmark/HudHistoryRowsIsBenchmarkOnly.law.test.ts

The converter from simulated bench hands to hand_history-shaped rows (HudHistoryRows.ts, used by SPARRING to test the opponent HUD with real profiles) is benchmark-only: no engine, service or other runtime source outside src/benchmark imports it, so simulated rows can never reach a live profile, a live decision or the database (lane OPPONENT-HUD, Nov 21 2026).
