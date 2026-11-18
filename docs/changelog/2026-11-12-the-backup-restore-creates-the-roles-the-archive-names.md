# 2026-11-12: the Backup restore creates the roles the archive names

## What changed and why

On 2026-11-12 five Backup certifications ended `database_refresh_failed`. Production
had gained a NOLOGIN role, `daily_content_reporter`, created outside this repository.
`cmd_restore` in `server/standby/standby-engine.sh` created a fixed list of production
roles before `pg_restore --exit-on-error`, the new role was not in it, and the first
`GRANT ... TO daily_content_reporter` stopped the restore. #10665 added that one role,
as #10413 had for `engine_lightning_lane`. The next role anyone created in production
would have blocked every engine release the same way.

The restore now asks the archive itself. Before the real `pg_restore` it extracts the
SQL of the active `ACL`, `DEFAULT ACL` and `POLICY` entries only (never a function
body) with `pg_restore --use-list ... -f -`, reads the role named by each
`GRANT ... TO`, `REVOKE ... FROM`, `ALTER DEFAULT PRIVILEGES FOR ROLE`,
`SET SESSION AUTHORIZATION` and `CREATE POLICY ... TO`, and creates each one the
isolated copy lacks as
`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, with no
password and no membership.

- The explicit list stays, now as `EXPECTED_RESTORE_ROLES`. A role created outside it
  logs `restore: WARNING unlisted_role_auto_created:<role>` in the Backup log so the
  surprise is visible and the role gets listed.
- A role name outside `^[a-z_][a-z0-9_]{0,62}$` refuses the restore before anything is
  loaded, with `database_refresh_failed:unsafe_role_name:<sanitised>`.
- A line the reader does not recognise names no role and restores exactly as before.
  If `pg_restore` still stops on a missing role, the log now says
  `database_refresh_failed:missing_role:<role>` instead of leaving it in `restore.log`.

Nothing else moved: `--exit-on-error`, the zero-error count, owner alignment, schema
evidence, isolation, release authority, seal, floor, owner windows and activation are
untouched. `--no-owner` already keeps object owners out of the restore.

## Proof

`tests/dr-posture.test.ts` drives the real `cmd_restore` with command doubles: seven
new cases fail on the previous script and pass on this one (unlisted grantee created
and warned, four unsafe names refused, missing role named, no attribute or password on
any `CREATE ROLE`). The reader was also run against a real PostgreSQL 17 `pg_dump`
archive from a scratch local cluster holding column grants, grant options, a foreign
grantor, default privileges, a quoted table name containing `TO`, a policy whose name
contains `TO` and a policy expression containing ` TO x USING (`; it returned exactly
the five roles granted to.

## Not done here

No restore was run against the standby host; the first Backup refresh after merge is
the live proof. This must not merge before the 2026-11-13 03:55Z engine seal.
