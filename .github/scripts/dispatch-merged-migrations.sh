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
# Test clock and health URL overrides only: the workflow never sets them, so
# production runs read the real clock and live https://engine.smarter.poker/health.
NOW_MS="${DISPATCH_NOW_MS:-}"
ENGINE_HEALTH_URL="${DISPATCH_ENGINE_HEALTH_URL:-https://engine.smarter.poker/health}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
PLANNER=scripts/ci/merged-migration-dispatch.mjs

# Two phases, one plan (2026-11-11). `plan` records one dispatch intent per
# file (scripts/ci/dispatch-intent.mjs) for the workflow to upload as this
# run attempt's dispatch-intents artifact; `send` re-reads the same plan,
# requires it to name the same files, and sends each with its intent. The
# applier honours a job-token dispatch only when it is that exact intent.
PHASE="${DISPATCH_PHASE:-plan}"
REPORT="$SUMMARY"
# The send phase repeats the plan silently; it reports from the wait onward.
if [ "$PHASE" = send ]; then SUMMARY=/dev/null; fi

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

# Read the serving engine's live maintenance schedule frequency (read-only).
# CLAUDE.md 10.86: an unreadable or unrecognised /health falls back cleanly to
# daily + :50-:03 rules without ever blocking or dropping a migration.
SCHEDULE_FREQUENCY="daily"
if grep -qE "(^|$(printf '\t'))supabase/migrations/" "$ADDED"; then
  HEALTH_FREQ=$(curl -fsS --max-time 10 "$ENGINE_HEALTH_URL" 2>/dev/null \
    | jq -r '.maintenance.schedule.frequency // "unknown"' 2>/dev/null || echo unknown)
  case "$HEALTH_FREQ" in
    three-hourly|daily)
      SCHEDULE_FREQUENCY="$HEALTH_FREQ"
      ;;
    *)
      SCHEDULE_FREQUENCY="unknown"
      say "- COULD NOT TELL serving engine maintenance schedule (\`${HEALTH_FREQ:-unknown}\`); falling back to daily + :50-:03 rules."
      ;;
  esac
fi

PLAN=$(node "$PLANNER" plan "$ADDED" ${NOW_MS:+"$NOW_MS"} --schedule "$SCHEDULE_FREQUENCY")
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

SUMMARY="$REPORT"
LIST=$(printf '`%s` ' "${DISPATCH[@]}")
if [ "$(jq -r '.withinBudget' <<<"$PLAN")" != "true" ]; then
  say "- **NOT DISPATCHED (break window)**: the applier would not admit ${LIST}within this run's bounded wait (next admitted: $(jq -r '.dispatchAt // "none in six hours"' <<<"$PLAN")). Nothing was sent."
  say "- Dispatch each, in this order, after :03 UTC: ${LIST}"
  echo "::error::Merged migrations not dispatched (break window): ${DISPATCH[*]}"
  gh pr comment "$PR" --repo "$REPO" --body "This PR merged inside the migration break window, and the dispatcher could not reach an admitted moment within its bounded wait, so NOTHING was dispatched. Dispatch \`apply-merged-migration\` for each, in order, after :03 UTC: ${LIST}" || true
  exit 1
fi

INTENT_STATE="${INTENT_STATE:-${RUNNER_TEMP:-/tmp}/merged-migration-intents.jsonl}"
if [ "$PHASE" = plan ]; then
  : > "$INTENT_STATE"
  for f in "${DISPATCH[@]}"; do
    node scripts/ci/dispatch-intent.mjs write --operation apply-merged-migration \
        --dir "${INTENT_DIR:?the intent directory is required}" --input "migration=$f" --input-json dry_run=false \
      | jq -c --arg f "$f" '{migration: $f, nonce: .nonce}' >> "$INTENT_STATE"
  done
  echo "send=true" >> "${GITHUB_OUTPUT:-/dev/null}"
  say "- recorded ${#DISPATCH[@]} dispatch intent(s) for ${LIST}; the next step sends them."
  exit 0
