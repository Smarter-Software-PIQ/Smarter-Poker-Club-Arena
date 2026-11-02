# Preserve the captured GraphQL namespace initial ACL baseline

Connected capture17 refused `NATIVE_OBJECT_MISSING` for two native pg_dump ACL
objects, one for `graphql` and one for `graphql_public`. Read-only production
metadata establishes that each namespace is owned by `supabase_admin`, has the
same five current and initial grants, initial privilege type `e`, and no current
extension membership. The fixture had the current grants without that initial
baseline, so ordinary pg_dump correctly emitted extra ACL objects.

The maintained fixture now uses the explicitly named disposable
`fixture_graphql_acl_baseline` extension to perform three ordinary GRANT
statements against only those two preexisting namespaces. PostgreSQL records
the initial privileges itself. The helper creates no objects, is checked to have
zero members, and is dropped with RESTRICT inside the existing admin extension
transaction before any of the thirteen genuine provider installations. It does
not implement or stand in for a GraphQL provider.

The preimage requires the private qualification database, local socket, PG17,
current and session initdb admin/OID10, exact five-entry current ACLs and owners,
absent initial ACLs, absent namespace extension memberships, no installed helper
and exact available helper metadata. Postimage and independent post-commit
observation require exact current privileges, raw initial/current ACL equality,
privilege type `e`, no namespace memberships and no installed helper. Missing,
unknown, repeated or drifted input refuses. No system catalogue is written
directly and no binary-upgrade mode, relaxed comparison or schema exclusion is
introduced. New helper sources are included in the exact Docker build context
and native receipt source closure. Existing ordinary representative test glob
executes the focused wiring and control-contract regressions.

Focused source tests cover transaction ordering, independent observer identity,
negative observer results, exact GRANT-only bytes, helper control metadata and
normal rollback/refusal safeguards. Genuine private PostgreSQL17.11 reproduction
also passed the exact maintained install and fresh observer, preserving raw
current ACLs and the extension inventory. Both extra dump ACL keys disappeared.
Rollback after installation and drift, occupied-helper, ordinary-role, wrong
search-path and repeat refusals passed; the owned cluster and runtime were
removed. Hosted Linux native and full-schema connected acceptance remain
separate requirements; this proof does not establish product completion.
