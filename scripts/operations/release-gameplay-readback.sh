#!/usr/bin/env bash
# Read-only after-thaw evidence. PG service selection belongs to the operator.
set -euo pipefail
{ [ "$#" = 1 ] || [ "$#" = 3 ]; } || { echo 'usage: release-gameplay-readback.sh SEALED_RESULT [ANNOUNCED_AT BREAK_STARTED_AT]' >&2; exit 2; }
identity="$(jq -er 'select(.result == "sealed" and (.sha|test("^[a-f0-9]{40}$")) and (.runId|test("^[0-9]+-[0-9]+$")) and (.instanceId|type=="string" and length>0) and .completionRuntime.instanceId == .instanceId and (.startedAt|type=="string" and length>0)) | [.runId,.sha,.instanceId,.startedAt] | @tsv' "$1")"
IFS=$'\t' read -r run_id target instance container_started <<< "$identity"
exec psql -X -A -t -q --set=ON_ERROR_STOP=1 --set=run_id="$run_id" --set=target="$target" \
  --set=instance="$instance" --set=container_started="$container_started" --set=announced="${2:-}" --set=started="${3:-}" \
  --file="$(dirname "$0")/release-gameplay-readback.sql"
