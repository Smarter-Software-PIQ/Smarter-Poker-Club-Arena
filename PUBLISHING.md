**Owner direction November 6, 2026 (chat `01a1b095-8bd5-7d42-afcf-1a0843448274`):** All engine upgrades are staged and certified on isolated Backup during the day. Production replacements require certification for the exact version and may activate ONLY in the 04:00-04:05 America/Chicago maintenance window, after the 03:58 notice and all existing custody, freeze, proof, rollback and thaw safeguards. The temporary Phase1 hourly exception and historical urgent/degraded/owner-window replacement exceptions are revoked. A successful sealed release triggers a fresh Backup copy. Agents work in owned branches and merge through required checks; they never edit the live engine or a shared running Backup directly. A failed or missing certificate leaves the current engine running. Source preparation and non-engine delivery continue throughout the day.

# Publishing through the restored providers

**Non-engine delivery: push, publish, verify and finish immediately; never wait for an engine window.** Apply the maintenance cutover only to an actual engine replacement or a specifically identified dependency on new engine behavior. A Club Arena client using existing engine APIs, an unrelated pending engine release, and a generic engine-health check do not create that dependency. Required checks and normal client publication/live proof still apply.

Implementation status: PR #4788 separately delivers the additional engine recovery opportunity, split post-deploy jobs and parallel accounting/engine CI. Verify those capabilities in the current workflow and runtime before using them. Publishing these instructions does not install an engine change.

Read [AGENTS.md](AGENTS.md) and [the operating law](docs/agent-policy/OPERATING-LAW.md), including immediate failed-deployment recovery.

Current owner instruction, September 17, 2026. This is the active publication procedure for local and cloud agents. It supersedes older root-only authority, numbered delivery queues, stop-after-push directions, retired local-build procedures and reliance on disabled agent autopilot.

## Own the whole assigned delivery

Each agent authorized to push and publish completes its own submission, protected merge, publication and live verification. All assigned workstreams may proceed in parallel. Do not wait for the restoration task or an unrelated task to finish. Preserve actual code/schema dependencies, required technical checks, transactional safeguards, maintenance boundaries and provider concurrency controls. Those controls handle competing production publications; do not add an agent-managed queue.

Use an owned worktree and branch. Recover the existing PR, unmerged work, applied migrations and valid verification evidence before changing anything. Preserve unrelated changes and shared checkouts. Reading these instructions does not authorize another development phase or expand the assigned scope.

## Push and protected merge

1. Commit the intended files with the normal repository hooks and configured Git identity. Never force-push main, bypass hooks or disable required checks.
2. Push the owned branch through the configured authenticated Git transport. If the exact commit is already on its remote branch, reuse it.
3. Find the existing PR for that branch. Create one only if absent. Do not assume a PR helper is enabled, and do not depend on disabled autopilot or release-repair workflows.
4. Read the actual required results for the current PR revision. Use the configured GitHub CLI/API; if one interface cannot read check details, Actions run/job evidence is available through the authenticated REST API. An unreadable result is unknown, not passing.
5. Fix actual blockers with the smallest correct change, using the last successful equivalent as the baseline. Reuse successful evidence for unchanged source and inputs; do not add duplicate suites or run unrelated checks. Applicable required checks must actually pass.
6. Complete the protected squash merge with the reviewed current PR head. Let GitHub enforce branch protection. The agent owns this action once its assigned release is authorized; an additional restoration-owner handoff is not required.
   On the Mac Studio, run `gh` for the merge and for PR title or body edits with the shell's tokens removed: `env -u GH_TOKEN -u GITHUB_TOKEN gh pr merge <n> --squash --match-head-commit <sha>`. The exported `GH_TOKEN` is a fine-grained token that can read and push but is refused `mergePullRequest` and `updatePullRequest` (measured 2026-11-06); `gh`'s own login is the identity `scripts/agent-push.sh` already pushes with. The same applies to a rerun of a flaked required check: `env -u GH_TOKEN -u GITHUB_TOKEN gh run rerun <run-id> --failed`, because the exported token is also refused `rerun` and `enablePullRequestAutoMerge` (measured 2026-11-07). GitHub reports this repository under the owner `Smarter-Software-PIQ` (renamed from `Smarter-Poker`); prefer that owner in API paths, since some proxies refuse the numeric-ID redirect the old owner path answers with. Agent Autopilot is disabled and stays disabled, so nothing merges a green PR for you.

