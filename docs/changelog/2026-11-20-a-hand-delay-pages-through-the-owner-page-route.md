# A hand delay pages through the owner page route, not around it (2026-11-20)

The unintended-delay watch (`fn_ca_hand_gap_watch`) pushed the owner's phone itself on every open
and every clear of every kind x shape. A delay flapping around the 250 ms budget produced 18 pushes
in 100 minutes on 2026-11-20, four in one second.

`20261120034809` removes the watch's own notifications. Its critical `financial_alerts` row already
reaches the private alert store (`financial-alerts-backfill` / `fn_ca_hand_gap_watch`), and the owner
page route now maps that row to a new kind, `hand_delay`, with its own episode clock: one page per
episode ("Unintended Delay Between Hands", summary from the alert), flaps held and counted,
recoveries never paged, and the `dealing` clock for stopped tables untouched.

- Law: `tests/a-hand-delay-pages-through-the-owner-page-route.law.test.ts`
- PostgreSQL proof: `scripts/ci/test-hand-gap-watch.py` (workflow `hand-gap-watch-proof.yml`)
- Evidence: `docs/production-alerts/evidence/hand-delay-owner-page-route/`
