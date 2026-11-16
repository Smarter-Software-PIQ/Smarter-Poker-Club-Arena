# tests/weekly-rakeback-status.law.test.ts

The Weekly Rakeback Status reader (20261116020505) adds exactly one function, public.ca_union_weekly_rakeback_status, that only reads with plain SELECTs (no writes, no row or advisory locks, its own 5 s statement and 1 s lock limits), uses the Union Statements board's caller rule (ca_can_oversee_union, 42501 otherwise) with REVOKE from PUBLIC and anon and GRANT to authenticated and service_role, and the Union Statements page section reads it again once a minute only while the payout is in progress, styled only with the page's own module.