## World Hub

The protected main merge triggers the existing Vercel Git integration for **hub-vanguard**, project **prj_op66GkZyZcygXQKm76iyycfVFAQx**. Vercel builds from source and publishes production. Keep that integration enabled and use that existing project.

Confirm the production deployment is **READY**, its Git commit is the intended protected revision, and **https://smarter.poker/api/health** reports the deployed commit. Verify the affected behavior as well as the version.

Do not substitute a local/prebuilt deployment, deploy hook, separate Vercel project, old shared-clone push script or background push service. Club Arena client changes do not require a World Hub rebuild.

## Club Arena client

The protected main merge triggers **publish-club-arena.yml**. GitHub builds and checks the client, and the existing publisher installs it on Hetzner's static origin with its immutable asset safeguards.

Require successful publication and matching client revision/build provenance at both:

- **https://ca-static.smarter.poker/build-info.json**
- **https://smarter.poker/hub/club-arena/build-info.json**

Record the actual publisher run and selected revision. Preserve the origin's append-only assets; do not create a second publisher or copy the bundle into World Hub.

In `post-deploy-e2e.yml`, read the **Client browser verification** job separately from **Live-table and engine verification**. The client job has no dependency on an engine revision, maintenance certificate or live-table job. Both jobs retain their required reports, isolated-account cleanup and exact client provenance. The live-table job continues to run after every client publication, using the exact healthy engine currently serving that client, with protected-main ancestry and unchanged engine identity throughout its actual-hand/reconnect checks. A later unshipped engine commit on main is not its target. Engine-triggered certification instead requires the exact immutable engine SHA in the release event and refuses a different serving version.

Verify the jobs and affected behavior applicable to the assigned change. A client change to table transport or gameplay presentation still needs its live-table interoperability proof against the serving engine. An unrelated engine-certificate failure remains visible and must not be described as passing, but it is not a maintenance hold on an independent page, style or client release. Neither separate job may skip its own required checks to obtain a successful verdict.

## Club Arena engine and other changed components

## Backup and daily engine launch

The step-by-step procedure for everything in this section, including the decision table for what an agent does unprompted at 03:30 and 04:00, the Backup certification steps, the host transaction's phases and reserves, the post-cutover checklist and the read-only tool table, is [`docs/ENGINE-RELEASE-RUNBOOK.md`](docs/ENGINE-RELEASE-RUNBOOK.md). This section states the policy and the trace examples; the runbook states the procedure. `scripts/ci/select-daily-engine.py`, named below, is not yet on main (checked 2026-11-07); until it lands, read the staging run's `signal` job log for the selected SHA.

**Enforced today.** Protected merge, the exact-SHA Backup certificate, daily admission, in-break database readback and the host seal are enforced by the linked workflows.