fi
[ "$PHASE" = send ] || { echo "::error::DISPATCH_PHASE must be plan or send"; exit 1; }
if [ "$(jq -sc '[.[].migration]' "$INTENT_STATE")" != "$(printf '%s\n' "${DISPATCH[@]}" | jq -Rsc 'split("\n")[:-1]')" ]; then
  say "- **NOT DISPATCHED**: the plan changed between recording the intents and sending them. Dispatch each, in this order, after :03 UTC: ${LIST}"
  echo "::error::Merged migrations not dispatched: the recorded intents no longer match the plan."
  exit 1
fi

WAIT=$(jq -r '.waitSeconds' <<<"$PLAN")
if [ "$(jq -r '.heldForDailyRelease' <<<"$PLAN")" = true ]; then
  # THE NIGHTLY RELEASE SCHEMA FREEZE (owner instruction 2026-11-17): the
  # 00:07 Backup copy must still equal production at the 03:30 selection.
  HELD="This PR merged during the nightly release schema freeze (23:45-04:15 America/Chicago). Its ordinary migration(s) ${LIST}are held by this dispatcher run and install at $(jq -r '.dispatchAt' <<<"$PLAN") (once, no retry), so the nightly Backup certificate still matches production when the 04:00 engine cutover is selected at 03:30. For a production outage that cannot wait, dispatch \`apply-merged-migration\` by hand now; that install makes tonight's certificate stale and the 04:00 cutover then keeps serving."
  say "- **HELD FOR THE DAILY ENGINE RELEASE**: ${HELD}"
  [ "$PHASE" != send ] || gh pr comment "$PR" --repo "$REPO" --body "$HELD" || true
fi
if [ "$(jq -r '.heldForThreeHourlyCutover' <<<"$PLAN")" = true ]; then
  # AUTOMATIC PER-CYCLE PRE-CUTOFF DEFERRAL (2026-11-21, Optimization O3):
  # keep production schema equal to the Backup copy across [cycle-90m, cycle+10m).
  CYCLE=$(jq -r '.threeHourlyCycle' <<<"$PLAN")
  CLEAR_CHICAGO=$(jq -r '.threeHourlyClearChicago' <<<"$PLAN")
  DEFER_AT=$(jq -r '.dispatchAt' <<<"$PLAN")
  HELD_3H="Deferring ordinary migration install until ${CLEAR_CHICAGO} Chicago to protect the ${CYCLE} 3-hourly Backup certificate (${DEFER_AT}). Its ordinary migration(s) ${LIST}are held by this dispatcher run (once, no retry) so the Backup copy still matches production at the ${CYCLE} preparation cutoff. For a production outage that cannot wait, dispatch \`apply-merged-migration\` by hand now; that install makes this cycle's certificate stale and the ${CYCLE} cutover then keeps serving."
  say "- **HELD FOR THE THREE-HOURLY ENGINE CUTOVER**: ${HELD_3H}"
  [ "$PHASE" != send ] || gh pr comment "$PR" --repo "$REPO" --body "$HELD_3H" || true
fi
if [ "$WAIT" -gt 0 ]; then
  say "- waiting ${WAIT}s, once, until $(jq -r '.dispatchAt' <<<"$PLAN") before sending anything."
  sleep "$WAIT"
fi
# The clock moved while waiting; ask once more rather than trust the plan.
if ! node "$PLANNER" admitted "${#DISPATCH[@]}" "$PREAMBLE" ${NOW_MS:+"$NOW_MS"} --schedule "$SCHEDULE_FREQUENCY"; then
  say "- **NOT DISPATCHED**: the applier would still refuse after the wait. Dispatch each, in this order, after :03 UTC: ${LIST}"
  echo "::error::Merged migrations not dispatched: ${DISPATCH[*]}"
  gh pr comment "$PR" --repo "$REPO" --body "This PR merged but the migration break window outlasted its bounded wait, so NOTHING was dispatched. Dispatch \`apply-merged-migration\` for each, in order, after :03 UTC: ${LIST}" || true
  exit 1
fi

