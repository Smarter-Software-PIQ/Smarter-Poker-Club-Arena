# tests/a-guarantee-counts-the-full-buy-in.law.test.ts

A tournament guarantee counts the full qualifying buy-in, before bounty and rake allocations (40 paid as 26 prize / 10 bounty / 4 rake counts 40). House or promo funding is H = max(0, G - C) in total, and zero once the players' payments reach the guarantee, on every funding, settlement, retry and legacy path; over- and under-funding are recorded, never silently repaired (owner, 2026-11-05).
