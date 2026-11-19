#!/usr/bin/env bash
# PLAYWRIGHT BROWSERS AND THEIR UBUNTU PACKAGES COME FROM MAIN (2026-11-19).
#
# Every CSS Beat shard (about 21 per pull request) used to download Chromium
# and WebKit and about 125 MB of Ubuntu packages from scratch. That was 38 to
# 82 s on a good day; on PR #11255 four shards took 838 to 1199 s and on
# PR #11262 one took 1383 s ("Fetched 125 MB in 19min 58s (104 kB/s)" from a
# stalled Ubuntu mirror), and that one shard set the whole pull request's
# finish time.
#
# A scheduled run on main (job playwright_browser_cache in ci.yml) installs
# the browsers once a week through the shared Ubuntu entry point and saves
# ~/.cache/ms-playwright plus the .deb files apt fetched. Pull request jobs
# only RESTORE that entry (never save, so 21 shards never write 21 copies into
# a cache that is already at its size limit), seed the packages into apt's
# archive, and then run the unchanged install line: Playwright finds its
# browsers present and skips the download, and apt finds its packages
# already fetched and verifies them against the signed index instead of
# pulling them from a mirror. A miss, a stale package or a newer Playwright
# changes nothing about correctness: apt and Playwright fetch only what is
# missing, exactly as before.
#
# Usage:
#   playwright-browser-cache.sh key       print key= and prefix= for $GITHUB_OUTPUT
#   playwright-browser-cache.sh seed      copy cached .deb files into apt's archive
#   playwright-browser-cache.sh harvest   copy apt's fetched .deb files into the cache
set -euo pipefail

debs="${CA_BROWSER_DEBS:-$HOME/.cache/ca-browser-debs}"
archives="${CA_APT_ARCHIVES:-/var/cache/apt/archives}"
if [ -n "${CA_APT_SUDO+set}" ]; then
  read -r -a sudo <<<"$CA_APT_SUDO"
elif [ "$(id -u)" = 0 ]; then
  sudo=()
else
  sudo=(sudo)
fi
shopt -s nullglob

case "${1:-}" in
  key)
    # The browsers are fixed by the locked Playwright release and the runner's
    # OS image; the week rolls the Ubuntu packages forward with the archive.
    # The version comes from package-lock.json, the file every job's
    # node_modules is installed from, so the key needs no installed tree.
    version="$(node -p "require('./package-lock.json').packages['node_modules/playwright-core'].version")"
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || { echo "::error::package-lock.json locks no playwright-core version." >&2; exit 1; }
    image="${ImageOS:-}"
    if [ -z "$image" ] && [ -r /etc/os-release ]; then
      image="$(. /etc/os-release && echo "${ID}${VERSION_ID}")"
    fi
    prefix="pw-browsers-v1-${image:-unknown}-$(uname -m)-${version}-"
    echo "prefix=$prefix"
    echo "key=${prefix}$(date -u +%G-W%V)"
    ;;
  seed)
    files=("$debs"/*.deb)
    if [ "${#files[@]}" = 0 ]; then
      echo "No cached Ubuntu packages; apt fetches them from the mirror."
      exit 0
    fi
    "${sudo[@]+"${sudo[@]}"}" mkdir -p "$archives"
    "${sudo[@]+"${sudo[@]}"}" cp -n -- "${files[@]}" "$archives"/
    echo "Seeded ${#files[@]} cached Ubuntu packages into $archives."
    ;;
  harvest)
    files=("$archives"/*.deb)
    mkdir -p "$debs"
    rm -f -- "$debs"/*.deb
    if [ "${#files[@]}" = 0 ]; then
      echo "::warning::apt kept no fetched packages in $archives; only the browsers are cached."
      exit 0
    fi
    cp -- "${files[@]}" "$debs"/
    echo "Cached ${#files[@]} Ubuntu packages ($(du -sh "$debs" | cut -f1))."
    ;;
  *)
    echo "usage: $0 key|seed|harvest" >&2
    exit 2
    ;;
esac
