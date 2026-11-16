# Signup credit owner fixture

`signup-owner.sql` is the byte-equivalent definition of
`public.fn_sp_signup_welcome_back_run(integer,date)` read through configured
Supabase SQL access from PokerIQ-Production on 2026-11-16. Its measured
`pg_get_functiondef` MD5 is `e1d4ed9955a87803e7093b057409fb2d`.

The migration refuses a different owner preimage. The native test installs this
snapshot and extracts the actual modified credit subtransaction after applying
the migration. It exercises that source block with the real identity functions,
constraints and profile trigger, plus an isolated idempotent credit fixture.
It never invokes production, sends a message or spends real chips.
