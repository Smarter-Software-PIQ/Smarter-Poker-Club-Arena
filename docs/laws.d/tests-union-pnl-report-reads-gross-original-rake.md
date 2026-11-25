# tests/union-pnl-report-reads-gross-original-rake.law.test.ts

- **Owner:** Accounting / Union P&L Weekly Close
- **Incident:** `605ea9ca-2591-4e1c-ad5d-6544258a67fc` (`union_accounting_scheduler`) + drift `378c5998` & `25365b5d` (`union_eco_not_recorded`)
- **Migration:** `supabase/migrations/20261123202500_union_pnl_report_reads_gross_original_rake.sql`
- **Invariant:** After `20261116154831` narrowed `public.accounting_payable_earning_sources.rake_credit` to `payable_rake_credit` (`gross - promo_excluded_credit`) for agent commissions and player rakeback, both `public.fn_union_pnl_evidence_report` and `public.fn_union_pnl_week_rake_straddle` must read gross original rake (`COALESCE((s.contract->>'rake_credit')::numeric, s.rake_credit)`) for all-player P&L and bank reconciliation, and move the downstream MD5 pins cleanly in the same transaction.
