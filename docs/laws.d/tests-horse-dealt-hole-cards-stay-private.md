# tests/horse-dealt-hole-cards-stay-private.law.test.ts

smarter_private.horse_dealt_hole_cards (every Horse's dealt hole cards, for audits) stays service-role only: RLS with no policy, no client grant, view or publication, named only by its writer, proof and declaration, and its payload key is built from Horses only and read by nothing else.

One offline reader is admitted (2026-11-20, Horse Decisions lane): server/scripts/horse-daily-decision-grade.ts, the daily real-card audit, which queries only through the Supabase management API with read_only: true, never through a client or supabase-js, and prints aggregates only (no card, no hand id). The law pins those three facts.
