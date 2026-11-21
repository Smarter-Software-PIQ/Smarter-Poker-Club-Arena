#!/usr/bin/env bash
# sparring.sh <tree> <opts.json|-> - offline PLO4/PLO5 sparring benchmark (benchmark only, never production).
#   <tree>      a checked-out (or archived: server/src + server/package.json) Club Arena tree whose engine plays the Horses
#   <opts.json> candidate states merged over the baseline: {"option":"on",...} switch states, plus optional
#               {"decide":{...}} raw HorseDecideOpts for flags that are not switch options; "-" = baseline only
# Two modes:
#   same-tree (default): one deal stream, BASE arm (live set) and CAND arm (live set + opts) in <tree>; paired change.
#   cross-tree (BASE_TREE=<tree0>): a CODE change. Cells run in <tree0> with the live set and in <tree> with the live
#               set + opts, same seeds, per-hand nets kept, then paired hand by hand (scripts/sparring-compare.py).
# Env: BASE=<switch json> (default opts-live.json next to this script)  ADVERSARIES="profile:aggro_reg probe:..."
#   GAMES="plo5:2:100 plo5:6:100 plo5:2:200 plo4:2:100"  PAIRS (default 4000)  SEED (default 20261120)
#   JOBS (default 2; keep within the Mac's current worker rule)  PROFILE=<json>  OUT=<dir>
# Prints the matchup table: the adversary's bb/100 vs BASE and CAND, the paired CAND-BASE change ± SE and verdict
# (WORSE = the adversary wins more off the Horses), and each probe's edge vs the Horse mirror (> 2 SE = an exploit).
# Hole cards are never printed or written; results are aggregates. PLO6 is refused.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$(cd "${1:?usage: sparring.sh <tree> <opts.json|->}" && pwd)"
CAND="${2:?usage: sparring.sh <tree> <opts.json|->}"
[ "$CAND" != "-" ] && CAND="$(cd "$(dirname "$CAND")" && pwd)/$(basename "$CAND")"
SRC="${SPARRING_SRC:-$HERE}"
[ -f "$SRC/SparringLeague.ts" ] || SRC="$(cd "$HERE/../server/src/benchmark" 2>/dev/null && pwd)"
PY="$HERE/compare.py"; [ -f "$PY" ] || PY="$HERE/sparring-compare.py"
BASE="${BASE:-${SPARRING_BASE_DEFAULT:-$HERE/opts-live.json}}"
[ -f "$BASE" ] || { echo "baseline switch states not found: $BASE (set BASE=)"; exit 2; }
ADVERSARIES="${ADVERSARIES:-profile:aggro_reg profile:aggro_passive_post probe:pot_stab_turn_river probe:barrel_air probe:raise_every_cbet probe:threebet_every_open probe:overfold_to_raises probe:station_turn_river probe:river_raise probe:check_raise probe:tell_d4 probe:tell}"
GAMES="${GAMES:-plo5:2:100 plo5:6:100 plo5:2:200}"
PAIRS="${PAIRS:-4000}"; SEED="${SEED:-20261120}"; JOBS="${JOBS:-2}"
WORK="${SPARRING_WORK:-$HERE/runs}"; OUT="${OUT:-$WORK/$(date +%Y%m%d-%H%M%S)-$$}"
mkdir -p "$OUT"; chmod 700 "$OUT"; umask 077
overlay() { # $1 tree  $2 dir: this harness's files with imports pointed at the tree's engine; nothing written into the tree
  mkdir -p "$2"; echo '{"type":"module"}' > "$2/package.json"
  for f in SparringLeague.ts sparringRun.ts; do
    sed -E -e "s#from '\.\./#from '$1/server/src/#g" \
        -e "s#from '\./(HorseLeague|HorseLeagueHumanField|ExploiterLeague|OmahaReference)\.js'#from '$1/server/src/benchmark/\1.js'#g" \
        "$SRC/$f" > "$2/$f"
  done
}
cp "$BASE" "$OUT/base.json"
[ -n "${PROFILE:-}" ] && cp "$PROFILE" "$OUT/profile.json"
cells=()
for g in $GAMES; do
  case "$g" in plo6*) echo "PLO6 is out of scope: $g"; exit 2;; esac
  IFS=: read -r v s b <<<"$g"
  for a in $ADVERSARIES; do cells+=("$a:$v:$s:$b:$PAIRS:$SEED"); done
