# tests/weekly-club-statement-reads-gross-original-rake.law.test.ts

- **Owner:** Accounting / Weekly Club Statements & Rake Snapshots
- **Incident:** `605ea9ca-2591-4e1c-ad5d-6544258a67fc` (`union_accounting_scheduler`) + drift `378c5998`
- **Migration:** `supabase/migrations/20261124010800_weekly_club_statement_reads_gross_original_rake.sql`
- **Invariant:** After `20261116154831` narrowed `public.accounting_payable_earning_sources.rake_credit` to `payable_rake_credit` (`gross - promo_excluded_credit`) for agent commissions and player rakeback, both `public.fn_club_weekly_accounting_summary` (basis/fingerprint and private `tournament_source_groups`) and `public.fn_capture_weekly_club_rake_snapshot` must read gross original rake (`COALESCE((contract->>'rake_credit')::numeric, rake_credit)`) so weekly club statements reconcile cleanly against gross union close basis and bank receipts while keeping `accounting_payable_earning_sources` payable for commission and rakeback.
