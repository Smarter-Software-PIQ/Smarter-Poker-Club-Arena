#!/usr/bin/env bash
# THE ONE ENTRY POINT FOR UBUNTU PACKAGES IN CI (2026-11-19).
#
# On 2026-11-19 the Ubuntu mirror broke CI three ways in one day:
# archive.ubuntu.com stalled the native qualification Docker build, pinning
# azure.archive.ubuntu.com instead (#11384) failed on runners that cannot reach
# it, and the primary stalled Post-Deploy E2E's `playwright install --with-deps`
# for 20+ minutes. Mirror selection lived in fourteen workflows, the PostgreSQL
# installer and a private copy in the Dockerfile, each bounded differently or
# not at all. Every step that installs Ubuntu packages - apt directly,
# `playwright install --with-deps`, or .github/actions/install-postgres-17 -
# now comes through this file, so a fix reaches every install at once:
#
#   - a multi-host fallback mirror list, from ONE source file
#     (scripts/ci/ubuntu-apt-mirrors.txt), also used by the native image;
#   - bounded idle fetches with retries (an idle mirror fails over in 30 s);
#   - a time bound on every attempt, and a retry that starts on a different
#     mirror (the first-tried host is rotated to the back between attempts).
#
# Usage:
#   ubuntu-apt.sh setup                 select the mirror list and fetch bounds
#   ubuntu-apt.sh rotate                make the next host the first one tried
#   ubuntu-apt.sh install PKG...        setup, then apt-get update + install
#   ubuntu-apt.sh run CMD [ARG...]      setup, then CMD (e.g. npx playwright
#                                       install --with-deps chromium)
#
# Environment:
#   UBUNTU_APT_ATTEMPTS         attempts for install/run (default 3)
#   UBUNTU_APT_ATTEMPT_SECONDS  bound on each attempt (default 180; three
#                               attempts fit a ten-minute step bound)
#   UBUNTU_APT_IMAGE            1 inside a Docker build: no sudo, no Python;
#                               the image's sources read the shared list
#   UBUNTU_APT_ROOT             apt configuration root (default /etc/apt)
#   UBUNTU_APT_MIRRORS          mirror list (default: beside this file)
#   UBUNTU_APT_SUDO             command prefix for root (default: sudo unless
#                               already root)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${UBUNTU_APT_ROOT:-/etc/apt}"
mirrors="${UBUNTU_APT_MIRRORS:-$here/ubuntu-apt-mirrors.txt}"
attempts="${UBUNTU_APT_ATTEMPTS:-3}"
seconds="${UBUNTU_APT_ATTEMPT_SECONDS:-180}"
image="${UBUNTU_APT_IMAGE:-0}"
image_list="$root/ca-ubuntu-mirrors.txt"
if [ -n "${UBUNTU_APT_SUDO+set}" ]; then
  read -r -a sudo <<<"$UBUNTU_APT_SUDO"
elif [ "$(id -u)" = 0 ]; then
  sudo=()
else
  sudo=(sudo)