**Published controls.** The daily selector requires four passing exact-target shards, immutable candidate and rollback image evidence, and a successful Backup certificate by 03:30 Chicago. The protected receiver verifies the selection receipt before handoff. Measure the first natural daily run to establish elapsed times under these controls. [Daytime release preparation](#daytime-release-preparation)

### Stage an upgrade during the day

Start in an owned branch from protected main. Keep the engine change, required migrations and focused regression coverage together. Preview the applicable checks with `node scripts/ci/execution-preview.mjs --working-tree`. Run the selected local checks and required gates, then merge through the protected PR. A server-tree push starts [Backup qualification](.github/workflows/backup-engine.yml) for that revision. Backup uses an isolated database and rehearses boot, crash recovery and a 1,800-second soak. Agents contribute through Git. Editing a running clone would produce a version that cannot be traced to the PR.

**A certificate follows identical engine source (2026-11-07).** The engine image is built from `git archive <sha> server` with `server/Dockerfile`, so `scripts/ci/engine-source-identity.sh <sha>` names exactly the bytes it is built from (the Dockerfile's context `COPY` sources, the Dockerfile and the script itself). A push run that is still the newest computes the candidate's identity, walks main's first-parent line back 60 commits, and inherits `backup-engine/certified = success` from the nearest ancestor with the same identity whose newest certificate is success, writing the candidate's own status as `Inherited from <sha>: identical engine source (<prefix>)` and building nothing. A same-identity ancestor whose newest certificate is failure, error or unreadable stops the walk and the candidate certifies in full; a different identity is never consulted; dispatch, schedule and post-seal runs always build. Selection and admission read only the state, so an inherited certificate qualifies exactly like an earned one, and the trace recipe below prints the inheritance in its description. The 1,800-second soak is unchanged for any candidate that builds. `docs/changelog/2026-11-07-a-certificate-follows-identical-engine-source.md`.

### Trace a change to its certificate

Run the following read-only example with an authenticated GitHub CLI from the repository. It traces tournament fix #9753 into the November 7 release. For a new release, replace the PR and candidate with the intended PR and the full SHA selected by the release workflow. The receiver's workflow head identifies its controls and can differ from the requested engine SHA.

```sh
repo=Smarter-Software-PIQ/Smarter-Poker-Club-Arena
pr=9753
candidate=40bc24676be48aed14155380502ba20c225bfbe6
merged=$(gh pr view "$pr" -R "$repo" --json mergeCommit --jq '.mergeCommit.oid')
gh api "repos/$repo/compare/$merged...$candidate" --jq '{status,behind_by}'
gh api "repos/$repo/commits/$candidate/status" --jq '[.statuses[] | select(.context == "backup-engine/certified")] | first | {state,target_url}'
```

Inclusion requires a merged PR, a comparison of `identical` or `ahead`, and zero commits behind. Inspect the newest certificate and follow its run URL to Backup. A pending, failed or missing result leaves the candidate ineligible. A new candidate requires its own proof. Record each required migration version from the PR, the route that installs it, its recorded production history and its required runtime signatures. A freeze-only migration needs a rehearsed installation and a fresh in-break verification before engine replacement.

### See the plan the evening before

Run `node scripts/ops/release-plan.mjs` at any time (an authenticated GitHub token in `GH_TOKEN`, and `DATABASE_URL` with `--ssl-root-cert scripts/ci/certificates/supabase-prod-ca-2021.crt` for the migration queue) to see, read-only, what the next 04:00 preparation would select: the serving SHA from `/health`, the main tip, the first-parent walk to the newest `backup-engine/certified` commit with every commit's state, the `server/**` commits between production and main, the Backup lane's runs, every queued `-- @install-window: daily-maintenance` file with its static validation, and a verdict of READY, NOTHING_OWED, NOT_READY or UNKNOWN (exit 0, 0, 1, 3). It never dispatches, cancels or writes. [evening-release-plan.yml](.github/workflows/evening-release-plan.yml) is its scheduled reader at 20:00 America/Chicago on main: it fails on NOT_READY or UNKNOWN so the red-main detector raises the issue, and keeps the JSON plan as an artifact. `--json` prints the plan; a queue that cannot be read is UNKNOWN, never zero.

### Select and activate the daily release

The release owner follows [daily staging](.github/workflows/stage-engine-release.yml) and its [receiver](.github/workflows/auto-deploy-hetzner.yml). Use America/Chicago calendar dates across daylight-saving changes. The normal last-hand notice starts at 03:58. Activation requires the 04:00–04:05 window, confirmed drain and freeze, exact Backup success, production database compatibility, a verified rollback source and the full cutover reserve. Keep the serving engine when any required evidence is missing. A late request cannot claim tomorrow's slot. Read the original request and result before retrying an interrupted operation.

Use the original Stage run’s `daily-engine-selection-YYYY-MM-DD` artifact and its `daily-selection.json` member to check what made the cutoff. A repeat attempt cannot replace the original selection. Use a fresh evidence directory on the external evidence volume and a configured authenticated GitHub CLI. For example, with the Chicago release date and the original staging run ID set in the shell:

```sh
gh run download "$stage_run" -R "$repo" -n "daily-engine-selection-$chicago_date" -D "$evidence_dir"
python3 -B scripts/ci/select-daily-engine.py --repo "$repo" --selection "$evidence_dir/daily-selection.json" --pr "$intended_pr" --migration "$migration_path"
```

The frozen report names the serving, target and control SHAs, the Chicago cutoff, and the exact preparation and Backup evidence. Inspect `selected`, `keep-serving` or `blocked` before acting. A deferred PR can still qualify for a later release. A blocked migration or unreadable receipt needs investigation. Confirm a migration's installation against its production ledger and runtime postcondition separately from its inclusion in Git.

The November 7 daytime release used a dated one-time order. Future routine releases follow the daily window. The scheduling objectives are 15 minutes from 04:00 to resumed games and 30 minutes to verified seal and gameplay. Measure Backup refresh separately. A duration target grants no authority to shorten a safeguard.

### Verify the seal, gameplay and refreshed clone

```sh
gh run view 42389189340 -R "$repo" --json displayTitle,headSha,status,conclusion,url
curl -fsS https://engine.smarter.poker/health |
  jq '{releaseSha,instanceId,status,phase:.maintenance.phase,stalledTableCount}'
gh run view 42392485932 -R "$repo" --json status,conclusion,jobs   --jq '{status,conclusion,jobs:[.jobs[]|{name,conclusion}]}'
```

The run IDs above are historical. Live health always describes the currently serving engine. For the release being verified, match the certified SHA, container and instance to the host's immutable per-run result at `/var/lib/club-arena/engine-release-results/<run-id>-<attempt>.json` and to the elected database leader. Confirm maintenance is idle. Use committed hands after thaw to verify eligible cash and tournament tables are advancing and both Lightning pools settle hands when populated. Account for scheduled breaks and empty tables in the census.

Once the gameplay evidence workflow is published, `post-deploy-e2e.yml` records `post-thaw-gameplay-<release-run>-<attempt>/gameplay.json`. For an operator readback, use `scripts/operations/release-gameplay-readback.sh SEALED_RESULT` through the configured read-only psql service. Match the result to the sealed attempt.

On November 7 the original receiver reported failure after the recovery invocation sealed. Reattach the protected observer to the original run using `observe-engine-release.sh --sha "$candidate" --run-id 42389189340-1` on the release host through the scoped observer procedure. Match its `ENGINE_RELEASE_SHA` and `ENGINE_RELEASE_RESULT=sealed` to the receipt and public health. A failed observer alone does not authorize another cutover. [Observer correction](https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pull/9892)

A successful receiver triggers a fresh Backup through the supported workflow. Inspect the resulting restore validation, seed failure count and final exact-SHA certificate. If the receiver concluded failure despite a verified seal, the release owner first checks for an existing refresh in the Backup queue. After proving the exact SHA is still serving, the owner can submit the supported Backup-only recovery once:

```sh
served=$(curl -fsS https://engine.smarter.poker/health | jq -er .releaseSha) &&
  [ "$served" = "$candidate" ] &&
  gh workflow run backup-engine.yml -R "$repo" --ref main -f sha="$candidate" -f refresh=true
```

Record the returned or observed provider run ID, wait for completion and verify the fresh restore and certificate timestamps are after the seal. The historical [pre-cutover certificate](https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/42384696674) and [post-seal refresh](https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/42392485932) are separate receipts for the same engine revision.

Record the staging run, selected runtime component revision and receiving engine release run. The runtime component revision can differ from a later documentation-only main revision. Confirm the expected component revision at **https://engine.smarter.poker/health** together with the existing release proof. A health response alone is not proof that the changed feature works.

If the assigned change includes monitoring, use its existing **deploy-monitoring.yml** route and final loaded-configuration verification. If it includes a database change, qualify and apply the exact migration through the configured authorized installation path, then read back the installed state and migration history. A merged migration file is not an installation. Do not replay installed migrations or assume an engine deployment applies them automatically. Preserve any actual application compatibility/cutover prerequisites.

**A migration reaches production only from protected main (owner instruction, October 25, 2026).** When the autopilot merges a pull request, `dispatch-merged-migrations.sh` sends every migration it added to Apply Merged Migration on its own; after any other merge, dispatch it yourself (repository_dispatch apply-merged-migration, payload {migration}). The applier sends the merged bytes once, in one transaction, records the file's own version and answers ALREADY-APPLIED for a version production holds. Never apply a migration from an unmerged branch, a local file or the Supabase MCP apply_migration, which also stamps the apply time as the version. On October 24 and 25 three migrations were applied from pull requests that were still open (#7968, #7983, #8019), so production ran SQL that main had never seen until it was recorded by hand in #8109. A fix that is urgent merges first; the dispatcher installs it minutes after the merge. The one exception is an active production outage that cannot wait for required checks: the agent that applies directly commits the byte-exact recording to main (scripts/ci/recorded-migrations.manifest.json) as its very next step and names the outage in that pull request.

## Production Alerts native event consumer

The receive-only component under `tools/production-alerts-native-wakeup/` uses
protected main, locked dependencies and the existing OpenClaw gateway's supported
`plugins install --link` route. Keep source and durable state on the external SSD.
Install its migration through Apply Merged Migration before enabling the private
channel. Preserve existing gateway services and loopback binding; use only a
public Supabase client key from the configured key tool plus the dedicated receive
capability held in canonical Supabase Vault and macOS Keychain. A public key alone
cannot read pending deliveries or join the event channel. This component cannot
publish games or initiate, advance, retry or certify any release.

Follow its README for exact installation/readback requirements. Completion needs
the actual private subscription, native queue receipt, complete original inbox
read and database acknowledgement from an automatic committed event. A producer
receipt, manual queue test or plugin listing alone is not delivery proof.

## Concurrent deliveries and completion

Continue other authorized work while provider jobs run. Keep the exact pending run/revision and inspect the result afterward; do not create a watcher, scheduler or repair loop. A provider may serialize a shared production resource or publish a newer protected revision containing several agents' changes. Record the actual selected revision and prove it contains your merged change; do not force an older revision over a newer release merely to obtain a matching number.

Report the PR, merged revision, applicable checks, installation evidence, successful publisher/deployment, actual live revision and affected-behavior result. Keep submitted, tested, merged, installed, published and verified live separate. Never claim the entire delivery is complete from a push or green build alone. Six minutes remains a performance target, not a guaranteed duration.

The restored production builds use GitHub, Vercel and Hetzner; reasonable provider compute is authorized. The M3/SSD can hold source and owned worktrees. Do not reactivate retired custom/local pipelines, release watchdogs, repair loops or the removed external error-telemetry integrations. A self-hosted build upgrade requires a later explicit owner instruction.

On the owner's Mac, also read /Users/smarter.poker/Documents/AGENTS.md and /Users/smarter.poker/Documents/AGENT-HARDENING-STANDARD.md. Preserve later owner instructions and the assigned scope. Never print credentials or copy values from .env files into commands or documents.

## Failed or interrupted deployment

Follow the operating law's failure classification immediately. Repair build/test/preflight failures without waiting for a maintenance hour; reattach to an unknown owning operation; verify or recover missing proof without restarting a healthy deployed version. A cutover needs the existing durable maintenance certificate and full proof/rollback budget. Record failure, fix-ready, retry submission, admission and verification times separately. The additional certified engine recovery opportunity is a required implementation improvement, not a capability supplied by these Markdown changes. Do not extend a freeze or reduce safety reserves to force a retry.

## Publication timing

Push ready changes, run checks, complete protected merge, build and stage as soon as their prerequisites pass, throughout the hour. Do not hold these stages until `:55`. World Hub and Club Arena client publication have no hourly gate. Only game-engine activation uses its certified maintenance window; the immutable image must be prepared beforehand, followed by immediate live identity, behavior and rollback-budget verification at cutover. Commander and shared-package delivery retain their own component rules above. See the operating law for failed-attempt recovery.

### Route by the changed behavior

| Change                                                                                  | Required route                                                                                                                      | Engine activation gate (daily 04:00 Chicago only)                                            |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Client pages, buttons, styles, assets or browser behavior with no new engine dependency | Client checks, protected merge, existing static publisher, both public build-info endpoints and affected behavior                   | None                                                                                         |
| Engine runtime or its release control                                                   | Required engine checks, protected merge, immediate engine staging/build, certified activation and proof                             | Engine activation only                                                                       |
| Client and engine together                                                              | Validate compatibility; stage both promptly and identify the exact dependency before exposing behavior that requires the new engine | Only the dependent behavior and engine activation; unrelated client work remains independent |
| Database or financial change                                                            | Applicable database/financial qualification and installation safeguards                                                             | Existing DDL/freeze restrictions where applicable, not a blanket client publication hold     |

Required engine unit tests and isolated PostgreSQL accounting qualification run in parallel. The existing required Server Engine check joins both results and refuses failure, cancellation, missing results or unexplained skips. Starting independent checks together removes an unnecessary sequencing delay without relaxing the merge requirements.

CI classification and deployment selection are separate. A client financial change may correctly require database/server tests without requiring an engine restart. Do not rename files or weaken checks to evade that qualification. A docs-only or client-only merge can invoke the lightweight engine detector; a verified unchanged engine tree must produce no engine deployment request. Provider runner queues and the static publisher's own serialization are not hourly maintenance gates.

## Before submission

Run the applicable local prechecks on the final candidate before push, as required by `docs/agent-policy/OWNER-POLICY.md`. Include source contracts reading changed Markdown/workflows/scripts and qualification manifests, not only imported-code tests. Resolve missing or stale owned dependencies and actual failures before submission; never defer an available local check to the first hosted run. Record exact input and results in the task checkpoint. Hosted CI, protected merge, publisher admission and applicable live proof remain mandatory.

## Access prerequisites and continued ownership

Check required provider access, reporter identity and secret-store metadata before dependent hosted work. Follow the owner policy for necessary credential repairs without another human approval. A missing input or tool-required handoff applies only to the steps that require it: continue local checks, integration, other running checks and independent publication yourself. Do not stop at a pending question or intermediate milestone; retain the exact owning operation and finish all executable work. Never print secrets or substitute a different reporter to satisfy a trusted check.

### Daytime release preparation

When the candidate differs from production, Backup rehearses both directions on its isolated database. It boots the candidate, swaps back to the serving revision, then swaps forward before crash and soak checks. Each swap compares occupied seat identities and chip stacks during the freeze and checks for resumed dealing after thaw. Failure in either direction disqualifies the candidate.

A protected-main engine push starts `engine-release-prequalification.yml`. Its four server shards exercise the exact candidate, including the retained historical qualification once. A separate runner builds the candidate image from the committed server tree, transfers its digest-only archive to the pinned Hetzner host, and verifies the sealed rollback image is the running container’s image and is present locally. The host rejects a conflicting candidate tag or insufficient disk space. This workflow never dispatches a release or changes a running container.

Use `python3 -B scripts/ci/read-engine-prequalification.py --repo Smarter-Software-PIQ/Smarter-Poker-Club-Arena --target TARGET_SHA --control CONTROL_SHA --cutoff EPOCH` from a checkout with authenticated protected-main history and read-only Actions access. A successful result identifies the production candidate and rollback image IDs, server tree, target and control SHAs, and qualification run and attempt. Exit 3 means the candidate lacks eligible evidence. Exit 2 means the verifier could not establish provenance.

The receiver verifies the selected control against its actual protected control and requires the latest successful qualification to have finished by 03:30 Chicago. Missing shards, a superseding attempt, changed release inputs or a mismatch between the prepared and installed image identities prevents handoff. The exact Backup certificate and fresh production database-door checks remain mandatory. A failed preparation leaves the current engine serving and the candidate waits for a future eligible window.
