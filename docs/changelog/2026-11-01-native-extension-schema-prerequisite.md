# Exact native extension target namespace prerequisite

Capture10 passed private schema capture, then failed preimage readiness with
SQLSTATE3F000 and closed namespace.c/get_namespace_oid hashes. The historical
missing namespace identity was not retained. Role alignment already creates
`extensions`; its initial five-schema witness is captured before alignment.
The aligned source witness lacks `vault`, a later explicit extension target.

A configured read-only postgres/auth-null namespace query supplied the exact
vault owner and ACL. Create that namespace atomically in the existing admin
extension transaction and assert its captured postimage before/after all13
genuine providers. Refuse occupied namespaces and unexpected ACLs. Preserve
existing schemas, non-superuser application identity, provider versions/owners,
full schema/role/ACL contracts, snapshot,45-second capture and original tuple.

The existing credential-free native preimage container now runs schema-preimage
instead of stopping at role alignment. A strict closed proof requires38roles,
13extensions, exact namespace ownership/ACL and actual schema-only export before
readiness; no raw schema is uploaded. Existing read/ACK/wait and cleanup remain.

Real private PostgreSQL17.11 reproduced the absent-target namespace failure with
genuine dblink, matching the capture's exact closed hashes. The new prerequisite
passed exact ACL/owner and genuine extension creation, preserved other schemas,
and refused occupied state, unexpected default ACL, ordinary role and wrong DB.
Its cluster/data/socket were removed. This is namespace-boundary proof, not local
full13-provider/Supabase Vault qualification. Focused tests, TypeScript and1822
source bindings accompany the change. Actual Linux native qualification, protected
delivery and the original15 connected cases remain unproved. No production DDL,
credential read, capture retry or provider operation was performed.

The first Linux candidate passed native SQL-export qualification but stopped in
the connected outer-lifetime unit test: its mocked smoke boundary omitted the
new current-application proof, so the strict parser correctly refused before the
connected callback could create its report. Add the explicit closed proof to that
mock, validate it with the real parser and assert its unchanged handoff to the
callback. Preserve all cleanup/privacy/case assertions and the strict production
parser. This corrects the missed directly affected test caller; it is not native
13-provider execution. That failed job produced no fixture artifact and never
started genuine schema-preimage runtime; native diagnostic-tool cleanup passed.

The corrected dd6 native run reached genuine schema-preimage startup but failed
inside current role/extension checks with AssertionError. Its exact assertion
site was not recorded. API/computed artifact digest and all31 source bindings
matched, all five cleanup fields and native tool cleanup passed; no current
38-role/13-provider proof was issued. The pinned Vault archive and both exact
0.3.0/0.3.1 SQL source files contain no schema ACL/owner mutation, so that
speculation is not a demonstrated cause.

Add twelve closed assertion-site tokens to the existing failure channel and
strict independent decoder. Existing assertion operators and all original
actual/expected arguments are unchanged; only optional fixed message objects
were appended. Exact Node22 behavior was checked because string messages append
private diffs, while supplied AssertionError objects retain only the fixed
token. Controlled role/inventory/namespace drifts, malformed/tampered/private
fields and an actual child primary-failure/cleanup sequence exercise attribution
and privacy. This is diagnostic qualification, not a claim that the unknown
underlying native failure or the original15 connected cases are fixed.

The changed dc3 Linux run now identifies EXTENSION_POSTIMAGE after genuine
extension creation, with all31 source bindings and all five cleanup fields
verified. Pinned Supautils3.4.3 creates privileged extensions as its configured
supabase_admin, so requesting the three postgres-owned extensions through the
application connection cannot preserve their captured ownership. The earlier
unit double incorrectly treated the requesting identity as the creating owner.

Use one fresh original-initdb-admin session for those three providers, with no
session hook on that administrative connection alone. One transaction creates a
fixed NOLOGIN bootstrap owner, installs the genuine extensions, reassigns that
new owner's objects through PostgreSQL's native operation and drops the owner.
Its identity, empty preimage and exact three-extension ownership are checked.
The application role is never promoted, its managed connection/configuration is
unchanged, and the transient owner is never committed. Existing exact final
extension/version/schema/owner and vault ACL comparisons remain mandatory.
Native PostgreSQL rollback/ordinary-role proof and actual Linux thirteen-provider
qualification are required; this source change alone is not a pass.

Local ownership qualification passed on genuine PostgreSQL17.11 with actual
pg_stat_statements, pgcrypto and uuid-ossp: old admin ownership differs from the
captured postgres owner; the native bootstrap/reassignment reaches exact owners.
Rollback removes the temporary owner and partially created extension; the owner
never becomes visible to the ordinary held session, the application never gains
superuser, ordinary bootstrap requests refuse, and duplicate-extension failure
rolls back cleanly. Cluster, data and socket were removed. This check does not
execute Supautils or all13 providers. The maintained unit regression now models
the actual Supautils creating identity: old dc3 fails EXTENSION_POSTIMAGE, new
17 affected Node cases pass. Root TypeScript and1822 source bindings passed.
An initial private-cluster harness grouped CREATE DATABASE with another command;
it failed before the probe, was corrected to separate statements and retained
as a setup failure. No production operation or missing native proof is hidden.
