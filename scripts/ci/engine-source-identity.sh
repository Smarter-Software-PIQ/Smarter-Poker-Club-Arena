#!/usr/bin/env bash
# ENGINE SOURCE IDENTITY (2026-11-07; .dockerignore filtering 2026-11-21).
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
# THE INPUT LIST IS READ FROM THE DOCKERFILE AND .DOCKERIGNORE AT THAT COMMIT,
# NOT WRITTEN HERE. standby-engine.sh and build-engine-image.sh build with
# `git archive <sha> server` as the context and server/Dockerfile as the
# recipe, filtered by server/.dockerignore, so the image can only ever contain
#   - server/Dockerfile itself,
#   - server/.dockerignore itself (when present), and
#   - every non-ignored file under a context path named as a source of a COPY
#     instruction that does not read from a builder stage (--from=).
# This script joins the Dockerfile's continuation lines, takes those sources,
# applies server/.dockerignore from that commit using positive Docker glob
# semantics (failing closed on unsupported syntax such as `!` negation or
# bracket character classes), resolves every non-ignored entry to its git
# object id via `git ls-tree` (zero lazy blob fetches in blobless checkouts),
# and hashes the manifest. A new COPY line or a .dockerignore change widens or
# alters the identity by itself; non-runtime test, test-support, testing
# helper, and verified benchmark-only files excluded by server/.dockerignore
# never enter the Docker build context and never change the identity.
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
#   Dockerfile, .dockerignore or this script cannot be read at that commit: an
#   unreadable identity is not an identity, and the caller certifies in full.
set -euo pipefail

SELF_PATH=scripts/ci/engine-source-identity.sh
DOCKERFILE=server/Dockerfile
DOCKERIGNORE=server/.dockerignore
CONTEXT=server

sha="${1:-}"
mode="${2:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "engine-source-identity: not a 40-hex sha: $sha" >&2; exit 1; }
if [ -n "$mode" ] && [ "$mode" != "--manifest" ]; then
  echo "engine-source-identity: unknown flag: $mode" >&2
  exit 1
fi
git cat-file -e "$sha^{commit}" 2>/dev/null || { echo "engine-source-identity: unknown commit $sha" >&2; exit 1; }

object_id() {
  # The git object id of <sha>:<path>, or "absent" when the commit has no such
  # path (reads tree objects only; never triggers lazy blob fetches).
  git rev-parse -q --verify "$sha:$1" 2>/dev/null || echo absent
}

self_id=$(object_id "$SELF_PATH")
[ "$self_id" != absent ] || { echo "engine-source-identity: $SELF_PATH missing at $sha" >&2; exit 1; }
dockerfile_id=$(object_id "$DOCKERFILE")
[ "$dockerfile_id" != absent ] || { echo "engine-source-identity: $DOCKERFILE missing at $sha" >&2; exit 1; }
dockerfile=$(git show "$sha:$DOCKERFILE" 2>/dev/null) || { echo "engine-source-identity: $DOCKERFILE unreadable at $sha" >&2; exit 1; }
dockerignore_id=$(object_id "$DOCKERIGNORE")
dockerignore=''
if [ "$dockerignore_id" != absent ]; then
  dockerignore=$(git show "$sha:$DOCKERIGNORE" 2>/dev/null) || { echo "engine-source-identity: $DOCKERIGNORE unreadable at $sha" >&2; exit 1; }
fi

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

ESI_SHA="$sha" \
ESI_CONTEXT="$CONTEXT" \
ESI_SELF_ID="$self_id" \
ESI_DOCKERFILE_ID="$dockerfile_id" \
ESI_DOCKERIGNORE_ID="$dockerignore_id" \
ESI_DOCKERIGNORE_CONTENT="$dockerignore" \
ESI_SOURCES="$sources" \
ESI_MODE="$mode" \
python3 -B - <<'PY'
import hashlib
import os
import re
import subprocess
import sys

sha = os.environ["ESI_SHA"]
context = os.environ["ESI_CONTEXT"]
self_id = os.environ["ESI_SELF_ID"]
dockerfile_id = os.environ["ESI_DOCKERFILE_ID"]
dockerignore_id = os.environ["ESI_DOCKERIGNORE_ID"]
dockerignore_content = os.environ["ESI_DOCKERIGNORE_CONTENT"]
sources = [s for s in os.environ["ESI_SOURCES"].splitlines() if s]
mode = os.environ["ESI_MODE"]


def die(msg: str) -> None:
    print(f"engine-source-identity: {msg}", file=sys.stderr)
    sys.exit(1)


