# The promo ledger reader migration names its correction the way the incident guard reads it

Migration `20261115064521_promo_ledger_readers_resolve_their_own_account_type.sql` (#10952) was merged while the migration installers were paused for the November 15 engine release. When it was sent through Apply Merged Migration at 10:19 UTC (run 43703476148) the database refused it and committed nothing:

`P0404: An incident is not resolved until something stops it happening again. Supply correction_ref as one of: "migration <name>", "PR #<n>", ... Got "supabase/migrations/20261115064521_promo_ledger_readers_resolve_their_own_account_type.sql".`

Cause, read from the installed guard `fn_ca_resolution_needs_a_cause`: `correction_ref` must match `^migration[[:space:]]+[^[:space:]]` (or one of the other named forms). The migration passed the file path, which starts with `supabase/`, so the incident resolution at the end of its single transaction was refused and the whole migration rolled back. The PostgreSQL test of #10952 builds its own `ca_drift_incidents` fixture without that guard, so it could not see the refusal.

Fix: one string. The reference now reads `migration 20261115064521_promo_ledger_readers_resolve_their_own_account_type.sql`. The file was never installed (it is not in `schema_migrations`), so it is corrected in place, as #10839 did for a refused file. No reader definition, evidence check, amount or note changes.

Until this file installs, no engine candidate that contains #10952 can qualify, because the release selector requires every ordinary migration a candidate adds to be installed in production.
