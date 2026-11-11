#!/usr/bin/env bash
# A MERGED MIGRATION IS DISPATCHED BY ITS MERGE (2026-10-25, 2026-11-07).
#
# Run by .github/workflows/dispatch-merged-migrations.yml on the
# pull_request_target `closed` event of every PR merged into the default branch
# from a branch of this repository, whoever merged it. Sends ONE
# repository_dispatch (event_type apply-merged-migration, client_payload
# {migration, dry_run:false}) per migration file the PR added or modified, in
# filename order, after the merge.
#
# MODIFIED FILES (2026-11-08). A migration that merged, was refused at install
# (nothing applied) and was then fixed in the same file by a later PR is
# MODIFIED in that PR, not added: #10026 and #10029 fixed 20261108011659 that
# way and this script said "no ordinary migration to dispatch", leaving the
# fix for a hand install. A modified migration is now dispatched too. This
# job has no database credential, so it cannot tell whether the version is
# installed; the applier reads schema_migrations and answers ALREADY-APPLIED
# (exit 0, nothing sent) for an installed version, so dispatching one is
# harmless. A removed file is never dispatched, and a rename sends only its
# new filename, never its previous_filename.
#
# WHY NOT ONLY THE APP'S MERGES (2026-11-07). This began as the autopilot App
# dispatching its own merges, so that "the person who merged" stayed the
# applier's reader for a human merge. In practice the merger is an agent or
# GitHub auto-merge armed by the owner account, and nobody dispatched:
# #9876, #9858 and #9957 all left migrations uninstalled for hours. The real
# intent was always "a file that merged into protected main gets installed";
# the trust is the protected merge from this repository, which the workflow's
# `if` and the applier's own merged-bytes check enforce. The job also used to
# live in agent-autopilot.yml, which is disabled by owner instruction, so it
# never ran at all; it now has its own workflow.
#
# apply-merged-migration.yml stays dispatch-only and keeps every guard; this
# is the merger supplying the dispatch a person used to supply. It is not a
# watcher, timer or retry: one run per merge, one attempt per file, and the one
# wait is bounded and happens before anything is sent.
#
# THE BREAK WINDOW. The applier refuses at minute-of-hour :50-:03 UTC (and the
# database through the daily 04:00 Chicago break), and a refused dispatch
# leaves the file uninstalled with nobody owning the retry. So this waits,
# once, until a moment the applier will admit every file (at most
# WAIT_BUDGET_MINUTES, scripts/ci/merged-migration-dispatch.mjs). If that moment
# is beyond the budget, it sends nothing, names every file in the job summary
# and on the PR, and fails the run, so the file is never silently left behind.
#
# Window files ("-- @install-window: daily-maintenance") are never sent here:
# stage-engine-release.yml's window-migrations job installs them inside the
# 04:00 freeze. They are named in the summary as queued for that route.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN must be a token with contents:write (the job token)}"
REPO="${REPO:?repository is required}"
PR="${PR:?pull request number is required}"
MERGED_BY="${MERGED_BY:-}"
# Test clock only (epoch ms): the workflow never sets it, so the planner reads
# the real clock.
NOW_MS="${DISPATCH_NOW_MS:-}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
PLANNER=scripts/ci/merged-migration-dispatch.mjs

say() { echo "$*" | tee -a "$SUMMARY"; }

{
  echo "### Merged migrations for #$PR"
  echo ""
} >> "$SUMMARY"

# EVERY MERGE DISPATCHES ITS OWN MIGRATIONS (2026-11-07). This used to stop
# here unless the autopilot App had merged the PR, leaving "the person" who
# merged it to dispatch by hand. On this repository the merger is almost always
# an agent, and agents forget: on 2026-11-07 #9876 merged at 15:42Z with
# 20261107130652 (the database half of the PKO final-two fix) and nothing
# installed it for three hours; the 03:30 release would have shipped the
# engine half without it. The applier is idempotent (ALREADY-APPLIED) and
# installs one file at a time, so a merger who also dispatches by hand costs
# nothing. The merger is still named, so the summary says who merged it.
say "- #$PR was merged by \`${MERGED_BY:-unknown}\`; dispatching the migrations it added or modified."

if [ ! -f "$PLANNER" ]; then
  say "- This repository has no merged-migration planner; nothing to dispatch."
  exit 0
fi

ADDED=$(mktemp)
if ! gh api --paginate "repos/$REPO/pulls/$PR/files?per_page=100" \
    --jq '.[] | select(.status == "added" or .status == "renamed" or .status == "copied" or .status == "modified") | "\(.status)\t\(.filename)"' \
    > "$ADDED"; then
  say "- **COULD NOT TELL** which files #$PR added or modified: the PR file list was unreadable. Nothing was sent."
  say "- Read the PR's files and dispatch \`apply-merged-migration\` for each added or modified \`supabase/migrations/*.sql\` (filename order) after :03 UTC."
  gh pr comment "$PR" --repo "$REPO" --body "This PR merged but the merged-migration dispatcher could not read its file list, so it dispatched no migration. Dispatch \`apply-merged-migration\` for every \`supabase/migrations/*.sql\` this PR added or modified, in filename order, outside :50-:03 UTC." || true
  exit 1
