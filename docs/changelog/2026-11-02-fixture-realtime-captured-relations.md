# Preserve captured Realtime relation configuration in the private fixture

Capture15 catalogue metadata proves a nullable `realtime.schema_migrations.inserted_at` and UTC wall-clock defaults for both message timestamps. Pinned Realtime2.134.11's `20241030150047_messages_partitioning.ex` creates NOW() defaults. Public Supabase postgres migrations examined create the realtime schema and grants; no upstream provenance for the captured override was established. This helper therefore applies explicit captured deployment configuration, not a purported upstream legacy migration.

After genuine Realtime migrations, `configureFixtureRealtimeCapturedRelations` accepts only the private qualification database/local socket/native initdb identity. It requires the exact83-version digest, native owners, exact known column shapes/defaults, empty messages and five consecutive daily children of the RANGE(inserted_at) parent. Under transaction locks it makes only the captured ledger-default removal and two message-default changes; message changes run as the actual Realtime owner. A separate readback validates configured shapes and unchanged version digest. ACLs, RLS, owners, columns and unrelated relation metadata must remain unchanged. No migration history is manufactured by production fixture code, no production database is changed, and exact full-schema comparison remains mandatory.

Initial focused tests passed14 cases against a synthetic service shape using Node26.3.0. Its ledger preimage assumption and ledger-specific native/rollback claims were incorrect and are superseded by the corrected qualification below. It never established genuine Realtime execution.

ROOT wires configuration after genuine tenant migrations and completed native five-partition setup, before private schema preimage export. Existing fixture entrypoints and workflows were not edited by this helper loan.

The existing hosted bootstrap command includes this helper regression suite. The closed whole-workflow identity in requiredCiRunnerRecovery is updated for that single test addition; stage ordering, permissions, budgets and cleanup assertions remain unchanged.

## Corrected genuine fresh-ledger preimage

The initial helper qualification used a synthetic NOT NULL/no-default ledger; that assumption was wrong and its ledger-specific result is superseded. Pinned Realtime2.134.11 `priv/repo/tenant_db_dump_17.sql` creates a nullable timestamp(0) ledger at1100–1103, then explicitly SET DEFAULT now() at1428. Fresh tenants use this official dump through `migrations.ex`225–229. Source SHA256 cf54868bc12fe6a4841284970c47dc0a83ed65f73ffbad244d8b1fe3b924fecd. The helper now requires nullable/default-now and removes only the default, preserving nullability and history; the old synthetic preimage is explicitly refused.

Updated focused suite16PASS/zero skips, including ROOT's entrypoint ordering test. Native PostgreSQL17.11 exact quoted pg_dump object now reproduces306-byte before/290-byte after/first differing byte210, matching capture15. A real permission failure after default removal restores the entire exact306-byte block. These are synthetic-service SQL qualifications based on the official ledger shape, not a claim of genuine Realtime execution. Full provider/Linux and full-schema equality still remain required.
