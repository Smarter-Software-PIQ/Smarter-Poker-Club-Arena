#!/usr/bin/env bash
# Exercise infra/monitoring/spin-rules.yml against synthetic time series.
#
# aSpinAlertReadsTheLadderItWatches.law.test.ts proves the rules read gauges
# rather than literals - a static property of the YAML. This runs them: real
# series through promtool, asserting which alerts fire, which stay silent, and
# after how long, including the `for:` durations a static check cannot see.
# See the header of infra/monitoring/spin-rules.test.yml for what each
# scenario establishes, including two recorded silent-failure modes.
#
# promtool is pinned by version AND sha256. A mismatch aborts; this script
# never runs an unverified binary and never falls back to "skip".
set -euo pipefail

PROM_VERSION=3.16.0
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)  PLAT=linux-amd64;  WANT=68727009472a2c02e1ff7f062fd5b3e637285bffc8fc2d340c76fb449d6e0f34 ;;
  Darwin/arm64)  PLAT=darwin-arm64; WANT=f7c71b553316f822bdd860a3ea527ebefb2f8e944e5b7dfd419ae2653cf3ba01 ;;
  *) echo "test-spin-alert-rules: no pinned promtool for $(uname -s)/$(uname -m)." >&2; exit 1 ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE="${SPIN_PROMTOOL_CACHE:-$REPO/.cache/promtool-$PROM_VERSION-$PLAT}"
BIN="$CACHE/promtool"

if [ ! -x "$BIN" ]; then
  mkdir -p "$CACHE"
  TGZ="$CACHE/prometheus-$PROM_VERSION.$PLAT.tar.gz"
  URL="https://github.com/prometheus/prometheus/releases/download/v$PROM_VERSION/prometheus-$PROM_VERSION.$PLAT.tar.gz"
  echo "test-spin-alert-rules: fetching pinned promtool $PROM_VERSION ($PLAT)"
  curl -sSL --retry 3 --max-time 300 -o "$TGZ" "$URL"
  GOT=$(shasum -a 256 "$TGZ" 2>/dev/null | awk '{print $1}' || sha256sum "$TGZ" | awk '{print $1}')
  if [ "$GOT" != "$WANT" ]; then
    echo "test-spin-alert-rules: promtool checksum mismatch." >&2
    echo "  want $WANT" >&2
    echo "  got  $GOT" >&2
    rm -f "$TGZ"
    exit 1
  fi
  tar xzf "$TGZ" -C "$CACHE" --strip-components=1 "prometheus-$PROM_VERSION.$PLAT/promtool"
  rm -f "$TGZ"
fi

echo "test-spin-alert-rules: $("$BIN" --version 2>&1 | head -1)"
"$BIN" check rules "$REPO/infra/monitoring/spin-rules.yml"
"$BIN" test rules "$REPO/infra/monitoring/spin-rules.test.yml"
