# The place-evidence guard uses the key index (2026-11-17)

Nightly 20K `10d3c9b3` (621 entrants) could not finish. Every terminal settlement ran for its full 45 s
of CPU and was cancelled, so first place stayed unpaid.

**Cause.** One guard in `fn_settle_tournament_places` joins `tournament_obligations` to
`wallet_credit_idempotency` on a LIKE pattern that is computed per obligation. No index can serve that
pattern, so the query read all 1.9M wallet credits once per paid place. For this event that was 177M
comparisons, which took 19.3 s even with three parallel workers. The cost grows with the platform's whole
credit history and with the number of paid places.

**Fix.** Migration `20261117085019` adds the tournament's constant key prefix as a byte-wise range on the
existing `text_pattern_ops` index. The LIKE stays as it was, so the guard gives the same answer, but the
query now takes 7.5 ms. The law test is `tests/the-place-evidence-guard-uses-the-key-index.law.test.ts`.
Evidence is in `docs/production-alerts/evidence/tournament-terminal-statement-timeout-621-entrants/`.

**Not in this change.** Other functions use the same per-row LIKE shape:
- final-table deal settlement
- satellite cohort settlement
- mystery-bounty completion evidence
- the satellite conservation audit

Each of them needs its own measurement before it is changed.
