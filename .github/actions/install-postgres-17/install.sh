#!/usr/bin/env bash
# INSTALL POSTGRESQL FROM THE SIGNED PGDG SOURCE ONLY - THE ONE COPY (2026-11-07).
#
# About seventy jobs carried this block inline, and each copy failed on its own
# when the network blinked: the key download died with curl (55) SSL EOF
# several times a day (fixed by #9950, which keeps the key in the checkout),
# and the apt-get update/install calls against apt.postgresql.org and the
# Ubuntu mirror had no retry at all. Every workflow now runs this file, through
# .github/actions/install-postgres-17 or directly, so the retry lives in one
# place and a fix reaches every job at once.
#
# What it keeps exactly:
#   - apt sees ONLY the signed Ubuntu sources and the PGDG source (a private
#     sourceparts directory; the image's Chrome/Microsoft lists are excluded);
#   - the PGDG key is the byte-pinned checkout copy (.github/pgdg, fingerprint
#     B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8), installed at the path the
#     PGDG source's Signed-By names, so apt verifies every package against it;
#   - no default cluster is created.
# What it adds: apt's own per-file retries (Acquire::Retries), an update that
# fails instead of warning when an index could not be fetched, and a bounded
# whole-command retry (PG_APT_ATTEMPTS, default 4, backing off 5s, 10s, 20s).
# A signature failure is not a transfer failure: apt refuses it the same way
# on every attempt, and the step fails.
#
# Inputs (environment):
#   PG_PACKAGES       packages to install from PGDG (default: postgresql-17)
#   PG_UBUNTU_MIRROR  "true" runs scripts/ci/ubuntu-apt-mirror.py first
#   PG_APT_ATTEMPTS   whole-command attempts (default 4)
#   PG_APT_DELAY      first back-off in seconds (default 5)
set -euo pipefail

: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE must be the checkout}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
PG_KEY_SRC="$GITHUB_WORKSPACE/.github/pgdg/apt.postgresql.org.asc"
PG_KEY_DST=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
read -r -a pg_packages <<<"${PG_PACKAGES:-postgresql-17}"
[ "${#pg_packages[@]}" -gt 0 ] || { echo "::error::PG_PACKAGES names no package." >&2; exit 1; }
if [ ! -f "$PG_KEY_SRC" ]; then
  echo "::error::$PG_KEY_SRC is missing: check out the repository (with .github/pgdg) before installing PostgreSQL." >&2
  exit 1
fi

pg_attempt() {
  local n=1 max=${PG_APT_ATTEMPTS:-4} delay=${PG_APT_DELAY:-5}
  until "$@"; do
    if [ "$n" -ge "$max" ]; then
      echo "::error::failed after $n attempts: $*" >&2
      return 1
    fi
    echo "::warning::attempt $n of $max failed: $*; retrying in ${delay}s" >&2
    sleep "$delay"
    n=$((n + 1))
    delay=$((delay * 2))
  done
}

# PGDG retains several signed package versions. An extension can be published
# before the server minor it requires (2026-11-12: cron +3 needed 17.12 while
# the server was 17.11). Resolve the complete requested set before installing;
# never pin an arbitrary historical version or discard a required extension.
pg_resolve_cron() {
  local package version plan_log
  local requested=false
  local versions=() proposed=()
  for package in "${pg_packages[@]}"; do
    [ "$package" != postgresql-17-cron ] || requested=true
  done
  [ "$requested" = true ] || return 0
  # madison orders advertised versions newest first. These are the same
  # signed Ubuntu/PGDG indexes the eventual apt-get install consumes.
  versions=( $(apt-cache "${pg_apt[@]}" madison postgresql-17-cron | awk '{print $3}') )
  [ "${#versions[@]}" -gt 0 ] || { echo '::error::No indexed PostgreSQL 17 cron version.' >&2; return 1; }
  plan_log="$(mktemp "$RUNNER_TEMP/ca-postgres-plan.XXXXXX")"
  for version in "${versions[@]}"; do
    proposed=()
    for package in "${pg_packages[@]}"; do
      if [ "$package" = postgresql-17-cron ]; then
        proposed+=("postgresql-17-cron=$version")
      else
        proposed+=("$package")
      fi
    done
    if sudo apt-get "${pg_apt[@]}" --simulate install --no-install-recommends "${proposed[@]}" >"$plan_log" 2>&1; then
      pg_packages=("${proposed[@]}")
      echo "PostgreSQL package set resolves with postgresql-17-cron=$version"
      cat "$plan_log"
      return 0
    fi
    echo "PostgreSQL package set does not resolve with postgresql-17-cron=$version; no package installed."
  done
  cat "$plan_log" >&2
  echo '::error::No indexed cron version resolves the complete requested PostgreSQL package set.' >&2
  return 1
}

if [ "${PG_UBUNTU_MIRROR:-false}" = true ]; then
  sudo python3 "$GITHUB_WORKSPACE/scripts/ci/ubuntu-apt-mirror.py"
fi

pg_sources="$(mktemp -d "$RUNNER_TEMP/ca-postgres-apt.XXXXXX")"
chmod 755 "$pg_sources"
test -f /etc/apt/sources.list.d/ubuntu.sources
cp /etc/apt/sources.list.d/ubuntu.sources "$pg_sources/ubuntu.sources"
pg_apt=(
  -o "Dir::Etc::sourcelist=/dev/null"
  -o "Dir::Etc::sourceparts=$pg_sources"
  -o "Acquire::Retries=5"
  -o "Acquire::http::Timeout=60"
  -o "Acquire::https::Timeout=60"
)
pg_update=(-o "APT::Update::Error-Mode=any")
pg_attempt sudo apt-get "${pg_apt[@]}" "${pg_update[@]}" update
pg_attempt sudo apt-get "${pg_apt[@]}" install -y --no-install-recommends postgresql-common curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo install -m 0644 "$PG_KEY_SRC" "$PG_KEY_DST"
# shellcheck disable=SC1091
codename="$(. /etc/os-release && printf '%s' "$VERSION_CODENAME")"
printf 'Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\nSuites: %s-pgdg\nComponents: main\nSigned-By: %s\n' \
  "$codename" "$PG_KEY_DST" > "$pg_sources/pgdg.sources"
pg_attempt sudo apt-get "${pg_apt[@]}" "${pg_update[@]}" update
printf 'create_main_cluster = false\n' | sudo tee /etc/postgresql-common/createcluster.conf >/dev/null
pg_resolve_cron
pg_attempt sudo apt-get "${pg_apt[@]}" install -y --no-install-recommends "${pg_packages[@]}"
