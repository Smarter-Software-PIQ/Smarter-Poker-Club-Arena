#!/usr/bin/env bash
# Decide whether a branch is finished enough for automation to propose or merge.
#
# Usage: unfinished-work-guard.sh <branch> <head-commit-subject> [is-draft] [labels]
#   labels - the PR's label names, comma separated (empty before a PR exists)
#   exit 0  - automation may open the PR / arm protected squash auto-merge
#   exit 10 - unfinished work; the reason is printed and nothing may be armed
#   other   - usage error; callers fail closed
#
# Added 2026-11-27 after PR #3170: a handoff bookmark pushed as
# `bookmark/video-library-smarterdesign-2026-11-27`, head commit
# "wip(video-library): bookmark ... unfinished, see handoff", was opened by
# Agent Open PR and squash auto-merged by Agent Autopilot into production.
# A bookmark is a place to resume from, never a release. Both workflows call
# this one script so the two halves cannot disagree.
#
# Refined the same day: the first version held any subject that merely
# CONTAINED "bookmark" or "unfinished", which silently refused real features
# ("feat(video-library): bookmark timestamps", "fix: resume unfinished
# tournaments"). Work is now held only by an explicit signal:
#   - a draft PR;
#   - a PR label do-not-ship (or the older do-not-merge, hold, wip);
#   - a branch path segment bookmark, handoff or wip;
#   - a subject that STARTS with a marker: wip, [wip], bookmark:, bookmark(,
#     handoff:, handoff(, do-not-ship:, or [do-not-ship];
#   - a subject that contains [do-not-ship] anywhere.
set -euo pipefail

BRANCH="${1-}"
SUBJECT="${2-}"
DRAFT="${3:-false}"
LABELS="${4-}"

[ -n "$BRANCH" ] || { echo "usage: unfinished-work-guard.sh <branch> <subject> [is-draft] [labels]" >&2; exit 2; }

if [ "$DRAFT" = "true" ]; then
  echo "the pull request is a draft; a draft is never auto-merged"
  exit 10
fi

IFS=',' read -r -a LABEL_LIST <<<"$LABELS"
for LABEL in "${LABEL_LIST[@]}"; do
  L=$(tr '[:upper:]' '[:lower:]' <<<"$LABEL" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  case "$L" in
    do-not-ship|do-not-merge|hold|wip)
      echo "the pull request carries the $L label; it is not a release"
      exit 10 ;;
  esac
done

# Any path segment named bookmark, wip or handoff (or starting with one of them
# followed by - _ or .), so `agent/x/bookmark/...` is held as well as
# `bookmark/...`.
IFS='/' read -r -a SEGMENTS <<<"$BRANCH"
for SEG in "${SEGMENTS[@]}"; do
  LOWER=$(tr '[:upper:]' '[:lower:]' <<<"$SEG")
  if [[ "$LOWER" =~ ^(bookmark|wip|handoff)([-_.].*)?$ ]]; then
    echo "branch $BRANCH is a ${BASH_REMATCH[1]} branch, not a release"
    exit 10
  fi
done

LOWER_SUBJECT=$(tr '[:upper:]' '[:lower:]' <<<"$SUBJECT")
# "wip", "WIP:", "wip(scope):", "[WIP] ..." - but not "wipe".
if [[ "$LOWER_SUBJECT" =~ ^[[:space:]]*\[?wip([^a-z0-9]|$) ]]; then
  echo "head commit subject starts with wip: $SUBJECT"
  exit 10
fi
# "bookmark: ...", "handoff(scope): ...", "do-not-ship: ...", "[do-not-ship] ..."
# as the commit TYPE. A word in the description ("feat: bookmark timestamps")
# is not a marker.
if [[ "$LOWER_SUBJECT" =~ ^[[:space:]]*\[?(bookmark|handoff|do-not-ship)(\]|:|\() ]]; then
  echo "head commit subject is marked ${BASH_REMATCH[1]}: $SUBJECT"
  exit 10
fi
if [[ "$LOWER_SUBJECT" == *"[do-not-ship]"* ]]; then
  echo "head commit subject is marked [do-not-ship]: $SUBJECT"
  exit 10
fi

exit 0
