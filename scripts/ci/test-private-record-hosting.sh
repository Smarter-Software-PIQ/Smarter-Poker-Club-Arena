#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
parent="${RUNNER_TEMP:-${PRIVATE_RECORD_HOSTING_WORK:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'An owned scratch parent is required' >&2; exit 1; }
work="$(mktemp -d "$parent/private-record-tools.XXXXXX")"
trap 'rm -rf "$work"' EXIT
if [ -z "${CADDY_BIN:-}" ]; then
  [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo 'Set CADDY_BIN to a verified local binary' >&2; exit 1; }
  archive=caddy_2.11.7_linux_amd64.tar.gz
  # Hosted runners must use their scoped token, not the shared anonymous API quota.
  if [ "${GITHUB_ACTIONS:-}" = true ] && [ -z "${GH_TOKEN:-}" ]; then
    echo 'GH_TOKEN is required for the hosted Caddy fixture download' >&2
    exit 1
  fi
  caddy_auth=()
  if [ -n "${GH_TOKEN:-}" ]; then
    caddy_auth=(-H "Authorization: Bearer $GH_TOKEN")
  fi
  # Immutable upstream release asset for Caddy v2.11.7, linux/amd64.
  curl --fail --silent --show-error --location --max-time 120 "${caddy_auth[@]}" -H 'Accept: application/octet-stream' \
    'https://api.github.com/repos/caddyserver/caddy/releases/assets/607245028' -o "$work/$archive"
  printf '%s  %s\n' 'a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7' "$work/$archive" | sha512sum -c -
  tar -xzf "$work/$archive" -C "$work" caddy
  export CADDY_BIN="$work/caddy"
fi
export PRIVATE_RECORD_HOSTING_WORK="$parent"
if [ "$(uname -s)" = Linux ]; then
  # Production units require /usr/bin/node; setup-node uses the hosted toolcache.
  # Supply that fixture only on the ephemeral Actions runner, never on a local host.
  assert_node_version() {
    [ -x "$1" ] || { echo 'The fixed unit Node path must be executable' >&2; exit 1; }
    "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (!(major > 20 || (major === 20 && minor >= 19))) process.exit(1);'
  }
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    runner_node="$(command -v node)"
    [[ "$runner_node" = /* ]] || { echo 'Actions Node must resolve to an absolute executable' >&2; exit 1; }
    assert_node_version "$runner_node"
    if [ ! -e /usr/bin/node ] && [ ! -L /usr/bin/node ]; then
      sudo ln -s -- "$runner_node" /usr/bin/node
    fi
    assert_node_version /usr/bin/node
  fi
  systemd-analyze verify "$repo/infra/ca-origin/ca-private-record-gateway@.service" "$repo/infra/ca-origin/ca-private-record-gateway-boot.service"
fi
bash "$repo/scripts/ci/test-private-record-credentials-postgres.sh"
bash "$repo/scripts/ci/test-private-record-gateway-access-postgres.sh"
python3 -B "$repo/scripts/ci/test-unused-pg-net-removal.py" --scratch "$parent"
bash "$repo/scripts/ci/test-private-record-bootstrap-linux.sh"
node --test "$repo/scripts/ci/private-record-compatibility.test.mjs" "$repo/scripts/ci/private-record-gateway-bootstrap.test.mjs" "$repo/scripts/ci/private-record-gateway-credentials.test.mjs" "$repo/scripts/ci/private-record-gateway-inspect.test.mjs" "$repo/scripts/ci/private-record-gateway-live.test.mjs"
"$CADDY_BIN" adapt --config "$repo/infra/ca-origin/Caddyfile" --adapter caddyfile > "$work/caddy.json"
"$repo/server/node_modules/.bin/tsx" "$repo/server/scripts/privateRecordGatewayCaddy.mts"
MEMBER_RECORD_PG_PARENT="$parent" bash "$repo/scripts/dev/test-member-record-live-postgres.sh"
