#!/bin/bash
# Host-side originals (toolkit v2/v4, 2026-11-14..2026-11-20). Why: the ssh-bound reads of run-originals.sh receive no bytes until a batch ends, so a long batch
# loses its idle connection and its output (06d45e7d: witness attempt1, roll-up attempt0). Here every read runs detached ON ca-engine and survives the Mac, the connector and the network.
# usage: HVH_SHA=<40hex> HVH_IMAGE=<image> run-originals-host.sh start   CAPTURE_DIR HOST_DIR   (copies batches, starts ONE sequential runner, returns at once)
#        run-originals-host.sh collect CAPTURE_DIR HOST_DIR   (copies finished outputs back, verifies sha256 against the host, chmod 400; never overwrites)
#        run-originals-host.sh status  CAPTURE_DIR HOST_DIR
# Same container limits as run-originals.sh plus host hygiene: nice -n 19 ionice -c3, pre-batch MemAvailable >= 2 GiB & maintenance=false check, 1 CPU, 1 GB, no network, read-only journal mount, one attempt per batch.
# Outputs: originals-witness-N.jsonl, originals-N.jsonl, rollup-rows-N.jsonl, originals-raw-N.jsonl.gz.
set -u; MODE=${1:?mode}; C=${2:?capture dir}; H=${3:?host dir}; umask 077; . "$(dirname "$0")/operator-lock.sh"; [ "$MODE" = status ] || hvh_operator_lock "$C" || exit $?; SSH="${HVH_SSH_CMD:-ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 ca-engine}"; JDIR=${HVH_JOURNAL_DIR:-/var/lib/club-arena/horse-decisions}
MIN_FREE_KB=${HVH_MIN_FREE_KB:-2097152}
HEALTH_URL=${HVH_HOST_HEALTH_URL:-http://127.0.0.1:8080/health}
SKIP_HEALTH=${HVH_SKIP_HOST_HEALTH:-0}
case "$H" in /root/hvh-*|/var/lib/club-arena/hvh-*) ;; *) echo "refused: host dir must be an hvh- work folder"; exit 2;; esac
jobs(){ for b in "$C"/witness-batch-*.mjs; do [ -e "$b" ] && echo "$(basename "$b") originals-witness-$(basename "$b" .mjs | sed 's/witness-batch-//').jsonl 1300 plain"; done
        for n in 1 2; do [ -e "$C/batches/export-batch-$n.mjs" ] && echo "export-batch-$n.mjs originals-$n.jsonl 120 plain"; done
        for b in "$C"/rollup-batch-*.mjs; do [ -e "$b" ] && echo "$(basename "$b") rollup-rows-$(basename "$b" .mjs | sed 's/rollup-batch-//').jsonl 1300 plain"; done
        for b in "$C"/raw-batch-*.mjs; do [ -e "$b" ] && echo "$(basename "$b") originals-raw-$(basename "$b" .mjs | sed 's/raw-batch-//').jsonl.gz 1100 gzip"; done; }
