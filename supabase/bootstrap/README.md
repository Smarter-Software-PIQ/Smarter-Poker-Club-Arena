# Shared PokerIQ schema bootstrap

This is a schema-only snapshot for reconstructing the observed PokerIQ catalog in
a fresh isolated PostgreSQL database. The native dump and independent catalog
reference use the same exported read-only transaction snapshot. The source
inventories fingerprint fixed Club Arena and World Hub revisions. The
reconciliation file lists source migrations without an exact version match
in the captured production ledger.

Use the Full shared schema rebuild workflow on the exact candidate. It checks
both inventories against their fixed revisions and runs the native restore in
the pinned Supabase PostgreSQL image with networking disabled. The verifier
compares schema objects, owners, grants, roles, memberships, extensions and
database initialization settings against the independent reference. It confines
all captured login roles to NOLOGIN and disables scheduled job execution.

The workflow uploads the comparison receipt. The bootstrap contains schema
metadata and omits business rows, role passwords, and vault records. Its
forward manifest is empty. Capture and isolated qualification leave the
production migration history and ledger untouched. Installation of a new
migration requires separate evidence through the owning repository.
