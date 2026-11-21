#!/usr/bin/env bash

# Refuse a push to a branch whose pull request has already closed or merged.
# The pre-push hook passes the actual destination branch from Git's stdin, so
# this guard never guesses from HEAD and has no bypass. An unreadable authority
# fails closed: a successful but orphaned push is the defect being prevented.

set -uo pipefail

BRANCH="${1:-}"
REMOTE_NAME="${2:-}"
REMOTE_URL="${3:-}"
case "$BRANCH" in
  ''|HEAD|main|master) exit 0 ;;
esac
if ! git check-ref-format "refs/heads/$BRANCH" >/dev/null 2>&1; then
  echo "[merged-branch guard] BLOCKED: '$BRANCH' is not a valid destination branch." >&2
  exit 1
fi

if [[ "$REMOTE_URL" =~ ^(git@github\.com:|https://github\.com/|ssh://git@github\.com/)(Smarter-Poker|Smarter-Software-PIQ)/([A-Za-z0-9._-]+)(/)?$ ]]; then
  OWNER="${BASH_REMATCH[2]}"
  REPO="${BASH_REMATCH[3]}"
  REPO="${REPO%.git}"
else
  echo "[merged-branch guard] BLOCKED: remote '$REMOTE_NAME' is not an identified Smarter Poker GitHub destination." >&2
  exit 1
fi
# GitHub repository names are case-insensitive, and a clone made from a
# lowercase URL (a cloud session's own clone, 2026-11-21) pushed to
# .../smarter-poker-club-arena. The trust check below compares exact approved
# names, so that push was refused as "GitHub did not identify the trusted
# destination repository" although it was the right repository. Canonicalize
# the one known name; the immutable repository ID is still checked.
if [ "$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')" = "smarter-poker-club-arena" ]; then
  REPO="Smarter-Poker-Club-Arena"
fi
SLUG="$OWNER/$REPO"

if ! command -v gh >/dev/null 2>&1; then
  echo "[merged-branch guard] BLOCKED: GitHub CLI is required to verify destination branch '$BRANCH'." >&2
  exit 1
fi

TRUST_HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ci/repository-identity.mjs"

# Query GraphQL first (separate 5,000/hr quota bucket from REST core) so REST
# core rate-limit exhaustion does not block pushes, while preserving the same
# repository-identity trust check and fail-closed semantics.
# `gh` uses its credential store or a standard process-level GH_TOKEN. This
# guard never opens a repository `.env`, never scrapes another product's
# credentials, and never copies a token into a command line.
GQL_QUERY='query($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    databaseId
    nameWithOwner
    owner { login }
    pullRequests(
      headRefName: $branch
      states: [OPEN, CLOSED, MERGED]
      first: 10
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        number
        state
        mergedAt
        headRepositoryOwner { login }
      }
    }
  }
}'

GQL_RESP="$(GH_PAGER=cat gh api graphql \
  -f "query=$GQL_QUERY" \
  -f "owner=$OWNER" \
  -f "repo=$REPO" \
  -f "branch=$BRANCH" \
  2>/dev/null || true)"

VERDICT=""
if [[ -n "$GQL_RESP" ]]; then
  GQL_VERDICT="$(printf '%s' "$GQL_RESP" | node --input-type=module -e '
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const {isClubArenaRepository}=await import(pathToFileURL(process.argv[1]));
try {
  const doc=JSON.parse(readFileSync(0,"utf8"));
  if (!doc || typeof doc !== "object") { console.log("FALLBACK"); process.exit(0); }
  if (Array.isArray(doc.errors) && doc.errors.length > 0) { console.log("FALLBACK"); process.exit(0); }
  const r=doc.data?.repository;
  if (!r || typeof r !== "object") { console.log("FALLBACK"); process.exit(0); }
  const requested=process.argv[2];
  const fullName=r.nameWithOwner;
  const repoId=r.databaseId;
  if (requested.endsWith("/Smarter-Poker-Club-Arena")) {
    if (!isClubArenaRepository(requested,repoId) || !isClubArenaRepository(fullName,repoId)) {
      console.log("UNTRUSTED");
      process.exit(0);
    }
  } else if (!requested.startsWith("Smarter-Poker/") || fullName!==requested) {
    console.log("UNTRUSTED");
    process.exit(0);
  }
  if (typeof fullName !== "string" || r.owner?.login !== fullName.split("/")[0]) {
    console.log("UNTRUSTED");
    process.exit(0);
  }
  const nodes=r.pullRequests?.nodes;
  if (!Array.isArray(nodes)) { console.log("FALLBACK"); process.exit(0); }
  const headOwner=fullName.split("/")[0].toLowerCase();
  const prs=nodes.filter(
    (p) => p && typeof p === "object" &&
      typeof p.headRepositoryOwner?.login === "string" &&
      p.headRepositoryOwner.login.toLowerCase() === headOwner
  );
  if (prs.length === 0) {
    console.log("NONE");
  } else {
    prs.sort((a,b) => (Number(b.number) || 0) - (Number(a.number) || 0));
    const pr=prs[0];
    const number=pr.number ?? "unknown";
    if (pr.mergedAt || pr.state === "MERGED") console.log(`MERGED ${number}`);
    else if (pr.state === "CLOSED") console.log(`CLOSED ${number}`);
    else if (pr.state === "OPEN") console.log(`OPEN ${number}`);
    else console.log("ERROR");
  }
} catch { console.log("FALLBACK"); }
' "$TRUST_HELPER" "$SLUG" 2>/dev/null || echo FALLBACK)"

  case "$GQL_VERDICT" in
    UNTRUSTED)
      echo "[merged-branch guard] BLOCKED: GitHub did not identify the trusted destination repository." >&2
      exit 1
      ;;
    NONE|OPEN\ *|MERGED\ *|CLOSED\ *|ERROR)
      VERDICT="$GQL_VERDICT"
      ;;
    *)
      VERDICT=""
      ;;
  esac
