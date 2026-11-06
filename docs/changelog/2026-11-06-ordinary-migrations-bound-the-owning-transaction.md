# Ordinary migrations bound the owning transaction

On November 2, a migration membership UPDATE retained a row needed by tournament payout for 22.7 seconds. The ordinary installer had only statement limits: several short statements can retain the same locks for much longer than one statement.

The existing installer now applies its existing PostgreSQL 17 twelve-second whole-transaction bound to ordinary installations. Expiry rolls back the original transaction and its atomic migration history; it never sends a second attempt. Concurrent index preambles finish first. The exact qualified settlement, accounting and thaw routes retain their existing admission budgets; maintenance retains its existing shorter assertions. Already-applied sources are read back without replay.

Ordinary source cannot explicitly disable or lengthen the transaction bound. New migrations are checked with the same admission helper before merge. Historical bytes are not rewritten; an uninstalled historical file with an incompatible timeout must be reviewed and corrected through the maintained source route, not repeatedly dispatched. The static check is source validation, not a sandbox for hostile dynamically generated SQL.

## Verification

The actual TLS installer previously committed the native fixture after fifteen seconds while a second writer waited. With the bound, PostgreSQL returns 25P04, no migration history exists, the original balance change rolls back and the waiting writer commits its independent increment. The fixture also refuses explicit timeout overrides before DDL. Existing native TLS, atomic history, lost-acknowledgement and qualified special-route tests remain required in the existing CI job. Final actual-installer TLS cases passed. An unchanged pruner child later failed on local PostgreSQL global/pg_filenode.map open EINTR; its earlier passing exact-input evidence is retained, and the required Linux job still must pass. Focused thaw-installer qualification, 794 focused assertions and root TypeScript passed. Protected publication is pending. No production data repair or migration replay was performed.
