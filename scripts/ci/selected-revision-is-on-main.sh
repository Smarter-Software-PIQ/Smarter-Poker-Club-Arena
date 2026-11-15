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
# NOTHING MAY STILL BE WRITING THIS REPOSITORY WHEN THE TRAP REMOVES IT
# (2026-11-15). After a fetch, git runs `git maintenance run --auto`, and since
# Git 2.47 (maintenance.autoDetach, default true) that runs DETACHED: the fetch
# returns while a background `git commit-graph write --split --reachable` is
# still creating files under .git/objects. The runner's git 2.56.1 does this on
# every call (measured: objects/maintenance.lock still held at cleanup in 20 of
# 20 runs), so `rm -rf` raced it and failed with "Directory not empty" AFTER the
# proof had passed, turning "Confirm The Hetzner Web Publish Reached Production"
# red (post-deploy-e2e runs 43555229653, 43667942070, 43678854398). A throwaway
# repository needs no maintenance: refuse it in this repository's config (every
# command below, including any promisor lazy fetch) and on the fetch itself,
# which no inherited config can turn back on. Pinned by
# tests/unit/selectedRevisionProofLeavesNoBackgroundWriter.test.ts.
git -C "$work" config maintenance.auto false
git -C "$work" config gc.auto 0
auth="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
# Commits only (tree:0): ancestry needs no trees or blobs, and nothing from the
# selected revision is ever checked out or executed here.
git -C "$work" -c "http.extraheader=$auth" fetch -q --no-tags --no-auto-maintenance --filter=tree:0 \
  "${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY" \
  '+refs/heads/main:refs/remotes/protected/main' "${shas[@]}"
for sha in "${shas[@]}"; do
  if ! git -C "$work" merge-base --is-ancestor "$sha" refs/remotes/protected/main; then
    echo "::error::Selected revision $sha is not on protected main; nothing from it runs."
    exit 1
  fi
  echo "Selected revision $sha is on protected main."
done
