#!/usr/bin/env bash
# audit-merged-worktrees.sh — Strictly read-only Ops Mac worktree hygiene audit.
#
# NEVER deletes, prunes, resets, checks out, or mutates any worktree or branch.
# Inspects `git worktree list --porcelain`, classifies each linked worktree
# against `--base` (default: origin/main) via `git merge-base --is-ancestor`
# and (optionally) `gh pr list --head <branch> --state merged,closed`, measures
# disk usage with `du -sh`, and prints exact safe `git worktree remove`
# commands for human/owner review.
#
# Usage:
#   scripts/ops/audit-merged-worktrees.sh [--repo <path>] [--base <ref>] [--no-gh]

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: audit-merged-worktrees.sh [OPTIONS]

Strictly read-only audit of linked git worktrees. Never modifies, prunes,
resets, or deletes any worktree or branch.

Options:
  --repo <path>   Repository path to inspect (default: current git toplevel)
  --base <ref>    Base ref to check ancestry against (default: origin/main)
  --no-gh         Skip GitHub PR lookups via `gh pr list`
  -h, --help      Show this help message
EOF
}

REPO_ARG=""
BASE_REF="origin/main"
USE_GH=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      [ "$#" -ge 2 ] || { echo "error: --repo requires a path" >&2; exit 2; }
      REPO_ARG="$2"
      shift 2
      ;;
    --base)
      [ "$#" -ge 2 ] || { echo "error: --base requires a git ref" >&2; exit 2; }
      BASE_REF="$2"
      shift 2
      ;;
    --no-gh)
      USE_GH=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -n "$REPO_ARG" ]; then
  REPO_ROOT="$(git -C "$REPO_ARG" rev-parse --show-toplevel)"
else
  REPO_ROOT="$(git rev-parse --show-toplevel)"
fi

if ! git -C "$REPO_ROOT" rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "error: base ref '${BASE_REF}' does not resolve to a commit in ${REPO_ROOT}" >&2
  exit 1
fi

if [ "$USE_GH" -eq 1 ]; then
  if ! command -v gh >/dev/null 2>&1; then
    USE_GH=0
  elif ! gh auth status >/dev/null 2>&1; then
    USE_GH=0
  fi
fi

# Arrays (bash 3.2 compatible — no declare -A / mapfile).
ROW_STATUS=()
ROW_DIRTY=()
ROW_SIZE=()
ROW_BRANCH=()
ROW_PATH=()

SUGGEST_REMOVE_PATHS=()
SUGGEST_REMOVE_REASONS=()
DIRTY_WARN_PATHS=()
DIRTY_WARN_REASONS=()

TOTAL_LINKED=0
COUNT_MERGED_CLEAN=0
COUNT_MERGED_DIRTY=0
COUNT_CLOSED_CLEAN=0
COUNT_CLOSED_DIRTY=0
COUNT_UNMERGED=0
COUNT_MISSING=0

check_gh_pr_state() {
  local branch="$1"
  local out=""
  if [ "$USE_GH" -ne 1 ] || [ -z "$branch" ]; then
    echo ""
    return 0
  fi
  # Read-only GitHub PR query; never fails the audit on transient API/network issues.
  out="$(cd "$REPO_ROOT" && gh pr list --head "$branch" --state merged --json number --jq '.[0].number // empty' --limit 1 2>/dev/null || true)"
  if [ -n "$out" ]; then
    echo "PR_MERGED:#${out}"
    return 0
  fi
  out="$(cd "$REPO_ROOT" && gh pr list --head "$branch" --state closed --json number --jq '.[0].number // empty' --limit 1 2>/dev/null || true)"
  if [ -n "$out" ]; then
    echo "PR_CLOSED:#${out}"
    return 0
  fi
  echo ""
}

