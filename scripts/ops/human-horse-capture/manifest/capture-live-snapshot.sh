#!/bin/bash
# One public read of /health and /metrics into a NEW private directory. usage: capture-live-snapshot.sh OUT_DIR
set -u; out="$1"; [ ! -e "$out" ] || { echo "refused: exists" >&2; exit 2; }
umask 077; mkdir -p "$out"; t=$(date -u +%FT%TZ)
curl -fsS -m 20 "https://engine.smarter.poker/health?nocache=$(date +%s)" -o "$out/health.json"; h=$?
curl -fsS -m 20 "https://engine.smarter.poker/metrics" -o "$out/metrics.prom"; m=$?
printf '{"capturedAtUtc":"%s","healthExit":%s,"metricsExit":%s}\n' "$t" "$h" "$m" > "$out/capture.json"
shasum -a 256 "$out"/* ; exit $((h+m))
