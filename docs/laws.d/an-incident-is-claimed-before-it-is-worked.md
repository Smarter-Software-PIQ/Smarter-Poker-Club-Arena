# tests/an-incident-is-claimed-before-it-is-worked.law.test.ts

A reliability incident is claimed atomically before a lane works it (incident d2d79c4f reached two lanes that could not see each other on 2026-11-18): the claim primitive refuses a live claim held by another lane and names that owner, the escalation text shows a live claim, the behaviour is proven on PostgreSQL in the Stage B harness, and CLAUDE.md 10.88 tells every agent to claim first.