fi

if [[ -z "$VERDICT" ]]; then
  # Fallback to REST if GraphQL failed or was unavailable.
  # Resolve transfers before filtering heads: GitHub redirects the old repository
  # API, but does not rewrite an old-owner head filter. Trust the maintained
  # approved names plus immutable ID, never an arbitrary redirected owner.
  IDENTITY="$(GH_PAGER=cat gh api -X GET "repos/$SLUG" 2>/dev/null || true)"
  RESOLVED="$(printf '%s' "$IDENTITY" | node --input-type=module -e '
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const {isClubArenaRepository}=await import(pathToFileURL(process.argv[1]));
try {
  const r=JSON.parse(readFileSync(0,"utf8"));
  const requested=process.argv[2];
  if (requested.endsWith("/Smarter-Poker-Club-Arena")) {
    if (!isClubArenaRepository(requested,r.id) || !isClubArenaRepository(r.full_name,r.id)) throw Error();
  } else if (!requested.startsWith("Smarter-Poker/") || r.full_name!==requested) throw Error();
  if (r.owner?.login !== r.full_name.split("/")[0]) throw Error();
  console.log(r.full_name);
} catch { process.exitCode=1; }
' "$TRUST_HELPER" "$SLUG" 2>/dev/null)"
  if [[ -z "$RESOLVED" ]]; then
    echo "[merged-branch guard] BLOCKED: GitHub did not identify the trusted destination repository." >&2
    exit 1
  fi
  SLUG="$RESOLVED"
  HEAD_OWNER="${SLUG%%/*}"

  RESP="$(GH_PAGER=cat gh api -X GET "repos/$SLUG/pulls" \
    -f "head=$HEAD_OWNER:$BRANCH" -f state=all -F per_page=10 \
    2>/dev/null || true)"

  if [[ -z "$RESP" ]]; then
    echo "[merged-branch guard] BLOCKED: GitHub CLI did not provide an authenticated verdict for '$BRANCH'." >&2
    exit 1
  fi

  VERDICT="$(printf '%s' "$RESP" | python3 -c '
import json, sys
try:
    prs = json.load(sys.stdin)
except Exception:
    print("ERROR")
    raise SystemExit
if not isinstance(prs, list):
    print("ERROR")
elif not prs:
    print("NONE")
else:
    prs.sort(key=lambda p: p.get("number", 0), reverse=True)
    pr = prs[0]
    number = pr.get("number", "unknown")
    if pr.get("merged_at"):
        print(f"MERGED {number}")
    elif pr.get("state") == "closed":
        print(f"CLOSED {number}")
    else:
        print(f"OPEN {number}")
' 2>/dev/null || echo ERROR)"
fi

case "$VERDICT" in
  NONE|OPEN\ *) exit 0 ;;
  MERGED\ *|CLOSED\ *)
    state="${VERDICT%% *}"
    pr="${VERDICT#* }"
    echo "[merged-branch guard] BLOCKED: destination '$BRANCH' belongs to $state pull request #$pr." >&2
    echo "[merged-branch guard] Create a new branch from current origin/main and carry the follow-up commit there." >&2
    exit 1
    ;;
  *)
    echo "[merged-branch guard] BLOCKED: GitHub returned an unreadable branch verdict for '$BRANCH'." >&2
    exit 1
    ;;
esac
