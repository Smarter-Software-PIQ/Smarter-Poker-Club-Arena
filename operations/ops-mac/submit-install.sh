#!/bin/zsh
setopt nullglob
# usage: submit-install.sh PR MIGRATION_FILE [REQUIRED_VERSION] [OWNER]
# Queues an install for the shared install queue (com.smarter-poker.install-queue).
# Any agent may submit; the queue installs one migration at a time after the PR merges.
PR="$1"; F="$2"; REQ="$3"; OWNER="${4:-unknown}"
[[ "$PR" =~ '^[0-9]+$' ]] || { echo "bad PR"; exit 2; }
[[ "$F" =~ '^[0-9]{14}_[a-z0-9_]+\.sql$' ]] || { echo "bad migration file"; exit 2; }
[[ -z "$REQ" || "$REQ" =~ '^[0-9]{14}$' ]] || { echo "bad required version"; exit 2; }
[[ "$OWNER" =~ '^[A-Za-z0-9._-]{1,64}$' ]] || { echo "bad owner"; exit 2; }
Q=~/.smarter-poker/install-queue; J="$Q/pending/$(date -u +%Y%m%dT%H%M%S)-pr$PR.job"
existing=($Q/pending/*-pr$PR.job $Q/running/*-pr$PR.job); (( ${#existing} )) && { echo "already queued: PR $PR"; exit 0; }
printf 'PR=%s\nFILE=%s\nREQUIRE=%s\nOWNER=%s\n' "$PR" "$F" "$REQ" "$OWNER" > "$J.tmp" && mv "$J.tmp" "$J" && echo "queued $J"