process_worktree() {
  local idx="$1"
  local wt_path="$2"
  local wt_head="$3"
  local wt_branch="$4"
  local wt_detached="$5"
  local wt_prunable="$6"

  [ -n "$wt_path" ] || return 0

  # First stanza is always the main worktree — never classify as removable.
  if [ "$idx" -eq 0 ]; then
    return 0
  fi

  TOTAL_LINKED=$((TOTAL_LINKED + 1))

  local display_branch="(detached)"
  if [ -n "$wt_branch" ]; then
    display_branch="${wt_branch#refs/heads/}"
  elif [ "$wt_detached" -eq 1 ]; then
    display_branch="(detached@${wt_head:0:8})"
  fi

  # Missing / prunable directory on disk.
  if [ "$wt_prunable" -eq 1 ] || [ ! -d "$wt_path" ]; then
    COUNT_MISSING=$((COUNT_MISSING + 1))
    ROW_STATUS+=("MISSING")
    ROW_DIRTY+=("n/a")
    ROW_SIZE+=("0B")
    ROW_BRANCH+=("$display_branch")
    ROW_PATH+=("$wt_path")
    return 0
  fi

  local size="?"
  size="$(du -sh "$wt_path" 2>/dev/null | awk '{print $1}' || echo "?")"

  local dirty="clean"
  if [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null || true)" ]; then
    dirty="dirty"
  fi

  local status="UNMERGED"
  local reason=""

  # Never flag a worktree sitting on main/master as removable.
  if [ "$display_branch" = "main" ] || [ "$display_branch" = "master" ]; then
    status="PROTECTED"
  elif [ -n "$wt_head" ] && git -C "$REPO_ROOT" merge-base --is-ancestor "$wt_head" "$BASE_REF" 2>/dev/null; then
    if [ "$wt_detached" -eq 1 ]; then
      status="DETACHED-MERGED"
      reason="detached HEAD is ancestor of ${BASE_REF}"
    else
      status="MERGED"
      reason="branch is ancestor of ${BASE_REF}"
    fi
  elif [ -n "$wt_branch" ]; then
    local gh_state=""
    gh_state="$(check_gh_pr_state "$display_branch")"
    case "$gh_state" in
      PR_MERGED:*)
        status="MERGED-PR"
        reason="squash/merge PR ${gh_state#PR_MERGED:}"
        ;;
      PR_CLOSED:*)
        status="CLOSED-PR"
        reason="closed PR ${gh_state#PR_CLOSED:}"
        ;;
      *)
        status="UNMERGED"
        ;;
    esac
  else
    status="DETACHED-UNMERGED"
  fi

  if [ "$dirty" = "dirty" ]; then
    case "$status" in
      MERGED|MERGED-PR|DETACHED-MERGED)
        status="${status}-DIRTY"
        COUNT_MERGED_DIRTY=$((COUNT_MERGED_DIRTY + 1))
        DIRTY_WARN_PATHS+=("$wt_path")
        DIRTY_WARN_REASONS+=("${reason} (uncommitted changes)")
        ;;
      CLOSED-PR)
        status="CLOSED-PR-DIRTY"
        COUNT_CLOSED_DIRTY=$((COUNT_CLOSED_DIRTY + 1))
        DIRTY_WARN_PATHS+=("$wt_path")
        DIRTY_WARN_REASONS+=("${reason} (uncommitted changes)")
        ;;
      *)
        COUNT_UNMERGED=$((COUNT_UNMERGED + 1))
        ;;
    esac
  else
    case "$status" in
      MERGED|MERGED-PR|DETACHED-MERGED)
        COUNT_MERGED_CLEAN=$((COUNT_MERGED_CLEAN + 1))
        SUGGEST_REMOVE_PATHS+=("$wt_path")
        SUGGEST_REMOVE_REASONS+=("$reason")
        ;;
      CLOSED-PR)
        COUNT_CLOSED_CLEAN=$((COUNT_CLOSED_CLEAN + 1))
        SUGGEST_REMOVE_PATHS+=("$wt_path")
        SUGGEST_REMOVE_REASONS+=("$reason")
        ;;
      *)
        COUNT_UNMERGED=$((COUNT_UNMERGED + 1))
        ;;
    esac
  fi

  ROW_STATUS+=("$status")
  ROW_DIRTY+=("$dirty")
  ROW_SIZE+=("$size")
  ROW_BRANCH+=("$display_branch")
  ROW_PATH+=("$wt_path")
}

WT_IDX=0
CUR_PATH=""
CUR_HEAD=""
CUR_BRANCH=""
CUR_DETACHED=0
CUR_PRUNABLE=0

