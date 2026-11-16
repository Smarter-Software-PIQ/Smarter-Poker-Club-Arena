#!/bin/bash
# Capture steps for the declared window, each once. Census and Lightning run per 2-hour segment (reader limit), then merge.
# v3 (2026-11-15): rerunning the same command resumes; complete segments are kept, incomplete ones renamed and rerun once.
# usage: HVH_SHA=<40hex> run-capture-steps.sh OUT_DIR START_ISO END_ISO (any length; cut into segments of at most 2 hours by segments.py). Start with nohup; poll OUT_DIR/steps.log.
set -u; OUT=${1:?}; START=${2:?start ISO}; END=${3:?end ISO}; SHA=${HVH_SHA:?HVH_SHA required}; PTS=$(python3 "$(dirname "$0")/segments.py" "$START" "$END") || exit 2
TOOLS=$(cd "$(dirname "$0")" && pwd); MANIFEST=$TOOLS/manifest
# Defaults are documented in README.md: HVH_SUBJECT_CONFIG (private subject file, never committed), HVH_REPO (this repository), HVH_SUPABASE_LINK (linked clone).
SUBJ=${HVH_SUBJECT_CONFIG:-/Volumes/SmarterArchives/agent-evidence/extreme-archive/human-horse-handoff-audit-01a1cbbc/evidence/subject-config.json}; [ -f "$SUBJ" ] || { echo "refused: HVH_SUBJECT_CONFIG not found: $SUBJ"; exit 2; }
W=${HVH_REPO:-$(cd "$TOOLS/../../.." && pwd)}; LINK=${HVH_SUPABASE_LINK:-/Users/smarter.poker/Documents/club-arena}
mkdir -p "$OUT"; . "$(dirname "$0")/operator-lock.sh"; hvh_operator_lock "$OUT" || exit $?; cd "$MANIFEST"; set -- $PTS; FIRST=$1; segs=""; n=0
while [ $# -ge 2 ]; do a=$1; b=$2; shift; n=$((n+1))
  # v3 resume: a segment whose census is complete for exactly [a, b) and this source is kept; an incomplete one is renamed attempt<k>-incomplete-* and rerun once
  if [ -e $OUT/census-seg$n.json ]; then if python3 -c "import json,sys;d=json.load(open(sys.argv[1]));sys.exit(0 if d.get('complete') is True and d.get('startUtc')==sys.argv[2] and d.get('endUtc')==sys.argv[3] and d.get('sourceSha')==sys.argv[4] else 1)" $OUT/census-seg$n.json $a $b $SHA; then
      echo "step4 seg$n kept (complete) $(date -u +%FT%TZ)"; segs="$segs $OUT/census-seg$n.json"; LAST=$b; continue
    else k=0; while ls $OUT/attempt$k-incomplete-census-seg$n* >/dev/null 2>&1; do k=$((k+1)); done; for f in $OUT/census-seg$n.json $OUT/census-seg$n-hands.json $OUT/lightning-outcomes-seg$n.json; do [ -e $f ] && mv $f $OUT/attempt$k-incomplete-$(basename $f); done; echo "step4 seg$n incomplete kept as attempt$k; rerun"; fi; fi
  echo "step4 seg$n $a $b $(date -u +%FT%TZ)"; python3 run-postseal-window-census.py $W $LINK census-postseal-v6.sql.template "$SUBJ" $a $b $SHA $OUT/census-seg$n.json || { echo "STEP4 seg$n FAILED"; exit 4; }
  echo "step4a seg$n $(date -u +%FT%TZ)"; python3 run-postseal-lightning-outcomes.py $W $LINK lightning-outcomes-postseal-v5.sql.template $a $b $OUT/census-seg$n-hands.json $OUT/lightning-outcomes-seg$n.json || echo "STEP4A seg$n FAILED (Lightning UNVERIFIED for this segment; continuing)"
  segs="$segs $OUT/census-seg$n.json"; LAST=$b
done
echo "merge $(date -u +%FT%TZ)"; python3 $TOOLS/merge_census.py $FIRST $LAST $OUT/window-denominators-hands.json $OUT/window-denominators.json $segs || { echo "MERGE FAILED"; exit 43; }
echo "humankeys $(date -u +%FT%TZ)"; python3 $TOOLS/human_keys.py $W $LINK $OUT/window-denominators-hands.json $SHA $OUT/human-hand-keys.json || echo "HUMAN KEYS FAILED (witness claims UNVERIFIED; continuing)"
echo "step5 $(date -u +%FT%TZ)"; python3 run-postseal-selector.py $W $LINK coordinates-postseal-v4.sql.template "$SUBJ" $OUT/window-denominators-hands.json $OUT/selector.json || { echo "STEP5 FAILED"; exit 5; }
echo "step6-build $(date -u +%FT%TZ)"; python3 build-export-batches.py $OUT/selector.json export-originals.mjs $OUT/batches || { echo "STEP6 BUILD FAILED OR ZERO TARGETS"; exit 6; }
echo "done $(date -u +%FT%TZ)"
