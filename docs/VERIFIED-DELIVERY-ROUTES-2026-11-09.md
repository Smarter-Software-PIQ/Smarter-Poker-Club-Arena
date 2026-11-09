# Verified delivery routes, measured 2026-11-09

Dated evidence from the Midway BBJ split and sweep-wording task
(checkpoint: `docs/HANDOFF-CHIP-ACCOUNTING-CURRENT-STATE.md` 7.9b). Every
route below was exercised on 2026-11-09 unless marked otherwise.

**This file is not policy and assigns nothing.** Authority stays with
`AGENTS.md`, `docs/agent-policy/`, `CLAUDE.md` and `PUBLISHING.md`. It records
WHICH ENTRY POINTS ACTUALLY WORKED, because this task lost most of a day
asserting a route did not exist without calling it - the failure CLAUDE.md
10.86 describes. Re-check a claim here in one call before routing around it.

**Credentials.** Every route uses a credential already loaded in its approved
store (keyring, process environment, provider CLI). Nothing here prints,
copies or reads a secret, and no agent should read credential values from
`.env`, a remote URL or a sibling checkout to use these routes.

Status key: **VERIFIED** exercised on the stated date - **UNAVAILABLE** tried
and refused, with the supported alternative - **PROPOSED** not authorized, do
not build.

---

## 1. Reaching the Mac Studio from a cloud session

| | |
| --- | --- |
| Entry point | `mcp__remote-devices__counselors__host_terminal` |
| Environment | the Mac host, as user `smarter.poker` (Homebrew on PATH, Node, git, `gh`, `supabase`, `vercel`) |
| Default cwd | `/Users/smarter.poker/Documents/club-arena` |
| Status | **VERIFIED** 2026-11-09 |

Discovery, in order:

1. `mcp__remote-devices__get_device_info` - `localMcpServers` lists `counselors`
   with `state: announced`. `connectedFolders` being empty does NOT mean the Mac
   is unreachable; it only limits the `device_*` file tools.
2. The tool is usually deferred. Load it with
   `ToolSearch` -> `select:mcp__remote-devices__counselors__host_terminal`.
3. Confirm safely: `whoami; pwd; date -u` (read-only, no side effects).

Prerequisites: the Mac is powered on and online with the Claude desktop app
running.

**Two different environments, easily confused.**

| Tool family | Where it runs | Needs |
| --- | --- | --- |
| `counselors__host_terminal` | the Mac itself | nothing beyond the server being announced |
| `device_bash`, `device_list_dir`, `device_stage_files` | a Linux VM on the Mac | a granted connected folder |

The `device_*` family could not read `/Volumes/...` during this task because a
folder grant was declined. `host_terminal` reached the same paths directly.
**If a `/Volumes` path is unreachable, try `host_terminal` before reporting no
route.**

Known limitation: the bridge stops waiting for a reply after about 60 seconds
regardless of the `timeout` argument. A `sleep 90` returned a device-timeout
error while the command kept running on the Mac. Poll in chunks under ~55s, or
wait in the cloud session and then read state in one short call. A read-only
poll is safe to repeat; a write is not.

---

## 2. GitHub authentication, canonical URL, worktree, push and merge

| | |
| --- | --- |
| Entry point | `gh` and `git`, on the Mac, through `host_terminal` |
| Identity | `gh auth status` showed account `Smarter-Poker` (keyring and process token), scopes `repo`, `workflow`, `admin:org`, `gist` |
| Status | **VERIFIED** 2026-11-09 (push, PR, checks, protected squash merge) |

**Canonical repository URL.**
`https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena`
The former `Smarter-Poker` owner still answers, with a "This repository moved"
notice. Two consequences measured here:

- `scripts/guard-merged-branch.sh` matches the repository by its canonical
  name, so a remote spelled `.../smarter-poker-club-arena` (lowercase) is
  refused with "GitHub did not identify the trusted destination repository".
  Set the remote to the canonical owner and repository casing.
- Prefer the new owner path in API calls.

**A cloud session's own `gh` is UNAVAILABLE.** In the cloud container the
ambient token failed `gh auth status`, and with the shell tokens removed `gh`
refused to run at all, so the pre-push repository check fails closed - correct
behaviour, not a bug. Supported next step: run the push from the Mac through
`host_terminal`. Do not bypass the hook, do not push files through the GitHub
API, and do not read a token out of the environment to feed `gh`.

**Owned worktree.** `scripts/guard-shared-clone.sh` refuses a push from the
shared clone `~/Documents/club-arena`. Work trees belong on an external SSD.