while IFS= read -r line || [ -n "$line" ]; do
  if [ -z "$line" ]; then
    if [ -n "$CUR_PATH" ]; then
      process_worktree "$WT_IDX" "$CUR_PATH" "$CUR_HEAD" "$CUR_BRANCH" "$CUR_DETACHED" "$CUR_PRUNABLE"
      WT_IDX=$((WT_IDX + 1))
      CUR_PATH=""
      CUR_HEAD=""
      CUR_BRANCH=""
      CUR_DETACHED=0
      CUR_PRUNABLE=0
    fi
    continue
  fi
  case "$line" in
    "worktree "*)
      CUR_PATH="${line#worktree }"
      ;;
    "HEAD "*)
      CUR_HEAD="${line#HEAD }"
      ;;
    "branch "*)
      CUR_BRANCH="${line#branch }"
      ;;
    "detached")
      CUR_DETACHED=1
      ;;
    "prunable"*)
      CUR_PRUNABLE=1
      ;;
  esac
done < <(git -C "$REPO_ROOT" worktree list --porcelain && printf '\n')

if [ -n "$CUR_PATH" ]; then
  process_worktree "$WT_IDX" "$CUR_PATH" "$CUR_HEAD" "$CUR_BRANCH" "$CUR_DETACHED" "$CUR_PRUNABLE"
fi

printf '=== Worktree Hygiene Audit (READ-ONLY — no worktrees modified) ===\n'
printf 'Repository : %s\n' "$REPO_ROOT"
printf 'Base ref   : %s\n' "$BASE_REF"
printf 'GH PR check: %s\n\n' "$([ "$USE_GH" -eq 1 ] && echo "enabled" || echo "disabled")"

if [ "$TOTAL_LINKED" -eq 0 ]; then
  printf 'No linked worktrees found.\n'
  exit 0
fi

printf '%-20s %-7s %-8s %-38s %s\n' "STATUS" "DIRTY" "SIZE" "BRANCH" "PATH"
printf '%-20s %-7s %-8s %-38s %s\n' "--------------------" "-------" "--------" "--------------------------------------" "----"

i=0
while [ "$i" -lt "${#ROW_STATUS[@]}" ]; do
  printf '%-20s %-7s %-8s %-38s %s\n' \
    "${ROW_STATUS[$i]}" \
    "${ROW_DIRTY[$i]}" \
    "${ROW_SIZE[$i]}" \
    "${ROW_BRANCH[$i]}" \
    "${ROW_PATH[$i]}"
  i=$((i + 1))
done

printf '\nSummary: linked=%d merged_clean=%d merged_dirty=%d closed_clean=%d closed_dirty=%d unmerged=%d missing=%d\n' \
  "$TOTAL_LINKED" "$COUNT_MERGED_CLEAN" "$COUNT_MERGED_DIRTY" "$COUNT_CLOSED_CLEAN" "$COUNT_CLOSED_DIRTY" "$COUNT_UNMERGED" "$COUNT_MISSING"

if [ "${#SUGGEST_REMOVE_PATHS[@]}" -gt 0 ]; then
  printf '\nSuggested removal commands for human/owner review (NOT executed):\n'
  i=0
  while [ "$i" -lt "${#SUGGEST_REMOVE_PATHS[@]}" ]; do
    printf '  # %s\n' "${SUGGEST_REMOVE_REASONS[$i]}"
    printf '  git -C %q worktree remove %q\n' "$REPO_ROOT" "${SUGGEST_REMOVE_PATHS[$i]}"
    i=$((i + 1))
  done
else
  printf '\nNo clean merged/closed worktrees eligible for removal.\n'
fi

if [ "${#DIRTY_WARN_PATHS[@]}" -gt 0 ]; then
  printf '\nManual inspection required (merged/closed worktrees with uncommitted changes):\n'
  i=0
  while [ "$i" -lt "${#DIRTY_WARN_PATHS[@]}" ]; do
    printf '  # WARNING: %s -> %s\n' "${DIRTY_WARN_REASONS[$i]}" "${DIRTY_WARN_PATHS[$i]}"
    i=$((i + 1))
  done
fi
