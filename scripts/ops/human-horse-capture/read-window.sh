#!/bin/bash
# Full read of ONE closed declared window (repository toolkit version).
# usage: HVH_OPERATOR=<operator> read-window.sh SHA40 INSTANCE OBS_DIR START_ISO END_ISO [full|plo6_only]
# Enforces DECLARATION.json + DECLARATION.sha256 before reading. Each output written once (tools refuse existing outputs); rerun resumes the census. Read-only on production.
set -u; umask 077
SHA=${1:?sha40}; INST=${2:?instance}; OBS=${3:?obs_dir}; START=${4:?start_iso}; END=${5:?end_iso}; MODE=${6:-full}
T=$(cd "$(dirname "$0")" && pwd)
C="$OBS/capture"
[[ ${HVH_OPERATOR:-} =~ ^[A-Za-z0-9_.-]{1,80}$ ]] || { echo "refused: HVH_OPERATOR must be set ([A-Za-z0-9_.-]{1,80})"; exit 7; }
export HVH_SHA="$SHA" HVH_IMAGE="${HVH_IMAGE:-hvh-reader:${SHA:0:10}}"
R8=${SHA:0:8}; HR="/root/hvh-read-$R8"
mkdir -p "$C"
say(){ echo "$(date -u +%FT%TZ) $*" >> "$C/post.log"; }
cd "$T" || exit 2

# M3 / M13: verify DECLARATION.json + DECLARATION.sha256 before any read or scoring runs
python3 "$T/declaration_guard.py" verify "$OBS" "$SHA" > "$C/declaration-verified.json" 2>> "$C/post.log" || {
  say "DECLARATION GUARD REFUSED"
  echo "refused: declaration_guard failed for $OBS (see $C/post.log)" >&2
  exit 6
}

waithost(){ # $1 capture dir, $2 host dir; at most 3 h
  local e=$(( $(date +%s) + 10800 ))
  until bash "$T/run-originals-host.sh" status "$1" "$2" 2>/dev/null | grep -q originals-done; do
    if bash "$T/run-originals-host.sh" status "$1" "$2" 2>/dev/null | grep -q 'ABORT '; then
      say "HOST RUNNER ABORTED $2"
      return 1
    fi
    [ "$(date +%s)" -gt "$e" ] && { say "HOST WAIT TIMEOUT $2"; return 1; }
    sleep "${HVH_POLL_SEC:-30}"
  done
  bash "$T/run-originals-host.sh" collect "$1" "$2" >> "$1/collect.out" 2>&1
}

if [ "$MODE" = full ]; then
  say "census start $START $END"
  bash "$T/run-capture-steps.sh" "$C" "$START" "$END" >> "$C/steps.log" 2>&1
  grep -q '^done ' "$C/steps.log" || { say "CENSUS NOT DONE; stop"; exit 2; }
  [ -e "$C/build-boundaries.json" ] || python3 "$T/post_capture.py" build_boundaries "$START" "$END" "$C/build-boundaries.json" >> "$C/db-reads.log" 2>&1 || say "BUILD BOUNDARIES FAILED"
  [ -e "$C/gap-targets.json" ] || python3 "$T/post_capture.py" gap_targets "$START" "$END" "$C/gap-targets.json" >> "$C/db-reads.log" 2>&1 || say "GAP TARGETS FAILED"
  [ -e "$C/batches-build.out" ] || python3 "$T/post_capture.py" batches "$C" > "$C/batches-build.out" 2>&1 || say "BATCHES FAILED"
  bash "$T/run-originals-host.sh" start "$C" "$HR" >> "$C/host-start.out" 2>&1
  say "host originals: $(tail -1 "$C/host-start.out")"
  [ -e "$C/rule-fires-window.json" ] || python3 "$T/post_capture.py" fires "$START" "$END" "$C/rule-fires-window.json" >> "$C/db-reads.log" 2>&1 || say "FIRES FAILED"
  [ -e "$C/cohort.json" ] || python3 "$T/post_capture.py" cohort "$START" "$END" "$C/cohort.json" >> "$C/db-reads.log" 2>&1 || say "COHORT FAILED"
  grep -q 'nothing to run' "$C/host-start.out" || waithost "$C" "$HR" || exit 3
  WIT="$OBS/witness-rows.jsonl"
  if ls "$C"/originals-witness-*.jsonl >/dev/null 2>&1; then
    [ -e "$WIT" ] || { cat "$C"/originals-witness-*.jsonl > "$WIT"; chmod 400 "$WIT"; }
    [ -e "$C/reconcile-human-set.json" ] || python3 "$T/reconcile.py" "$C" > "$C/reconcile-human-set.json" 2>&1 || say "RECONCILE FAILED"
    [ -e "$OBS/tight-maniac-priors.json" ] || python3 "$T/post_capture.py" priors "$WIT" "$OBS/tight-maniac-priors.json" >> "$C/db-reads.log" 2>&1 || say "PRIORS FAILED"
    [ -e "$OBS/tight-maniac-faced-origins.json" ] || python3 "$T/post_capture.py" origins "$WIT" "$OBS/tight-maniac-faced-origins.json" >> "$C/db-reads.log" 2>&1 || say "ORIGINS FAILED"
    [ -e "$OBS/tight-maniac/witnesses.jsonl" ] || python3 "$T/build_packet.py" "$WIT" "$OBS/tight-maniac-priors.json" "$OBS/tight-maniac" "$INST" "$OBS/tight-maniac-faced-origins.json" > "$C/packet-summary.out" 2> "$C/packet.err" || say "PACKET FAILED"
    [ -e "$OBS/near-tight-report.json" ] || python3 "$T/near_tight.py" "$OBS" "$OBS/near-tight-report.json" > "$C/near-tight.out" 2>&1 || say "NEAR-TIGHT FAILED"
  else
    say "no witness originals (0 human hands with keys)"
  fi
  R=$(ls "$C"/rollup-rows-*.jsonl 2>/dev/null | tr '\n' ',' | sed 's/,$//')
  [ -n "$R" ] && [ ! -e "$OBS/per-horse-feature-rollup.json" ] && { python3 "$T/rollup_aggregate.py" "$R" "$C/cohort.json" "$OBS/per-horse-feature-rollup.json" > "$C/rollup.out" 2>&1 || say "ROLLUP FAILED"; }
  if [ -e "$OBS/tight-maniac/witnesses.jsonl" ] && [ ! -e "$OBS/report-numbers.json" ]; then
    python3 "$T/analyze.py" "$OBS" > "$C/analyze.out" 2>&1 || say "ANALYZE FAILED"
  fi
  say "main read done"
