#!/usr/bin/env bash
# ENGINE SOURCE IDENTITY (2026-11-07).
#
# Prints one sha256 that names exactly the bytes the Backup Engine image is
# built from at a commit. Two commits with the same identity build the same
# engine image (pinned base image digest, package-lock.json, no network input
# other than the lockfile's registry), so a certificate earned by one is
# earned by the other: backup-engine.yml's plan job inherits a
# backup-engine/certified = success status across identical identities
# instead of spending forty-five minutes of the one Backup host re-proving
# bytes it has already proved.
#
# THE INPUT LIST IS READ FROM THE DOCKERFILE AT THAT COMMIT, NOT WRITTEN HERE.
# standby-engine.sh builds with `git archive <sha> server` as the context and
# server/Dockerfile as the recipe, so the image can only ever contain
#   - server/Dockerfile itself, and
#   - every context path named as a source of a COPY instruction that does
#     not read from a builder stage (--from=).
# This script joins the Dockerfile's continuation lines, takes those sources,
# resolves each to its git object id (blob or tree) at the commit and hashes
# the manifest. A new COPY line widens the identity by itself; a path that is
# never copied (server/tests, server/standby, server/scripts except the seven
# copied build scripts, server/sim, server/qualification, docs) is not part of
# the engine and does not change it. Test files under server/src ARE in the
# identity: `COPY src/ ./src/` ships them and
# kernelRollbackQualification.ts hashes some of them at runtime.
#
# Deliberately excluded: the GIT_COMMIT_SHA build argument (a label and env
# value that differs on every commit by design and carries no behaviour) and
# server/standby/standby-engine.sh (the Backup host runs origin/main's copy at
# certification time, not the candidate's).
#
# THE SCRIPT IS PART OF ITS OWN ANSWER: the blob id of this file at the
# commit is the first manifest line, so a change to how identity is computed
# changes every identity and nothing inherits across it (CLAUDE.md 10.86).
#
# Usage: engine-source-identity.sh <40-hex sha> [--manifest]
#   prints the 64-hex identity on stdout (with --manifest, the manifest lines
#   first, then the identity). Exit 1 and nothing on stdout when the commit,
#   Dockerfile or this script cannot be read at that commit: an unreadable
#   identity is not an identity, and the caller certifies in full.
set -euo pipefail

SELF_PATH=scripts/ci/engine-source-identity.sh
DOCKERFILE=server/Dockerfile
CONTEXT=server

sha="${1:-}"
mode="${2:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "engine-source-identity: not a 40-hex sha: $sha" >&2; exit 1; }
git cat-file -e "$sha^{commit}" 2>/dev/null || { echo "engine-source-identity: unknown commit $sha" >&2; exit 1; }

object_id() {
  # The git object id of <sha>:<path>, or "absent" when the commit has no such
  # path (the Docker build would fail on it, and the identity still records
  # that it was asked for).
  git rev-parse -q --verify "$sha:$1" 2>/dev/null || echo absent
}

self_id=$(object_id "$SELF_PATH")
[ "$self_id" != absent ] || { echo "engine-source-identity: $SELF_PATH missing at $sha" >&2; exit 1; }
dockerfile=$(git show "$sha:$DOCKERFILE" 2>/dev/null) || { echo "engine-source-identity: $DOCKERFILE missing at $sha" >&2; exit 1; }

# Join backslash continuations, keep COPY instructions that read from the
# build context, drop flags (--chown, --chmod, --link), and emit every source
# (all words but the destination).
sources=$(printf '%s\n' "$dockerfile" \
  | sed -e ':a' -e '/\\$/N; s/\\\n//; ta' \
  | awk '
      toupper($1) == "COPY" {
        from = 0; n = 0; delete words
        for (i = 2; i <= NF; i++) {
          if ($i ~ /^--from=/) { from = 1; continue }
          if ($i ~ /^--/) continue
          words[++n] = $i
        }
        if (from || n < 2) next
        for (i = 1; i < n; i++) print words[i]
      }' \
  | sed -e 's#^\./##' -e 's#/*$##' \
  | sort -u)
[ -n "$sources" ] || { echo "engine-source-identity: no context COPY sources in $DOCKERFILE at $sha" >&2; exit 1; }

manifest=$(
  printf 'identity-script %s\n' "$self_id"
  printf 'dockerfile %s\n' "$(object_id "$DOCKERFILE")"
  while IFS= read -r src; do
    [ -n "$src" ] || continue
    printf 'copy %s %s\n' "$src" "$(object_id "$CONTEXT/$src")"
  done <<<"$sources"
)
identity=$(printf '%s\n' "$manifest" | sha256sum | cut -d' ' -f1)
[[ "$identity" =~ ^[0-9a-f]{64}$ ]] || exit 1
[ "$mode" = --manifest ] && printf '%s\n' "$manifest"
printf '%s\n' "$identity"