# A FILE REVERTED WHILE HELD IS NOT SENT (2026-11-26). A merge inside the
# nightly freeze or a cycle hold waits in this run for up to six hours, and the
# plan read the default branch before the wait. On 2026-11-25 #12035 merged at
# 22:54 Chicago, was held to 04:15, and #12052 reverted it at 01:10; at 04:15
# this run still sent it, and the applier refused a file "that does not exist
# in this checkout" (run 45799563014). Harmless only because the applier looked.
# After the wait each file is read again from the default branch: one that is
# gone (404) is named and not sent; one that cannot be read is sent as before
# (the applier still refuses what it cannot find).
DEFAULT_BRANCH=$(jq -r '.repository.default_branch // empty' "${GITHUB_EVENT_PATH:-/dev/null}" 2>/dev/null || true)
DEFAULT_BRANCH=${DEFAULT_BRANCH:-main}
STILL_ON_MAIN=()
for f in "${DISPATCH[@]}"; do
  if READ=$(gh api "repos/$REPO/contents/supabase/migrations/$f?ref=$DEFAULT_BRANCH" --jq .sha 2>&1); then
    STILL_ON_MAIN+=("$f")
  elif grep -q 'HTTP 404' <<<"$READ"; then
    say "- **NOT SENT** \`$f\`: it left \`$DEFAULT_BRANCH\` while this run held it (reverted or superseded); nothing to install."
  else
    say "- COULD NOT TELL whether \`$f\` is still on \`$DEFAULT_BRANCH\`; sending as before."
    STILL_ON_MAIN+=("$f")
  fi
done
if [ "${#STILL_ON_MAIN[@]}" -eq 0 ]; then
  say "- every held file left \`$DEFAULT_BRANCH\` during the wait; nothing was sent."
  exit 0
fi
DISPATCH=("${STILL_ON_MAIN[@]}")

# AN OLDER MERGED MIGRATION INSTALLS FIRST (incident 90972d77) is guaranteed
# by the applier, not by timing here: every apply-merged-migration run installs
# the older pending ordinary files before its own
# (scripts/ci/install-older-merged-first.mjs), so the order these sends reach
# the queue in no longer matters.

# A SWITCHED-OFF APPLIER DROPS A DISPATCH WITHOUT A WORD (2026-11-21). GitHub
# answers 204 to a repository_dispatch for a disabled workflow and creates no
# run, so during an owner-window installer pause (ENGINE-OWNER-WINDOW-CUTOVER-
# PLAYBOOK step 2) this script used to print "dispatched" for files that were
# never queued (#11635's 20261121153607 at 18:19 UTC). Read the applier's
# state first: paused -> say HELD and send nothing (resume-migration-installs.sh
# sends every file merged during the pause, oldest first); unreadable -> say
# COULD NOT TELL and send as before.
APPLIER_STATE=$(gh api "repos/$REPO/actions/workflows/apply-merged-migration.yml" --jq .state 2>/dev/null || echo unknown)
case "$APPLIER_STATE" in
  active) ;;
  disabled_manually|disabled_inactivity|disabled_fork)
    LIST=$(printf '`%s` ' "${DISPATCH[@]}")
    say "- **HELD**: Apply Merged Migration is switched off (\`$APPLIER_STATE\`, an installer pause), so nothing was sent; a dispatch now would be dropped without a run. \`scripts/release/resume-migration-installs.sh <pause-start-sha>\` sends these when installs resume: ${LIST}"
    gh pr comment "$PR" --repo "$REPO" --body "This PR merged while Apply Merged Migration was switched off (installer pause), so the dispatcher sent NOTHING. The resume step (\`scripts/release/resume-migration-installs.sh <pause-start-sha>\`) sends these, oldest first: ${LIST}" || true
    exit 0 ;;
  *) say "- COULD NOT TELL whether Apply Merged Migration is switched on (\`$APPLIER_STATE\`); sending as before." ;;
esac

SENT=0
for f in "${DISPATCH[@]}"; do
  NONCE=$(jq -r --arg f "$f" 'select(.migration == $f) | .nonce' "$INTENT_STATE")
  if [[ "$NONCE" =~ ^[0-9a-f]{32}$ ]] && gh api --method POST "repos/$REPO/dispatches" \
      -f event_type=apply-merged-migration \
      -f "client_payload[migration]=$f" \
      -f "client_payload[intent_run_id]=$GITHUB_RUN_ID" \
      -f "client_payload[intent_run_attempt]=${GITHUB_RUN_ATTEMPT:?}" \
      -f "client_payload[intent_nonce]=$NONCE" \
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
