# Captured pg_cron table access

The genuine pinned pg_cron provider supplies its table definitions, policies and initial public ACLs. The captured deployment additionally delegates SELECT on cron.job and ALL on cron.job_run_details to postgres with grant option. A separate bounded bootstrap fragment installs exactly those two ordinary grants and independently verifies both tables afterward.

The fragment requires the private database, Unix socket, initdb administrator identity, PostgreSQL17, genuine pg_cron1.6.4 membership, disabled scheduler, exact native heap-table definitions and initial/current ACLs. It refuses populated tables, unknown drift and repeated installation. Initial/public grants, definitions, policies, indexes, columns, extension inventory and default privileges remain unchanged. It creates no provider implementation or data repair.

Focused source tests and a private genuine PostgreSQL17.11 execution using the previously qualified pinned cron binary prove rollback/refusals and the two native ACL dump blocks. The observed metadata matches retained read-only production catalogue evidence. Hosted full-schema composition and product behavior require their existing connected checks.