fi
[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || { echo "::error::UBUNTU_APT_ATTEMPTS must be a positive integer." >&2; exit 2; }
[[ "$seconds" =~ ^[1-9][0-9]*$ ]] || { echo "::error::UBUNTU_APT_ATTEMPT_SECONDS must be a positive integer." >&2; exit 2; }
[ -s "$mirrors" ] || { echo "::error::The shared Ubuntu mirror list $mirrors is missing." >&2; exit 2; }

as_root() { "${sudo[@]+"${sudo[@]}"}" "$@"; }

image_setup() {
  # The image has no Python: its Ubuntu sources are pointed at a mirrorlist
  # written from the shared file, weighted in file order.
  local entries
  entries="$(awk '{ sub(/#.*/, "") } NF { n++; printf "%s\tpriority:%d\n", $1, n }' "$mirrors")"
  [ "$(printf '%s\n' "$entries" | grep -c .)" -ge 2 ] || { echo "::error::$mirrors names fewer than two hosts." >&2; exit 2; }
  printf '%s\n' "$entries" > "$image_list"
  local source found=0
  for source in "$root/sources.list" "$root/sources.list.d/ubuntu.sources" "$root"/sources.list.d/*.list; do
    [ -f "$source" ] || continue
    # -i.suffix is the one in-place spelling GNU and BSD sed both accept.
    sed -E -i.ca-orig "s#https?://([a-z0-9-]+\.)*(archive|security)\.ubuntu\.com/ubuntu/?#mirror+file:/etc/apt/ca-ubuntu-mirrors.txt#g" "$source"
    rm -f "$source.ca-orig"
    ! grep -q 'mirror+file:/etc/apt/ca-ubuntu-mirrors.txt' "$source" || found=1
  done
  [ "$found" = 1 ] || { echo "::error::No Ubuntu source under $root reads the shared mirror list." >&2; exit 2; }
  mkdir -p "$root/apt.conf.d"
  printf 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\n' > "$root/apt.conf.d/80-ca-bounded-fetch"
  echo "Ubuntu mirror list (image): $(cut -f1 "$image_list" | paste -sd ' ' -)"
}

image_rotate() {
  [ -f "$image_list" ] || return 0
  local next
  next="$(awk -F '\t' 'NR > 1 { print $1 } NR == 1 { first = $1 } END { print first }' "$image_list" |
    awk '{ printf "%s\tpriority:%d\n", $1, NR }')"
  printf '%s\n' "$next" > "$image_list"
  echo "Ubuntu mirror rotated; now first: $(head -1 "$image_list" | cut -f1)"
}

setup() {
  if [ "$image" = 1 ]; then
    image_setup
  else
    as_root python3 "$here/ubuntu-apt-mirror.py" --root "$root" --mirrors "$mirrors"
  fi
}

rotate() {
  if [ "$image" = 1 ]; then
    image_rotate
  else
    as_root python3 "$here/ubuntu-apt-mirror.py" --root "$root" --rotate
  fi
}

# One bounded attempt per mirror; a failed or timed-out attempt finishes any
# interrupted package configuration and retries starting on the next host.
attempt() {
  local n=1 status
  while :; do
    status=0
    timeout --kill-after=15 "$seconds" "$@" || status=$?
    [ "$status" != 0 ] || return 0
    if [ "$status" = 124 ] || [ "$status" = 137 ]; then
      echo "::warning::attempt $n of $attempts exceeded ${seconds}s: $*" >&2
    else
      echo "::warning::attempt $n of $attempts failed ($status): $*" >&2
    fi
    if [ "$n" -ge "$attempts" ]; then
      echo "::error::Ubuntu package install failed after $n attempts on different mirrors: $*" >&2
      return 1
    fi
    rotate
    as_root dpkg --configure -a >/dev/null 2>&1 || true
    n=$((n + 1))
  done
}

command="${1:-}"
[ $# -eq 0 ] || shift
[ "${1:-}" != -- ] || shift
case "$command" in
  setup) setup ;;
  rotate) rotate ;;
  install)
    [ $# -gt 0 ] || { echo "::error::ubuntu-apt.sh install names no package." >&2; exit 2; }
    setup
    attempt "${sudo[@]+"${sudo[@]}"}" env DEBIAN_FRONTEND=noninteractive bash -c \
      'apt-get update && apt-get install -y --no-install-recommends "$@"' \
      ubuntu-apt-install "$@"
    ;;
  run)
    [ $# -gt 0 ] || { echo "::error::ubuntu-apt.sh run names no command." >&2; exit 2; }
    setup
    attempt "$@"
    ;;
  *)
    echo "usage: ubuntu-apt.sh setup | rotate | install PKG... | run CMD [ARG...]" >&2
    exit 2
    ;;
esac
