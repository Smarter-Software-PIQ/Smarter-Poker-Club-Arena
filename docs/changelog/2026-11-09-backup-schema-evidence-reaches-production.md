# Backup schema evidence reaches the production database again

**In plain English.** #10113 added a production schema check to every Backup refresh. The check could never connect, so every Backup after it failed in its first second and no newer engine could be certified for the 04:00 release. Now it connects.

## Cause
`server/standby/schema-evidence.py capture` handed the production `DATABASE_URL` to `psql` through `PGDATABASE`, so the URL would stay out of process arguments. psql does not expand a connection URI found in `PGDATABASE`: it treats the whole URI as a database name and connects to the local socket. On the runner that fails at once:
- Backup run 42547609440 (head 8aede69f) refused 0.12 s into the export step: "Schema evidence refused; capture, signatures, migration set or dump binding invalid".
- Reproduced on the Ops Mac: `PGDATABASE=postgresql://...` gives `connection to server on socket "/tmp/.s.PGSQL.5432" failed`.

## Fix
`connection_environment` splits a URI or keyword connection string into the libpq variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, and a few more). The URL still never appears in arguments or diagnostics. Anything else is refused, fail closed:
- an unsupported parameter, including `options`, which would replace the read-only `PGOPTIONS`;
- several hosts;
- no host at all.

The check itself is unchanged: the same read-only bounded query, the same before/after comparison, the same dump binding.

## Tests
- `test_schema_evidence.py` gains two cases:
  - a percent-encoded URI password reaches `PGPASSWORD`, with nothing in the arguments and no URI in `PGDATABASE`;
  - keyword strings parse, and unsupported forms are refused.
- All 12 cases pass.
- Live demonstration against an unresolvable host: the new code tries that host, the old code tried the local socket.

`server/standby/` is not a release-control input (`scripts/ci/read-engine-prequalification.py` CONTROL_INPUTS), so tonight's daily reservation is unaffected.
