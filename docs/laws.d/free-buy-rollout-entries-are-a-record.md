# tests/free-buy-rollout-entries-are-a-record.law.test.ts

The Midway Free Buy entries made before tickets went live (first redemption 2026-11-05 23:18:46.9654 UTC) are recorded once each in an append-only table with the promo head that funded them; only those recorded registrations are exempt from the Free Buy funding watch's entry-without-ticket check, so any other ticketless entry is reported at any time, and nothing moves chips (owner, 2026-11-05 and 2026-11-06).