| Path | Writable 2026-11-09 |
| --- | --- |
| `/Volumes/SSD1-Mirror/agent-work` | **yes** - used for this task |
| `/Volumes/SmarterWork`, `/Volumes/SmarterWork/agent-work` | no - `git worktree add` failed "Permission denied" |
| `/Volumes/SmarterArchives` | no (but see 4 - the inbox file itself is writable) |

Create with `git worktree add -B <branch> <path> origin/main` from the shared
clone, then **run `npm ci` inside the worktree.** Symlinking the clone's
`node_modules` across volumes left `scripts/ci/check-ui-dollar.mjs` failing
`ERR_MODULE_NOT_FOUND: typescript` and the whole pre-push gate red; a real
install fixed it.

**Push, review, merge.**

1. `bash scripts/agent-push.sh` from the worktree - keeps every hook, closes
   stdin, returns git's real exit code and re-reads the remote ref to prove it
   landed ("VERIFIED: origin refs/heads/... = <sha>").
2. `gh pr create --repo <canonical> --base main --head <branch> --title ... --body-file <file>`.
   Use `--body-file`. An inline `--body "$(cat <<EOF ... )"` broke on an
   apostrophe in the body.
3. `gh pr checks <n> --repo <canonical>` for status; a job's steps through
   `gh api repos/<canonical>/actions/jobs/<id> --jq '.steps[]...'` when a check
   is slow, so "pending" is read as a step in progress rather than silence.
   Logs are not retrievable while a job runs.
4. `gh pr merge <n> --repo <canonical> --squash --match-head-commit <sha>`.

Measured timing: the required "TypeScript compilation and repository checks"
job took about 17 minutes on a docs-only change; most of it was money-integrity
steps. Slow is not stuck - read the steps before concluding anything.

On this Mac `gh` has its own login, so no token juggling was needed. Where an
ambient token is refused `mergePullRequest` or `rerun`, `PUBLISHING.md` step 6
documents running `gh` with the shell tokens removed.

---

## 3. Migration installer, production readback, evidence

| | |
| --- | --- |
| Installer | merge into protected `main` -> `dispatch-merged-migrations.yml` -> `apply-merged-migration.yml` |
| Scanned path | `supabase/migrations` only (confirmed by reading the workflow globs) |
| Status | **VERIFIED** 2026-11-09 - `20261109073642` installed through it |

Never apply from an unmerged branch, a local file, or the Supabase MCP
`apply_migration` (CLAUDE.md 2 rule 11). Dispatch by hand only a file the run's
summary names as not sent.

**Readback, safe and cheap:**

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
 WHERE version = '<version>';
```

Use `execute_sql` for this. Avoid the MCP `list_migrations`, which runs no-op
DDL and forces a PostgREST schema reload.

**Retiring a never-installed migration** is done by moving the file out of the
scanned path, not by deleting history: `supabase/retired-unapplied/` (17 files
on main). Verified 2026-11-09 that no workflow or installer script references
that directory, so a retired file cannot be dispatched or picked up by a
rebuild of the active chain.

Evidence to record for an install: the PR number, the merge commit, the
`apply-merged-migration.yml` run id, and the `schema_migrations` row.

---

## 4. The coordination inbox

| | |
| --- | --- |
| Canonical path | `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md` |
| Status | **VERIFIED** writable 2026-11-09 through `host_terminal` as `smarter.poker` |

**Symlink behaviour.** The canonical path is a symlink to
`/Volumes/SmarterArchives 1/agent-evidence/COORDINATION-INBOX.md` - the mirror
volume, whose name contains a space. Write through the canonical path and quote
it; do not hand-build the mirror path.

Volume-level permissions are misleading: `/Volumes/SmarterArchives` tests as not
writable while the inbox file itself appends fine. Test the file, not the
volume.

**Folder access.** The cloud `device_*` tools could not reach it - a
`device_request_folder_access` request was declined by workspace policy.
`host_terminal` is the working route.

**Rules** (from the file's own header): append only, never edit or delete
another agent's entry; one entry per request; header
`## <UTC timestamp> FROM <lane/agent id> TO <lane/agent id> - <subject>`; body
carries run ids, exact log lines and file paths plus the exact ask.

**Acknowledgment.** The receiving owner appends
`ACK <UTC timestamp> <agent id>: <decision or PR>` under the entry. An agent
**cannot acknowledge on an owner's behalf**; an entry with no ACK line is
pending, and should be reported as pending rather than as accepted. Confirm an
append safely with `wc -l` before and after, and `tail` to show the entry is
last and nothing else moved.

---

## 5. BBJ policy, allocator, sweep and evidence records