def compile_dockerignore(content: str) -> list[re.Pattern[str]]:
    patterns: list[re.Pattern[str]] = []
    for lineno, raw in enumerate(content.splitlines(), start=1):
        line = raw.rstrip("\r")
        if line.startswith("#") or not line.strip():
            continue
        rule = line.strip()
        if rule.startswith("!"):
            die(f"unsupported negation rule in {context}/.dockerignore:{lineno}: {rule}")
        if any(ch in rule for ch in ("[", "]", "\\")):
            die(f"unsupported glob syntax in {context}/.dockerignore:{lineno}: {rule}")
        while rule.startswith("./"):
            rule = rule[2:]
        rule = rule.strip("/")
        while "//" in rule:
            rule = rule.replace("//", "/")
        if not rule:
            die(f"empty rule in {context}/.dockerignore:{lineno}")
        raw_segs = rule.split("/")
        segs: list[str] = []
        for seg in raw_segs:
            if seg in (".", ".."):
                die(f"unsupported path segment in {context}/.dockerignore:{lineno}: {rule}")
            if "**" in seg and seg != "**":
                die(f"unsupported partial ** segment in {context}/.dockerignore:{lineno}: {rule}")
            if seg == "**" and segs and segs[-1] == "**":
                continue
            segs.append(seg)
        parts: list[str] = []
        for i, seg in enumerate(segs):
            if seg == "**":
                if i == len(segs) - 1:
                    parts.append("(?:/.*)?" if parts else ".*")
                else:
                    parts.append("/(?:.+/)?" if parts else "(?:.+/)?")
            else:
                if parts and not parts[-1].endswith("/)?"):
                    parts.append("/")
                buf = []
                for ch in seg:
                    if ch == "*":
                        buf.append("[^/]*")
                    elif ch == "?":
                        buf.append("[^/]")
                    else:
                        buf.append(re.escape(ch))
                parts.append("".join(buf))
        patterns.append(re.compile("^" + "".join(parts) + "$"))
    return patterns


def is_ignored(rel: str, compiled: list[re.Pattern[str]]) -> bool:
    if not compiled:
        return False
    parts = rel.split("/")
    for end in range(1, len(parts) + 1):
        candidate = "/".join(parts[:end])
        if any(rx.match(candidate) for rx in compiled):
            return True
    return False


def git_ls_tree_many(git_paths: list[str], recursive: bool) -> list[tuple[str, str, str, str]]:
    if not git_paths:
        return []
    cmd = ["git", "ls-tree", "-z"]
    if recursive:
        cmd.append("-r")
    cmd.append(sha)
    cmd.append("--")
    cmd.extend(f":(literal){p}" for p in git_paths)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        die(f"git ls-tree failed at {sha}: {proc.stderr.decode('utf-8', 'replace').strip()}")
    entries: list[tuple[str, str, str, str]] = []
    for rec in proc.stdout.split(b"\0"):
        if not rec:
            continue
        meta, sep, path_bytes = rec.partition(b"\t")
        if not sep:
            die(f"malformed git ls-tree record at {sha}")
        meta_parts = meta.decode("ascii").split(" ")
        if len(meta_parts) != 3:
            die(f"malformed git ls-tree metadata at {sha}")
        fmode, obj_type, oid = meta_parts
        path = path_bytes.decode("utf-8", "surrogateescape")
        entries.append((fmode, obj_type, oid, path))
    return entries


compiled_rules: list[re.Pattern[str]] = []
if dockerignore_id != "absent":
    compiled_rules = compile_dockerignore(dockerignore_content)

manifest_lines = [
    f"identity-script {self_id}",
    f"dockerfile {dockerfile_id}",
    f"dockerignore {dockerignore_id}",
]

prefix = context + "/"
src_git_paths = [(src, context if src == "." else f"{context}/{src}") for src in sources]
top_by_path: dict[str, tuple[str, str, str, str]] = {}
for entry in git_ls_tree_many([gp for _, gp in src_git_paths], recursive=False):
    top_by_path[entry[3]] = entry

for src, git_path in src_git_paths:
    top = top_by_path.get(git_path)
    if top is None:
        manifest_lines.append(f"copy {src} absent")
        continue
    _, obj_type, oid, path = top
    if dockerignore_id == "absent":
        manifest_lines.append(f"copy {src} {oid}")
        continue
    if obj_type == "blob":
        if not path.startswith(prefix):
            die(f"unexpected path outside {context}: {path}")
        rel = path[len(prefix):]
        if is_ignored(rel, compiled_rules):
            manifest_lines.append(f"copy {src} ignored")
        else:
            manifest_lines.append(f"copy {src} {oid}")
    elif obj_type == "tree":
        children = git_ls_tree_many([git_path], recursive=True)
        kept: list[tuple[str, str, str, str]] = []
        for fmode, ctype, coid, cpath in children:
            if not cpath.startswith(prefix):
                die(f"unexpected child path outside {context}: {cpath}")
            rel = cpath[len(prefix):]
            if is_ignored(rel, compiled_rules):
                continue
            kept.append((rel, fmode, ctype, coid))
        kept.sort(key=lambda item: item[0])
        h = hashlib.sha256()
        for rel, fmode, ctype, coid in kept:
            h.update(f"{fmode} {ctype} {coid} {rel}\n".encode("utf-8", "surrogateescape"))
        manifest_lines.append(f"copy {src} filtered-tree:{h.hexdigest()}")
    else:
        die(f"unsupported git object type {obj_type} for {git_path} at {sha}")

manifest_text = "\n".join(manifest_lines) + "\n"
identity = hashlib.sha256(manifest_text.encode("utf-8")).hexdigest()
if not re.fullmatch(r"[0-9a-f]{64}", identity):
    sys.exit(1)
if mode == "--manifest":
    sys.stdout.write(manifest_text)
sys.stdout.write(identity + "\n")
PY
