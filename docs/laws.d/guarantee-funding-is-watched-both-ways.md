# tests/guarantee-funding-is-watched-both-ways.law.test.ts

House or promo funding of a guaranteed tournament is H = max(0, G - C) in total, C being the players' full payments including bounty and rake shares; no legacy path (the retired back-pay) can pay it again, the guarantee check counts rake toward the guarantee, and any finalized event funded above or below H is recorded within 15 minutes without moving chips (owner, 2026-11-05).
