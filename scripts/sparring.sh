#!/usr/bin/env bash
# sparring.sh <tree> <opts.json> [options]  - offline PLO4/PLO5 sparring benchmark (benchmark only, never production).
#   <tree>      a checked-out Club Arena repo root whose engine plays the Horses (e.g. a candidate branch worktree)
#   <opts.json> candidate switch states {"option":"on",...} merged over the baseline; "-" = baseline only (no candidate arm)
# options (env):
#   BASE=<switch json>      baseline (live) switch states (default: opts-live.json next to this script, or $SPARRING_BASE_DEFAULT)
#   ADVERSARIES="profile:aggro_reg probe:pot_stab_turn_river ..."   (default: the full set below)
#   GAMES="plo5:2:100 plo5:6:100 plo5:2:200 plo4:2:100"            variant:seats:stackBB cells (default below)
#   PAIRS=<hands per cell>  (default 4000)   SEED=<seed> (default 20261120)   JOBS=<parallel processes> (default 4)
#   PROFILE=<json>          SparringProfile fields merged over aggro_reg (e.g. lane STYLE-STUDY's measured profile)
#   OUT=<dir>               results directory (default: $SPARRING_WORK/<timestamp>)
# Prints the matchup table: per adversary and game, the adversary's bb/100 against the BASE and CAND Horses, the paired
# CAND-BASE change (same deals) with its SE and verdict (WORSE = the adversary wins more), and the probe edges vs mirror.
# Hole cards are never printed or written; results are aggregates. PLO6 is refused.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$(cd "${1:?usage: sparring.sh <tree> <opts.json|->}" && pwd)"
CAND="${2:?usage: sparring.sh <tree> <opts.json|->}"
[ "$CAND" != "-" ] && CAND="$(cd "$(dirname "$CAND")" && pwd)/$(basename "$CAND")"
SRC="${SPARRING_SRC:-$HERE}"
[ -f "$SRC/SparringLeague.ts" ] || SRC="$(cd "$HERE/../server/src/benchmark" 2>/dev/null && pwd)"
BASE="${BASE:-${SPARRING_BASE_DEFAULT:-$HERE/opts-live.json}}"
[ -f "$BASE" ] || { echo "baseline switch states not found: $BASE (set BASE=)"; exit 2; }
ADVERSARIES="${ADVERSARIES:-profile:aggro_reg profile:aggro_passive_post probe:pot_stab_turn_river probe:raise_every_cbet probe:threebet_every_open probe:overfold_to_raises probe:station_turn_river probe:barrel_air probe:river_raise probe:check_raise probe:tell_d4 probe:tell}"
GAMES="${GAMES:-plo5:2:100 plo5:6:100 plo5:2:200}"
PAIRS="${PAIRS:-4000}"; SEED="${SEED:-20261120}"; JOBS="${JOBS:-4}"
WORK="${SPARRING_WORK:-$HERE/runs}"; OUT="${OUT:-$WORK/$(date +%Y%m%d-%H%M%S)-$$}"
mkdir -p "$OUT/overlay"; chmod 700 "$OUT"; umask 077
# Overlay: this harness's two files, with imports pointed at <tree>'s engine (so any tree can be sparred,
# including trees that predate the harness). Nothing is written into <tree>.
for f in SparringLeague.ts sparringRun.ts; do
  sed -E -e "s#from '\.\./#from '$TREE/server/src/#g" \
      -e "s#from '\./(HorseLeague|HorseLeagueHumanField|ExploiterLeague|OmahaReference)\.js'#from '$TREE/server/src/benchmark/\1.js'#g" \
      "$SRC/$f" > "$OUT/overlay/$f"
done
echo '{"type":"module"}' > "$OUT/overlay/package.json"
cp "$BASE" "$OUT/base.json"; [ "$CAND" != "-" ] && cp "$CAND" "$OUT/cand.json"
[ -n "${PROFILE:-}" ] && cp "$PROFILE" "$OUT/profile.json"
echo "tree $(git -C "$TREE" rev-parse --short=12 HEAD 2>/dev/null || echo '?')  cand ${CAND}  pairs/cell $PAIRS  seed $SEED  jobs $JOBS  out $OUT"
cells=()
for g in $GAMES; do
  case "$g" in plo6*) echo "PLO6 is out of scope: $g"; exit 2;; esac
  IFS=: read -r v s b <<<"$g"
  for a in $ADVERSARIES; do cells+=("$a:$v:$s:$b:$PAIRS:$SEED"); done
done
run_cell() {
  local cell="$1" OUT="$2" TREE="$3"; local tag; tag="$(echo "$cell" | tr ':' '_')"
  ( cd "$TREE/server" && env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" TZ=UTC EQUITY_GOVERNOR=off \
      SUPABASE_URL=https://supabase.invalid SUPABASE_SERVICE_ROLE_KEY=league-offline-placeholder \
      SPARRING_CELL="$cell" SPARRING_OUT="$OUT/results.jsonl" SPARRING_BASE="$OUT/base.json" \
      ${CANDF:+SPARRING_CAND="$CANDF"} ${PROFF:+SPARRING_PROFILE="$PROFF"} \
      nice -n 15 node --max-old-space-size=3000 --import tsx "$OUT/overlay/sparringRun.ts" ) > "$OUT/$tag.log" 2>&1 \
    && echo "done $cell" || echo "FAILED $cell (see $OUT/$tag.log)"
}
export -f run_cell
export CANDF="$([ "$CAND" != "-" ] && echo "$OUT/cand.json" || true)" PROFF="$([ -n "${PROFILE:-}" ] && echo "$OUT/profile.json" || true)"
printf '%s\n' "${cells[@]}" | xargs -P "$JOBS" -I{} bash -c 'run_cell "$@"' _ {} "$OUT" "$TREE"
( cd "$TREE/server" && env -i PATH="$PATH" HOME="$HOME" TZ=UTC SUPABASE_URL=https://supabase.invalid \
    SUPABASE_SERVICE_ROLE_KEY=league-offline-placeholder SPARRING_REPORT="$OUT/results.jsonl" \
    node --import tsx "$OUT/overlay/sparringRun.ts" ) | tee "$OUT/TABLE.md"
