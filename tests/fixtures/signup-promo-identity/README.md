# Signup credit owner fixture

`signup-owner.sql` is the byte-equivalent definition of
`public.fn_sp_signup_welcome_back_run(integer,date)` read through configured
Supabase SQL access from PokerIQ-Production on 2026-11-16. Its measured
`pg_get_functiondef` MD5 is `51629e5f1ef59835c3719ec553356eb8`, after the
existing KINGS weekly campaign owner was installed. `weekly-owner.json` captures
the current second owner read from production on 2026-11-17, MD5
`a5b39719461d6f6e9e81c46acb2301fd`. Migration 205150 moved its book gate
to the original weekly document receipt, preserving its eligibility, locks,
25-chip credit and lifetime award receipt. The identity migration patches only
the pre-credit claim and retains that entire current owner and postgres-only ACL.

The JSON preserves pg_get_functiondef whitespace exactly, including its blank-line spaces.
The migration refuses a different owner preimage. The native test installs this
snapshot and extracts the actual modified credit subtransaction after applying
the migration. It exercises both source credit blocks with the real identity functions,
constraints and profile trigger, plus an isolated idempotent credit fixture.
It never invokes production, sends a message or spends real chips.
Weekly book selection and full financial disbursement qualification remain in
their original maintained proofs; this fixture isolates identity/payment atomicity.
