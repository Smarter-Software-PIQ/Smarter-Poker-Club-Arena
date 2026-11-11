# shellcheck shell=bash
# Turn a postgres connection URL held in an ENVIRONMENT variable into libpq's
# PG* environment variables, so psql runs with no URL (and no password) in its
# argument list. A URL on the command line is visible to every process listing
# on the machine (`pgrep -fl`, `ps aux`); the environment is not
# (.agent/audits/2026-11-10-SECURITY-INCIDENT-process-listing-credential-exposure.md).
#
# Usage:  source scripts/lib/pg-env-from-url.sh
#         pg_env_from_url DATABASE_URL   # the variable's NAME, never its value
#         psql -X ...                    # no URL argument
#
# The URL is read by python3 from the environment, never from argv, and the
# exports come back on stdout into eval, so nothing is printed.
pg_env_from_url() {
  local name="${1:?pg_env_from_url needs the NAME of the variable holding the URL}"
  [[ -n "${!name:-}" ]] || { echo "pg_env_from_url: ${name} is not set" >&2; return 1; }
  local exports
  exports="$(PG_ENV_FROM_URL_NAME="$name" python3 -I - <<'PY'
import os, shlex, sys
from urllib.parse import urlsplit, unquote, parse_qs
url = os.environ[os.environ["PG_ENV_FROM_URL_NAME"]]
u = urlsplit(url)
if u.scheme not in ("postgres", "postgresql"):
    sys.stderr.write("pg_env_from_url: not a postgres URL\n"); sys.exit(1)
out = {}
if u.hostname: out["PGHOST"] = u.hostname
if u.port: out["PGPORT"] = str(u.port)
if u.username: out["PGUSER"] = unquote(u.username)
if u.password is not None: out["PGPASSWORD"] = unquote(u.password)
db = unquote(u.path.lstrip("/"))
if db: out["PGDATABASE"] = db
q = parse_qs(u.query)
if "sslmode" in q: out["PGSSLMODE"] = q["sslmode"][-1]
print("\n".join(f"export {k}={shlex.quote(v)}" for k, v in out.items()))
PY
)" || return 1
  eval "$exports"
}
