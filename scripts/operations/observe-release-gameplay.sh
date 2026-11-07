#!/usr/bin/env bash
# Independent evidence for a release already sealed by its original owner.
set -euo pipefail
[ "$#" = 2 ] || exit 2
receipt="$1"
output="$2"
deadline=$((SECONDS + 480))
jq -cn --slurpfile original "$receipt" '{runId:$original[0].runId,targetSha:$original[0].sha,status:"original thaw evidence unavailable"}' > "$output"
while ((SECONDS < deadline)); do
  if bash "$(dirname "$0")/release-gameplay-readback.sh" "$receipt" > "$output.next"; then
    mv "$output.next" "$output"
    if jq -e '.censusInObservationWindow == false' "$output" >/dev/null; then
      echo '::error::Durable timing observed after the live table observation window closed.'
      exit 1
    fi
    if jq -e '.secondsSinceThaw >= 120 and .censusInObservationWindow and (.tables|type=="array") and
      (any(.tables[]; .evidence=="advanced")) and
      (all(.tables[]; .evidence!="awaiting post-thaw hand")) and
      (all((.lightning // [])[]; .settled_at != null))' "$output" >/dev/null; then
      exit 0
    fi
  fi
  sleep 15
done
echo '::error::Original release did not produce complete gameplay evidence before the observation deadline.'
exit 1
