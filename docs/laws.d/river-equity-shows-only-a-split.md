# tests/river-equity-shows-only-a-split.law.test.tsx

Dan, 2026-11-19: equity pop-ups are for preflop, flop and turn only; on the river they never show 0% or 100% (the hands already show it) and appear only for a split pot, showing the split percentages. One gate (`src/lib/equityDisplayGate.ts`) decides for every render site: the on-table badge layer, the Run It Twice rows and the hand-history equity chips.
