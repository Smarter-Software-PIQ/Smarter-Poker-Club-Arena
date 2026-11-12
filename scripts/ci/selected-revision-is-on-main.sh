#!/usr/bin/env bash
# A workflow_run listener matches its sender by name, and a head SHA it reads
# from that sender is attacker-shaped until proved. Before any job checks out,
# installs or runs code from a selected revision, this proves every non-empty
# revision given is a full commit SHA that is an ancestor of this repository's
# protected refs/heads/main (never a tag or another ref that is also named
# main). Run it from the trusted default-branch tree only: callers fetch it at
# $GITHUB_SHA through the contents API, never from the revision it checks.
#
# Usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/repo selected-revision-is-on-main.sh SHA [SHA...]
set -euo pipefail
: "${GITHUB_REPOSITORY:?}" "${GH_TOKEN:?}"
shas=()
for sha in "$@"; do
  [ -n "$sha" ] || continue
  if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::A selected revision is not one full lowercase commit SHA."
    exit 1
  fi
  shas+=("$sha")
done
if [ "${#shas[@]}" -eq 0 ]; then
  echo "::error::No selected revision was given to prove."
  exit 1
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git init -q "$work"
auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
# Commits only (tree:0): ancestry needs no trees or blobs, and nothing from the
# selected revision is ever checked out or executed here.
git -C "$work" -c "http.extraheader=$auth" fetch -q --no-tags --filter=tree:0 \
  "${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY" \
  '+refs/heads/main:refs/remotes/protected/main' "${shas[@]}"
for sha in "${shas[@]}"; do
  if ! git -C "$work" merge-base --is-ancestor "$sha" refs/remotes/protected/main; then
    echo "::error::Selected revision $sha is not on protected main; nothing from it runs."
    exit 1
  fi
  echo "Selected revision $sha is on protected main."
done
