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
