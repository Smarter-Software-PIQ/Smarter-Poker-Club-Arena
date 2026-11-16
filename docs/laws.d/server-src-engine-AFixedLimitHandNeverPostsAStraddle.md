# server/src/engine/AFixedLimitHandNeverPostsAStraddle.law.test.ts

A fixed-limit hand never posts a straddle: the dealer collects none for a fixed-limit hand and HandController refuses (and reports) one it is handed, so the preflop keeps four levels; no-limit and pot-limit straddles are unchanged (2026-11-15)