fi

# PLO6 two-set support read: every six-card cash hand of the window, Horse-only included
SP=support-plo6; HP="/root/hvh-read-$R8-plo6"
[ "$MODE" = full ] && [ -e "$OBS/support-plo6/plo6-maniac-price.json" ] && { SP=support-plo6-full; HP="/root/hvh-read-$R8-plo6full"; }
P="$OBS/$SP/capture"; mkdir -p "$P"
[ -e "$P/hand-keys.json" ] || python3 "$T/post_capture.py" keys_variant "$START" "$END" plo6 "$P/hand-keys.json" > "$P/keys.out" 2>&1 || say "PLO6 KEYS FAILED"
python3 - "$P" "$T" <<'PY' >> "$C/post.log" 2>&1
import json, sys, subprocess
from pathlib import Path
P = Path(sys.argv[1]); T = Path(sys.argv[2])
d = json.loads((P / 'hand-keys.json').read_text()); H = d['hands']; n = 0
for i in range(0, len(H), 1000):
    n += 1; kp = P / ('hand-keys-part%d.json' % n); bp = P / ('witness-batch-%d.mjs' % n)
    if bp.exists(): continue
    kp.write_text(json.dumps(dict(d, hands=H[i:i + 1000])))
    subprocess.run([sys.executable, str(T / 'post_capture.py'), 'keys_batch', str(kp), str(bp)], check=True)
print('plo6 keys', len(H), 'batches', n, 'failedSegments', d.get('failedSegments'))
PY
if ls "$P"/witness-batch-*.mjs >/dev/null 2>&1; then
  bash "$T/run-originals-host.sh" start "$P" "$HP" >> "$P/host-start.out" 2>&1
  grep -q 'nothing to run' "$P/host-start.out" || waithost "$P" "$HP" || exit 4
  [ -e "$OBS/$SP/witness-rows.jsonl" ] || { cat "$P"/originals-witness-*.jsonl > "$OBS/$SP/witness-rows.jsonl"; chmod 400 "$OBS/$SP/witness-rows.jsonl"; }
  [ -e "$OBS/$SP/plo6-maniac-price.json" ] || python3 "$T/plo6_maniac_price.py" "$OBS/$SP/witness-rows.jsonl" "$INST" "$OBS/$SP/plo6-maniac-price.json" > "$P/plo6.out" 2>&1 || say "PLO6 TOOL FAILED"
  [ -e "$P/plo6.out" ] && say "plo6: $(cut -c1-600 "$P/plo6.out")"
else
  say "plo6: no six-card cash hands in the window (none)"
fi
say "ALL DONE"