done
run_cell() { # cell out tree overlaydir basefile candfile(or empty) results perhand
  local cell="$1" OUTD="$2" T="$3" OV="$4" BF="$5" CF="$6" RES="$7" PH="$8"; local tag; tag="$(basename "$RES" .jsonl)_$(echo "$cell" | tr ':' '_')"
  ( cd "$T/server" && env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" TZ=UTC EQUITY_GOVERNOR=off \
      SUPABASE_URL=https://supabase.invalid SUPABASE_SERVICE_ROLE_KEY=league-offline-placeholder \
      SPARRING_CELL="$cell" SPARRING_OUT="$RES" SPARRING_BASE="$BF" SPARRING_PERHAND="$PH" \
      ${CF:+SPARRING_CAND="$CF"} ${PROFF:+SPARRING_PROFILE="$PROFF"} \
      nice -n 15 node --max-old-space-size=3000 --import tsx "$OV/sparringRun.ts" ) > "$OUTD/$tag.log" 2>&1 \
    && echo "done $cell ($(basename "$RES"))" || echo "FAILED $cell (see $OUTD/$tag.log)"
}
export -f run_cell
export PROFF="$([ -n "${PROFILE:-}" ] && echo "$OUT/profile.json" || true)"
head12() { git -C "$1" rev-parse --short=12 HEAD 2>/dev/null || cat "$1/SNAP_COMMIT" 2>/dev/null || echo '?'; }
if [ -n "${BASE_TREE:-}" ]; then
  BT="$(cd "$BASE_TREE" && pwd)"
  overlay "$BT" "$OUT/overlay-base"; overlay "$TREE" "$OUT/overlay-cand"
  python3 - "$OUT/base.json" "$CAND" "$OUT/cand-merged.json" <<'PY'
import json, sys
b = json.load(open(sys.argv[1])); c = json.load(open(sys.argv[2])) if sys.argv[2] != '-' else {}
d = c.pop('decide', None); b.update(c)
if d: b['decide'] = d
json.dump(b, open(sys.argv[3], 'w'))
PY
  echo "CROSS base tree $(head12 "$BT")  cand tree $(head12 "$TREE")  cand ${CAND}  pairs/cell $PAIRS  seed $SEED  jobs $JOBS  out $OUT"
  : > "$OUT/jobs.txt"
  for c in "${cells[@]}"; do echo "$c|$BT|$OUT/overlay-base|$OUT/base.json|$OUT/results-base.jsonl" >> "$OUT/jobs.txt"; echo "$c|$TREE|$OUT/overlay-cand|$OUT/cand-merged.json|$OUT/results-cand.jsonl" >> "$OUT/jobs.txt"; done
  # macOS xargs -I caps a replaced line at 255 bytes: pass line numbers, read the job inside
  seq 1 "$(wc -l < "$OUT/jobs.txt")" | xargs -P "$JOBS" -I{} bash -c 'IFS="|" read -r c t o b r <<<"$(sed -n "${1}p" "$2/jobs.txt")"; run_cell "$c" "$2" "$t" "$o" "$b" "" "$r" 1' _ {} "$OUT"
  python3 "$PY" "$OUT/results-base.jsonl" "$OUT/results-cand.jsonl" | tee "$OUT/TABLE.md"
else
  overlay "$TREE" "$OUT/overlay"
  CF=""; [ "$CAND" != "-" ] && { cp "$CAND" "$OUT/cand.json"; CF="$OUT/cand.json"; }
  echo "tree $(head12 "$TREE")  cand ${CAND}  pairs/cell $PAIRS  seed $SEED  jobs $JOBS  out $OUT"
  printf '%s\n' "${cells[@]}" | xargs -P "$JOBS" -I{} bash -c 'run_cell "$1" "$2" "$3" "$4" "$5" "$6" "$7" 0' _ {} "$OUT" "$TREE" "$OUT/overlay" "$OUT/base.json" "$CF" "$OUT/results.jsonl"
  ( cd "$TREE/server" && env -i PATH="$PATH" HOME="$HOME" TZ=UTC SUPABASE_URL=https://supabase.invalid \
      SUPABASE_SERVICE_ROLE_KEY=league-offline-placeholder SPARRING_REPORT="$OUT/results.jsonl" \
      node --import tsx "$OUT/overlay/sparringRun.ts" ) | tee "$OUT/TABLE.md"
fi