fi

PLAN=$(node "$PLANNER" plan "$ADDED" ${NOW_MS:+"$NOW_MS"})
mapfile -t DISPATCH < <(jq -r '.dispatch[]' <<<"$PLAN")
mapfile -t WINDOW < <(jq -r '.windowQueued[]' <<<"$PLAN")
mapfile -t MISSING < <(jq -r '.notOnMain[]' <<<"$PLAN")
mapfile -t MODIFIED < <(jq -r '.modified[]' <<<"$PLAN")
mapfile -t MALFORMED < <(jq -r '.malformed[] | "\(.name): \(.reason)"' <<<"$PLAN")
PREAMBLE=$(jq -r 'if .preamble then 1 else 0 end' <<<"$PLAN")

for f in "${WINDOW[@]}"; do
  say "- skipped \`$f\`: declares \`-- @install-window: daily-maintenance\`; it is QUEUED for the daily 03:30 America/Chicago window-migrations run of stage-engine-release.yml, never this door."
done
for f in "${MISSING[@]}"; do
  say "- skipped \`$f\`: added or modified by #$PR but absent from the default branch now; the applier would refuse it."
done
for f in "${MODIFIED[@]}"; do
  say "- \`$f\` was MODIFIED (not added) by #$PR: dispatched in case its version was never installed (e.g. refused at install, then fixed in place); if it is installed, the applier answers ALREADY-APPLIED and sends nothing, and the edit is NOT installed."
done
FAIL=0
for f in "${MALFORMED[@]}"; do
  say "- **REFUSED** \`$f\` (malformed install-window declaration; fix the file, then dispatch it)."
  FAIL=1
done

if [ "${#DISPATCH[@]}" -eq 0 ]; then
  say "- no ordinary migration to dispatch."
  exit "$FAIL"
fi

LIST=$(printf '`%s` ' "${DISPATCH[@]}")
if [ "$(jq -r '.withinBudget' <<<"$PLAN")" != "true" ]; then
  say "- **NOT DISPATCHED (break window)**: the applier would not admit ${LIST}within this run's bounded wait (next admitted: $(jq -r '.dispatchAt // "none in two hours"' <<<"$PLAN")). Nothing was sent."
  say "- Dispatch each, in this order, after :03 UTC: ${LIST}"
  echo "::error::Merged migrations not dispatched (break window): ${DISPATCH[*]}"
  gh pr comment "$PR" --repo "$REPO" --body "This PR merged inside the migration break window, and the dispatcher could not reach an admitted moment within its bounded wait, so NOTHING was dispatched. Dispatch \`apply-merged-migration\` for each, in order, after :03 UTC: ${LIST}" || true
  exit 1
fi

WAIT=$(jq -r '.waitSeconds' <<<"$PLAN")
if [ "$WAIT" -gt 0 ]; then
  say "- break window: waiting ${WAIT}s, once, until $(jq -r '.dispatchAt' <<<"$PLAN") before sending anything."
  sleep "$WAIT"
fi
# The clock moved while waiting; ask once more rather than trust the plan.
if ! node "$PLANNER" admitted "${#DISPATCH[@]}" "$PREAMBLE" ${NOW_MS:+"$NOW_MS"}; then
  say "- **NOT DISPATCHED**: the applier would still refuse after the wait. Dispatch each, in this order, after :03 UTC: ${LIST}"
  echo "::error::Merged migrations not dispatched: ${DISPATCH[*]}"
  gh pr comment "$PR" --repo "$REPO" --body "This PR merged but the migration break window outlasted its bounded wait, so NOTHING was dispatched. Dispatch \`apply-merged-migration\` for each, in order, after :03 UTC: ${LIST}" || true
  exit 1
fi

SENT=0
for f in "${DISPATCH[@]}"; do
  if gh api --method POST "repos/$REPO/dispatches" \
      -f event_type=apply-merged-migration \
      -f "client_payload[migration]=$f" \
      -f "client_payload[dispatcher_run_id]=$GITHUB_RUN_ID" \
      -F "client_payload[dry_run]=false" >/dev/null; then
    say "- dispatched \`$f\` (apply-merged-migration, dry_run false)."
    SENT=$((SENT + 1))
  else
    REST=$(printf '`%s` ' "${DISPATCH[@]:$SENT}")
    say "- **DISPATCH REFUSED** for \`$f\`; not retried. Dispatch each remaining file, in this order: ${REST}"
    echo "::error::apply-merged-migration dispatch refused for $f; remaining: ${DISPATCH[*]:$SENT}"
    gh pr comment "$PR" --repo "$REPO" --body "This PR merged and the dispatcher sent ${SENT} migration(s), then GitHub refused the dispatch for \`$f\`. Dispatch \`apply-merged-migration\` for each remaining file, in order: ${REST}" || true
    exit 1
  fi
  # Keep creation order, which is the applier's queue order (run id).
  if [ "$SENT" -lt "${#DISPATCH[@]}" ]; then sleep 2; fi
done
say "- the applier's own runs are the outcome: Actions -> Apply Merged Migration."
exit "$FAIL"
