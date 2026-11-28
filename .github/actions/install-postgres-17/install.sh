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
# THE UBUNTU MIRROR GOES THROUGH THE ONE ENTRY POINT (2026-11-19). Every
# install selects the shared multi-host mirror list first
# (scripts/ci/ubuntu-apt.sh setup), bounds every attempt
# (PG_APT_ATTEMPT_SECONDS) and starts each retry on a different Ubuntu mirror
# (scripts/ci/ubuntu-apt.sh rotate). It used to be opt-in (PG_UBUNTU_MIRROR),
# so most of the hundred-odd callers waited on one host with no bound.
#
# Inputs (environment):
#   PG_PACKAGES             packages to install from PGDG (default: postgresql-17)
#   PG_SERVER_MINOR         server minor to install (default: VERSION in
#                           scripts/ci/build_pg17_isolationtester.py)
#   PG_UBUNTU_MIRROR        accepted for older callers; the mirror is always set
#   PG_APT_ATTEMPTS         whole-command attempts (default 4)
#   PG_APT_DELAY            first back-off in seconds (default 5)
#   PG_APT_ATTEMPT_SECONDS  bound on each attempt (default 240)
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

PG_UBUNTU_APT="$GITHUB_WORKSPACE/scripts/ci/ubuntu-apt.sh"
if [ ! -f "$PG_UBUNTU_APT" ]; then
  echo "::error::$PG_UBUNTU_APT is missing: check out scripts/ci/ubuntu-apt.sh, ubuntu-apt-mirror.py and ubuntu-apt-mirrors.txt before installing PostgreSQL." >&2
  exit 1
fi

pg_attempt() {
  local n=1 max=${PG_APT_ATTEMPTS:-4} delay=${PG_APT_DELAY:-5} bound=${PG_APT_ATTEMPT_SECONDS:-240}
  until timeout --kill-after=15 "$bound" "$@"; do
    if [ "$n" -ge "$max" ]; then
      echo "::error::failed after $n attempts: $*" >&2
      return 1
    fi
    echo "::warning::attempt $n of $max failed or exceeded ${bound}s: $*; retrying on the next Ubuntu mirror in ${delay}s" >&2
    bash "$PG_UBUNTU_APT" rotate
    sudo dpkg --configure -a >/dev/null 2>&1 || true
    sleep "$delay"
    n=$((n + 1))
    delay=$((delay * 2))
  done
}

# Only the explicit, complete native fixture tuple may replace newer image
# packages. All other callers retain apt's ordinary downgrade refusal.
pg_fixture_install_options=()
pg_fixture_install_policy() {
  local package argument found
  pg_fixture_install_options=()
  [ -n "${PG_FIXTURE_VERSION:-}" ] || return 0
  [[ "$PG_FIXTURE_VERSION" =~ ^17\.[0-9]+$ ]] || return 1
  for package in postgresql-17 postgresql-client-17 postgresql-server-dev-17; do
    found=false
    for argument in "${pg_packages[@]}"; do
      [ "$argument" != "$package=$PG_FIXTURE_VERSION-*" ] || found=true
    done
    if [ "$found" != true ]; then
      echo '::error::Native fixture replacement requires all three exact core package constraints.' >&2
      return 1
    fi
  done
  pg_fixture_install_options=(--allow-downgrades)
}

# A PGDG rebuild can precede the server it was built against (2026-11-12:
# cron 1.6.8 +3 required PG17.12 while the index still offered PG17.11).
# Let apt prove the whole requested tuple. If its newest cron build cannot
# resolve, consider at most five earlier builds of that SAME upstream cron
# version. Never change the requested extension version or trust source, and
# install only once, after a complete simulation succeeds.
pg_resolve_cron_build() {
  local requested=false package candidate upstream version count=0
  local -a trial
  for package in "${pg_packages[@]}"; do
    [ "$package" != postgresql-17-cron ] || requested=true
  done
  [ "$requested" = true ] || return 0
  if apt-get "${pg_apt[@]}" --simulate install --no-install-recommends "${pg_packages[@]}"; then
    return 0
  fi
  candidate="$(apt-cache "${pg_apt[@]}" policy postgresql-17-cron | awk '/Candidate:/ {print $2}')"
  case "$candidate" in
    *-*.pgdg*) upstream="${candidate%-*}" ;;
    *) echo '::error::No signed PGDG cron candidate can be established.' >&2; return 1 ;;
  esac
  while read -r version; do
    [ "$version" != "$candidate" ] || continue
    [ "${version%-*}" = "$upstream" ] || continue
    case "$version" in *-*.pgdg*) ;; *) continue ;; esac
    count=$((count + 1))
    [ "$count" -le 5 ] || break
    trial=()
    for package in "${pg_packages[@]}"; do
      if [ "$package" = postgresql-17-cron ]; then
        trial+=("postgresql-17-cron=$version")
      else
        trial+=("$package")
      fi
    done
    if apt-get "${pg_apt[@]}" --simulate install --no-install-recommends "${trial[@]}"; then
      echo "PostgreSQL tuple resolved with signed cron build $version (candidate $candidate was incompatible)."
      pg_packages=("${trial[@]}")
      return 0
    fi
  done < <(apt-cache "${pg_apt[@]}" madison postgresql-17-cron | awk '{print $3}')
  echo '::error::No compatible build of the requested upstream cron version; qualification cannot run.' >&2
  return 1
}

