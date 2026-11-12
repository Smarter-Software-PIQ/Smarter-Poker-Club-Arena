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
# PGDG can publish an extension rebuild before its required server release.
# Ask apt to solve the whole requested set, including an older extension
# version when the newest cannot coexist with the current server candidate.
# Never weaken package signatures or install a dependency-breaking binary.
if printf '%s\n' "${pg_packages[@]}" | grep -qx postgresql-17-cron; then
  pg_server_version=$(apt-cache "${pg_apt[@]}" policy postgresql-17 | awk '/Candidate:/ {print $2}')
  pg_cron_version=''
  while IFS= read -r pg_version; do
    if sudo apt-get "${pg_apt[@]}" --simulate install -y --no-install-recommends \
      "${pg_packages[@]/postgresql-17-cron/postgresql-17-cron=$pg_version}" >/dev/null 2>&1; then
      pg_cron_version=$pg_version
      break
    fi
  done < <(apt-cache "${pg_apt[@]}" madison postgresql-17-cron | awk '{print $3}')
  [ -n "$pg_cron_version" ] || { echo "::error::No signed pg_cron package solves the requested PostgreSQL set ($pg_server_version)." >&2; exit 1; }
  pg_packages=("${pg_packages[@]/postgresql-17-cron/postgresql-17-cron=$pg_cron_version}")
  echo "PostgreSQL $pg_server_version; compatible pg_cron $pg_cron_version"
fi
pg_attempt sudo apt-get "${pg_apt[@]}" install -y --no-install-recommends "${pg_packages[@]}"
