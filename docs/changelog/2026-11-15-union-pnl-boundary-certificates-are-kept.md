# 2026-11-15 - The union's week-boundary certificates are kept

Migration `20261115015159_union_pnl_boundary_certificates_are_kept.sql`.

A union weekly invoice's tournament player result moves the entries of
tournaments still running at a week boundary to the week they settle in. The
only record of those entries is the `pnl_boundary` row of
`accounting_close_certificates`, and `fn_accounting_close_certify` deletes
every certificate older than eight days each time it runs. The 2026-10-05 and
2026-10-12 boundaries were already gone on 2026-11-15; the 2026-11-02 and
2026-11-09 boundaries of the week the owner asked to reconcile go by
2026-11-19. Without them the Club Data accounting read model (PR #10879)
cannot place those entries on the week the invoice placed them.

`ca_union_pnl_boundary_capture` is an append-only copy of every ready
boundary certificate: the six production held were copied at install (count
asserted before COMMIT), and `trg_ca_union_pnl_boundary_capture` copies each
later one in the statement that writes it. A recertified boundary is a new
row; nothing updates or deletes a copy. A copy that raises is recorded in
`ca_union_pnl_boundary_capture_failures` and never refuses the certificate.
The certificates' own eight-day retention is unchanged.

Proof: `scripts/ci/test-pnl-boundary-capture.py` (workflow
`union-pnl-boundaries-are-kept.yml`), PostgreSQL 17, never production.