bash "$PG_UBUNTU_APT" setup

pg_sources="$(mktemp -d "$RUNNER_TEMP/ca-postgres-apt.XXXXXX")"
chmod 755 "$pg_sources"
test -f /etc/apt/sources.list.d/ubuntu.sources
cp /etc/apt/sources.list.d/ubuntu.sources "$pg_sources/ubuntu.sources"
pg_apt=(
  -o "Dir::Etc::sourcelist=/dev/null"
  -o "Dir::Etc::sourceparts=$pg_sources"
  -o "Acquire::Retries=5"
  -o "Acquire::http::Timeout=30"
  -o "Acquire::https::Timeout=30"
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
# THE SERVER MINOR IS THE ONE THE NATIVE TOOLS ARE BUILT FOR (2026-11-12).
# Every native qualification here is bound to exactly the VERSION named in
# scripts/ci/build_pg17_isolationtester.py: the isolation client it builds, the
# funded BBJ replay and the probe manifests that hash that builder. A floating
# "postgresql-17" followed PGDG to 17.12 and every accounting shard that builds
# the client failed with "packaged server: exactly PostgreSQL 17.11 required".
# The server, client and server-dev packages are installed at the newest signed
# PGDG build of that minor. Moving the minor is one reviewed change to the
# builder and what binds it, never a side effect of the index, and an index
# that no longer offers the minor fails here by name.
pg_minor_source="$GITHUB_WORKSPACE/scripts/ci/build_pg17_isolationtester.py"
pg_minor="${PG_SERVER_MINOR:-}"
if [ -z "$pg_minor" ] && [ -f "$pg_minor_source" ]; then
  pg_minor="$(sed -n "s/^VERSION = '\([0-9][0-9.]*\)'\$/\1/p" "$pg_minor_source")"
fi
[ -n "$pg_minor" ] || { echo "::error::No pinned PostgreSQL minor: $pg_minor_source names no VERSION and PG_SERVER_MINOR is unset." >&2; exit 1; }
# Membership is read from the array itself. Piping printf into a quiet grep under pipefail
# was a race: grep -q exits at its first match, printf can then take SIGPIPE
# writing the rest, the pipeline reports 141, and the client was silently left
# unpinned (seen on PR #12304's Client Unit Tests shard 6).
pg_wants_server=0
pg_has_client=0
for pg_package in "${pg_packages[@]}"; do
  case "$pg_package" in
    postgresql-17) pg_wants_server=1 ;;
    postgresql-client-17) pg_has_client=1 ;;
  esac
done
if [ "$pg_wants_server" = 1 ] && [ "$pg_has_client" = 0 ]; then
  pg_packages+=(postgresql-client-17)
fi
pg_pinned=()
for pg_package in "${pg_packages[@]}"; do
  case "$pg_package" in
    postgresql-17 | postgresql-client-17 | postgresql-server-dev-17)
      # Read the whole listing: leaving the pipe early makes apt-cache fail on
      # its next write (exit 100 under pipefail) whenever the index holds more
      # than a few builds. Only a PGDG build counts, never the distribution's.
      pg_build="$(apt-cache "${pg_apt[@]}" madison "$pg_package" |
        awk -v minor="$pg_minor" 'found == "" && index($3, minor "-") == 1 && $3 ~ /pgdg/ { found = $3 } END { if (found != "") print found }')"
      [ -n "$pg_build" ] || { echo "::error::The signed PGDG index offers no $pg_package build of PostgreSQL $pg_minor." >&2; exit 1; }
      pg_pinned+=("$pg_package=$pg_build")
      ;;
    *) pg_pinned+=("$pg_package") ;;
  esac
done
pg_packages=("${pg_pinned[@]}")
echo "PostgreSQL minor $pg_minor: ${pg_packages[*]}"
# PGDG can publish an extension rebuild before its required server release.
# The bounded same-upstream resolver above proves the complete tuple first.
pg_fixture_install_policy
pg_resolve_cron_build
pg_attempt sudo apt-get "${pg_apt[@]}" install -y --no-install-recommends "${pg_packages[@]}" ${pg_fixture_install_options[@]+"${pg_fixture_install_options[@]}"}