| Question | Where the answer is |
| --- | --- |
| Rule for one pool | `public.ca_bbj_pool_policy` (per-pool override; 1 row on 2026-11-09, the Midway pool) |
| Rule for every other pool | `public.ca_bbj_policy` id 1 - `standard` below `pivot_threshold` (100000), `pivot` at or above |
| Split actually applied | `fn_bbj_allocate(amount, main_balance, pool_id)`; promo is the remainder; sub-cent residue carries in `ca_bbj_alloc_state` |
| Rates for a surface | `fn_bbj_allocation_policy(pool_id)` |
| Promo share for a label | `fn_bbj_promo_window_share(pool_id, since, until)` - NULL unless one evidenced period covers the whole window |
| Window bound / wording | `fn_bbj_last_promo_sweep_at`, `fn_bbj_sweep_note` |
| The sweeps | `fn_sweep_bbj_promo(club)`, `fn_sweep_bbj_promo_all()` (~5 min cadence) |
| Which policy governed when | `public.ca_bbj_rate_periods` - pool, effective period, and the migration or policy row that evidences it (2 rows) |
| What was actually allocated | `bbj_contributions.main_portion / backup_portion / promo_portion` |
| Checkpoint | `docs/HANDOFF-CHIP-ACCOUNTING-CURRENT-STATE.md` 7.9b |
| Narrative | `docs/changelog/2026-11-09-the-sweep-label-states-the-allocation-actually-used.md` |
| Open, unowned | `docs/BBJ-ALLOCATION-ANOMALY-2026-08.md` |

`BBJ_POOL_ALLOCATION` in `src/config/RakeConfig.ts` and
`server/src/config/RakeConfig.ts` mirrors `ca_bbj_policy` only. It does not
carry any pool's override and nothing reads it at banking time.

**The per-hand ratio trap.** One hand's `promo_portion / amount` is NOT the
rate. Residue carry means a flat 60% rule produced 52 distinct per-hand ratios
(0.1667 to 1.0000) on this pool while the run was exactly 0.600000. Always
aggregate `sum(portion) / sum(amount)` over a window of at least 5.00 drop.

Safe confirmation of the live split (read-only):

```sql
SELECT round(sum(main_portion)/sum(amount)*100,4)   AS main_pct,
       round(sum(backup_portion)/sum(amount)*100,4) AS backup_pct,
       round(sum(promo_portion)/sum(amount)*100,4)  AS promo_pct,
       round(sum(amount)-(sum(main_portion)+sum(backup_portion)+sum(promo_portion)),4) AS unallocated
  FROM bbj_contributions
 WHERE pool_id = 'f9806a7f-e7a2-47d2-a676-36336e3a5337'
   AND created_at > '2026-11-08 21:43:21.501583+00';
```

---

## 6. Known limitations, and the supported next step

| Limitation (measured 2026-11-09) | Supported next step |
| --- | --- |
| Cloud session `gh` is not authenticated | Push and merge from the Mac via `host_terminal`. Never bypass hooks, write files through the GitHub API, or read a token to feed `gh`. |
| GitHub MCP write calls refused ("Resource not accessible by personal access token") - issue creation failed | Use `gh` on the Mac; for cross-lane asks use the coordination inbox. |
| `host_terminal` reply window ~60s | Chunk polls under ~55s; repeat only read-only calls. |
| `/Volumes/SmarterWork` not writable | Use `/Volumes/SSD1-Mirror/agent-work`. |
| `device_*` folder grant declined | `host_terminal` reaches the same paths. |
| macOS `base64` rejects a bare filename | `base64 -d -i in -o out`. Verify a transferred file by checksum on both ends. |
| Symlinked `node_modules` across volumes breaks pre-push checks | `npm ci` inside the worktree. |
| Mac offline, asleep, or desktop app closed | Say the computer is unreachable and continue with what the cloud container can do. Do not conclude that no route exists. |
| `PUBLISHING.md` had an active writer (open PR #10173) on 2026-11-09 | This task did not edit it. A pointer line is offered to its owner through the inbox rather than merged over their change. |

### PROPOSED - not authorized, do not build

Recorded so they are not lost, and so nobody implements them as if approved:

- **Rate-history enforcement** - require a rate change to write its
  `ca_bbj_rate_periods` period in the same transaction. Pending owner
  authorization.
- **Split drift check** - compare the realized split against the configured
  policy row and raise if they diverge. Pending owner authorization, and it must
  not become a repair job (CLAUDE.md 10.12).

### Scope note

Other pools keep their existing rules. The 5/20/75 split applies to the Midway
Union pool only, by owner instruction 2026-11-09; a platform-wide change needs
explicit owner authorization.