if [ "$MODE" = start ]; then SHA=${HVH_SHA:?}; IMG=${HVH_IMAGE:?}; [[ $SHA =~ ^[0-9a-f]{40}$ ]] && [[ $IMG =~ ^hvh-reader:[0-9a-f]{10}$ ]] && [[ ${HVH_OPERATOR:-} =~ ^[A-Za-z0-9_.-]{1,80}$ ]] || { echo "refused: HVH_OPERATOR must be [A-Za-z0-9_.-] (at most 80), HVH_SHA must be 40 hex and HVH_IMAGE hvh-reader:<10 hex>"; exit 2; }
  $SSH "sudo mkdir -p $H && sudo chmod 700 $H && { sudo mkdir $H/.operation.lock 2>/dev/null && echo $HVH_OPERATOR | sudo tee $H/.operation.lock/OPERATOR >/dev/null || sudo grep -qx $HVH_OPERATOR $H/.operation.lock/OPERATOR; } && sudo test ! -e $H/runner.sh" || { echo "refused: $H/runner.sh exists (already started)"; exit 9; }
  jobs | while read in out t fmt; do [ -e "$C/$out" ] && continue; src="$C/$in"; [ -e "$src" ] || src="$C/batches/$in"
    $SSH "sudo tee $H/$in >/dev/null" < "$src" || exit 3; [ "$($SSH "sudo sha256sum $H/$in" < /dev/null | cut -c1-64)" = "$(shasum -a 256 "$src" | cut -c1-64)" ] || { echo "copy mismatch $in"; exit 3; }; echo "$in $out $t $fmt"; done > "$C/host-jobs.txt" || exit 3
  [ -s "$C/host-jobs.txt" ] || { echo "nothing to run"; exit 0; }
  { echo '#!/bin/bash'; echo "cd $H; umask 077"
    echo "check_host(){ local avail; avail=\$(awk '/^MemAvailable:/{print \$2}' /proc/meminfo 2>/dev/null || echo 99999999); if [ \"\${avail:-0}\" -lt $MIN_FREE_KB ]; then echo \"\$(date -u +%FT%TZ) ABORT low MemAvailable=\${avail}kB (<$MIN_FREE_KB)\" >> runner.log; return 1; fi"
    echo "  if [ \"$SKIP_HEALTH\" != \"1\" ]; then local hj; hj=\$(curl -fsS --max-time 4 '$HEALTH_URL' 2>/dev/null || true); if echo \"\$hj\" | grep -Eq '\"maintenance\"[[:space:]]*:[[:space:]]*\\{[^}]*\"active\"[[:space:]]*:[[:space:]]*true'; then echo \"\$(date -u +%FT%TZ) ABORT maintenance active\" >> runner.log; return 1; fi; fi; return 0; }"
    echo 'IONICE=""; command -v ionice >/dev/null 2>&1 && IONICE="ionice -c3"'
    echo 'while read in out t fmt; do [ -e "$out" ] || [ -e "$out.partial" ] && { echo "$(date -u +%FT%TZ) refused $out exists" >> runner.log; continue; }'
    echo '  check_host || break'
    echo '  echo "$(date -u +%FT%TZ) start $out" >> runner.log'
    echo '  if [ "${fmt:-plain}" = "gzip" ]; then'
    echo "    timeout \$t nice -n 19 \$IONICE docker run --rm -i --network none --read-only --cpus 1 --memory 1g --tmpfs /tmp:size=16m -e HORSE_DECISION_JOURNAL_DIR=/j -e GIT_COMMIT_SHA=$SHA -v $JDIR:/j:ro --entrypoint node $IMG --max-old-space-size=768 --input-type=module - < \$in 2> \$out.err | grep '^{' | gzip -c > \$out.partial; rc=\${PIPESTATUS[0]}"
    echo '  else'
    echo "    timeout \$t nice -n 19 \$IONICE docker run --rm -i --network none --read-only --cpus 1 --memory 1g --tmpfs /tmp:size=16m -e HORSE_DECISION_JOURNAL_DIR=/j -e GIT_COMMIT_SHA=$SHA -v $JDIR:/j:ro --entrypoint node $IMG --max-old-space-size=768 --input-type=module - < \$in 2> \$out.err | grep '^{' > \$out.partial; rc=\${PIPESTATUS[0]}"
    echo '  fi'
    echo '  echo "$(date -u +%FT%TZ) $out exit=$rc bytes=$(wc -c < $out.partial)" >> runner.log; [ $rc -eq 0 ] && mv $out.partial $out && sha256sum $out | cut -c1-64 > $out.sha256'
    echo 'done < jobs.txt; echo "$(date -u +%FT%TZ) originals-done" >> runner.log'; } > "$C/host-runner.sh"
  $SSH "sudo tee $H/jobs.txt >/dev/null" < "$C/host-jobs.txt" && $SSH "sudo tee $H/runner.sh >/dev/null" < "$C/host-runner.sh" && $SSH "sudo sh -c 'nohup setsid bash $H/runner.sh >/dev/null 2>&1 </dev/null &'" && echo "started on ${HVH_ENGINE_HOST:-ca-engine}:$H ($(wc -l < "$C/host-jobs.txt" | tr -d ' ') batches)"
elif [ "$MODE" = status ]; then $SSH "sudo cat $H/runner.log $H/rollup.log 2>/dev/null | tail -12"
elif [ "$MODE" = collect ]; then n=0
  for out in $($SSH "sudo sh -c 'cd $H && ls *.jsonl *.jsonl.gz 2>/dev/null'"); do case "$out" in originals-*.jsonl|rollup-rows-*.jsonl|originals-raw-*.jsonl.gz) ;; *) continue;; esac; [ -e "$C/$out" ] && continue
    hs=$($SSH "sudo sha256sum $H/$out" | cut -c1-64); $SSH "sudo cat $H/$out" > "$C/$out.partial" || { echo "copy failed $out"; continue; }
    if [ "$(shasum -a 256 "$C/$out.partial" | cut -c1-64)" = "$hs" ] && [ -n "$hs" ]; then mv "$C/$out.partial" "$C/$out"; chmod 400 "$C/$out"; echo $hs > "$C/$out.sha256"; $SSH "sudo cat $H/$out.err 2>/dev/null || sudo cat $H/$(echo $out | sed 's/rows-//; s/.jsonl.gz/.err/; s/.jsonl/.err/') 2>/dev/null" > "$C/$out.err"
      echo "$(date -u +%FT%TZ) $out collected from ca-engine:$H bytes=$(wc -c < "$C/$out" | tr -d ' ') sha=$hs (host-side read; sha verified against the host file)" | tee -a "$C/originals.log"; n=$((n+1))
    else echo "sha mismatch $out (kept .partial)"; fi; done; echo "collected $n"
else echo "unknown mode"; exit 2; fi
