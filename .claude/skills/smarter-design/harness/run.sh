#!/usr/bin/env bash
# Start (or restart) the harness server for this checkout on a port.
#   bash .claude/skills/smarter-design/harness/run.sh 5199
set -euo pipefail
PORT="${1:-5199}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
cd "$ROOT"
pkill -f "vite --config $HERE/vite.harness.mjs --port $PORT" 2>/dev/null || true
sleep 1
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=harness \
  nohup npx vite --config "$HERE/vite.harness.mjs" --port "$PORT" --force >"/tmp/smarter-design-harness-$PORT.log" 2>&1 &
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/hub/club-arena/" && break
  sleep 1
done
echo "harness on http://127.0.0.1:$PORT/hub/club-arena/ (log /tmp/smarter-design-harness-$PORT.log)"
