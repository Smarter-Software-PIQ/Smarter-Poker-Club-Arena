# HANDOFF 2026-11-05: Lobby favorites and filters are durable (PR #9552)

Written 2026-11-05 ~21:20 UTC (15:20 Chicago) by the agent that built the change.
The next agent starts here. Read this whole file before doing anything.

---

## 1. Executive Continuation Brief

**What is being built.** Club Arena (Smarter.Poker's online poker app) lost players'
lobby favorites (starred tournaments and cash games) and lobby filters "after a
couple of hours or a day". Dan's order: once set, a favorite or filter can NEVER
change unless the player changes it (or unfavorites), or the account is deleted.
Find the root cause, fix it, harden it so it never regresses.

**Business objective.** Player trust: a saved preference is an account fact, like
a balance. It must survive game rebuilds, recurring runs, slow loads, logouts,
device switches, offline edits, older app versions, and background code.

**Current phase.** Phase 4 of 6: required checks on PR #9552, then merge, then
install the migration in production, then verify the client publish.
Phases 1-3 (diagnosis, redesign, tests) are DONE and pushed. Phases 5 (production
verification) and 6 (closeout report) are NOT started.

**Immediate unfinished objective.** PR #9552 head `fdd07b1cc8f2` (plus this
handoff commit on top) is running the required checks. When ALL required checks
are green: squash-merge, dispatch the migration, verify it applied, verify the
client publish, run the production proofs, write the closeout report to Dan.

**Most important thing to understand.** Nothing is merged and nothing is live.
Production still runs the OLD code and OLD schema. Do not tell Dan anything is
deployed until it is verified (CLAUDE.md 1.4).

**First action.** `cd` into a clone of the repo on branch
`fix/lobby-favorites-follow-the-game`, check the PR's current head and its check
runs (section 22). If something is red, read the failing job log and fix it.

---

## 2. User Requirements And Working Preferences

Dan's original message (verbatim, key part): "WHEN A USER MARKS HIS "FAVORITES"
FOR TOURNAMENTS OR CASH GAMES, OR SETS THERE FILTERS ... IT SAVES FOR A COUPLE
HOURS, OR MAYBE A DAY, BUT THEN THEY ALWAYS SEEM TO SILENTLY FAIL OR SILENTLY
DEFAULT BACK TO NORMAL SETTINGS AND ALL "FAVORITES" FORGETTEN. ... ONCE SET, IT
CAN NEVER EVER EVER CHANGE UNDER ANY CIRCUMSTANCES UNLESS THE USER PHYSICALLY
GOES IN AND CHANGES IT OR "UN FAVORITES" A CASH GAME OUR TOURNAMENT, DO A DEEP
DIVE ON WHY THIS KEEPS REGRESSING, FIX IT AT ITS ROOT CAUSE, THEN HARDEN IT".

Second message: "APPROVED — COMPLETE PR #9552, MERGE WHEN THE REQUIRED CHECKS
PASS, DEPLOY THE DATABASE AND APPLICATION CHANGES, AND VERIFY THE RESULT IN
PRODUCTION." Favorites and filters are durable account preferences changed only
by the owner's explicit action or authorized account deletion.

Third message (full requirement set; all addressed in the design, see 9):
1. Durable identity for scheduled tournaments, Sit N Gos, Spins, satellites and
   cash games. An edit to the same game is not a different game; rebuilds, next
   runs, maintenance recreation keep the link; a different game must not inherit
   a star through a reused name or configuration.
2. A saved favorite stays saved while its game is unavailable. Report migration
   counts: mapped, duplicates, unresolved. Preserve unresolved; identify
   unrecoverable ones.
3. App-level coverage: slow/failed loads, a change before the load finishes,
   token refresh, mobile background/resume, logout/login, account switching,
   offline edits, failed saves, retries, delayed responses, older app versions,
   unavailable filter options, one preference never overwriting unrelated ones,
   defaults never written, queues bound to their account, auth refresh before
   retry, pending/failed saves visible and retryable, "Saved" only after the
   backend acknowledges.
4. Server-held versions or conflict checks, not device clocks: offline favorite
   cannot return after an unfavorite; stale filter snapshot cannot overwrite
   newer selections; duplicate/out-of-order replies, clock differences and equal
   timestamps don't change the outcome; no cross-account replay; tombstones;
   define reconciliation of disconnected changes.
5. Owner protections verified through the app's actual paths: no authenticated
   background default-writes; the account-deletion exception requires a real
   deletion; describe the security model accurately.
6. Follow the current head's required checks; ensure the new persistence test
   actually runs; retire superseded watchers; distinguish infrastructure failures
   from real ones; merge; verify migration applied, app version serving, both
   working together, existing favorites carried over.
7. Production verification with designated test accounts and isolated tests: a
   recurring tournament, a rebuilt cash game, on-demand formats, refresh and
   relogin, a second session, saved filters, explicit unfavorite. Final report:
   PR link, final tested commit, merge commit, migration and deploy status,
   regression checks, production verification results, legacy migration results,
   blockers, next action. "Complete everything that can be completed in this
   session."

Dan's standing preferences (binding):
- Act as autonomous lead PM: announce the plan and execute. Never ask Dan to do a
  job you can do (including merging and delivery to live).
- Report in plain English. No SHAs, statistics or internal identifiers as the main
  content of a message to Dan.
- Phased reporting: "Phase N of X is done", summary, "ready to start Phase N+1".
- No unverified data; never claim success before it is verified.
- If you need Dan to say something, end the reply with the exact line he should
  send back.

---

## 3. Project And Repository Identity

| Item | Value | Status |
|---|---|---|
| Project | Club Arena (Smarter.Poker) | confirmed |
| Repository | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena` (git remote URL is the old lowercase `smarter-poker-club-arena`; GitHub redirects) | confirmed |
| Clone used | `/home/claude/smarter-poker-club-arena` in an ephemeral cloud container (will NOT exist for you; re-clone) | confirmed |
| Branch | `fix/lobby-favorites-follow-the-game` | confirmed |
| PR | https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pull/9552 , open, not merged, `mergeable_state=blocked` (checks pending) | confirmed 21:17 UTC |
| Base | `origin/main` merge-base `a8b078fbde30` | confirmed |
| Framework | Vite + React 19 + TypeScript SPA; server engine in `server/` (not touched) | confirmed |
| Package manager | npm (`npm ci`) | confirmed |
| Test runner | vitest (client), node --test (ops), Playwright (e2e) | confirmed |
| Database | Supabase Postgres, project `kuklfnapbkmacvwxktbh` | confirmed |
| Client hosting | Hetzner static origin `ca-static.smarter.poker`, served at `smarter.poker/hub/club-arena/` via World Hub rewrite | confirmed (CLAUDE.md) |
| Client publisher | `.github/workflows/publish-club-arena.yml` on merge to main | confirmed (CLAUDE.md) |
| Migration installer | `.github/workflows/apply-merged-migration.yml` (repository_dispatch `apply-merged-migration`) | confirmed |
| World Hub repo | not modified by this work | confirmed |

---

## 4. Repository Map (everything this change touches)

Database
- `supabase/migrations/20261105183133_lobby_favorites_follow_the_game_not_the_row.sql`
  NEW, 633 lines, one BEGIN/COMMIT with `SET LOCAL lock_timeout = '3s'`. The whole
  server design (section 6/9). Production code. Do not edit after merge.
- `scripts/ci/schema-manifest.d/lobby-favorites-follow-the-game.json` NEW. Declares
  the 3 new tables, 9 functions and new columns so the phantom-reference CI check
  knows them. Coupled to the migration.

Native database proof
- `scripts/dev/test-lobby-favorites-postgres.sh` NEW. Builds a throwaway Postgres
  whose fixture mirrors production's columns, policies, grants and `auth.uid()`,
  applies the migration, runs 42 checks, prints "all checks passed".
- `.github/workflows/lobby-favorites-are-durable.yml` NEW. Runs that script on PRs
  touching these paths; installs PG17 from PGDG with `curl --retry 5
  --retry-all-errors`; greps for "all checks passed". Check name: "Lobby favorites
  and filters are durable". NOT in the ruleset (not a merge gate); this session
  treated it as required anyway.

Client
- `src/lib/preferenceSync.ts` NEW. Account-bound save queue (section 6).
- `src/lib/pagePreferenceSave.ts` NEW. Page-preference save through the RPC.
- `src/components/lobby/lobbyPreferenceSync.ts` NEW. Lobby filter/view staging.
- `src/components/lobby/lobbyFavorites.ts` REWRITTEN. Only client door for stars.
- `src/components/common/PreferenceSaveStatus.tsx` NEW. Visible save state pill.
- `src/components/lobby/AdvancedFilters.tsx`, `src/components/lobby/lobbyViewPrefs.ts`
  MODIFIED to stage only changed fields and flush through the RPC.
- `src/pages/ClubHomePage.tsx` MODIFIED (stars, hydrate order, resume flush, adopt
  event, cash status filter fix, save status pill).
- `src/components/quickactions/favoriteTables.ts` MODIFIED (Quick Join ranking
  reads `fetchLobbyFavorites().cashIds`).
- `src/hooks/usePlayerPreference.ts`, `src/lib/rosterWorkspace.ts`,
  `src/lib/tableSettingIntents.ts`, `src/lib/authUtils.ts` MODIFIED.
- `src/lib/mysteryBountyProjection.ts` MODIFIED by the formatter only (import line
  wrap from the pre-commit hook). No behaviour change.

Tests
- `tests/lobby-favorites-follow-the-game.law.test.ts` NEW (16 tests; law file).
- `docs/laws.d/lobby-favorites-follow-the-game.md` NEW (required law registry entry).
- `tests/unit/preferencePersistenceScenarios.test.ts` NEW (18 app scenarios).
- `tests/helpers/fakePreferenceServer.ts` NEW (in-memory server with the same
  revision rules as the SQL).
- Updated mocks/pins: `tests/unit/usePlayerPreference.test.tsx`,
  `rosterWorkspaceAccount.test.ts`, `lobbyPreferenceSyncCompletes.test.ts`,
  `lobbyPreferenceAccountPersistence.test.ts`, `lobbyViewPrefsFollowThePlayer.test.ts`,
  `preferenceLogoutBoundary.test.ts`, `tableSettingIntentBoundaries.test.ts`,
  `lobbyPreferenceProof.test.ts`, `lobbyUiProof.test.ts`,
  `clubRosterReadOwnership.test.tsx` (added `localStorage.clear()`),
  `tests/components/playerCommandPhase5Operations.test.tsx` (added `localStorage.clear()`).
- Production browser proofs (run only by dispatch against production):
  `tests/e2e/support/preferenceSaveProof.ts` NEW (matcher for the new save RPCs),
  `tests/e2e/support/lobbyPreferenceProof.ts`, `tests/e2e/production-mobile-lobby-chrome.spec.ts`,
  `tests/e2e/production-lobby-filter-audit.spec.ts` MODIFIED.

Docs
- `docs/changelog/2026-11-05-lobby-favorites-follow-the-game.md` NEW (full design
  record, final section on proofs).
- This handoff.

---

## 5. Applicable Instructions And Constraints (reread before editing)

- `CLAUDE.md` (repo root): especially 1.1/1.4 (publish and "claiming success"),
  section 2 production DDL policy rules 1-11, 4.5 (reserve migration versions),
  5.8 (never push a red test; update pins in the same commit), 10.8 (law registry
  `docs/laws.d/`), 10.11/10.12 (root fixes, no repair jobs), 11.5 (money probes
  rolled back; over Supabase MCP ONE call = ONE transaction, use one DO block that
  ends with RAISE EXCEPTION).
- `PUBLISHING.md`: owned branch, PR, required checks, protected squash merge,
  existing publisher, live proof. Migration only from protected main.
- `AGENTS.md`, `AGENT-PLAYBOOK.md`, `docs/agent-policy/REFERENCE-INDEX.md`: read
  at task start.
- Key rules that shaped this work: one transaction per migration; `lock_timeout`;
  no foreign key to hot tables (tables, tournaments); no DDL inside :50-:03 UTC
  (the database refuses it); never apply from an unmerged branch or MCP
  `apply_migration`; never use Dan's personal account in scripts/probes (service
  identity is `daniel@smarter.poker`, role god); popups in Title Case with no em
  dashes; changelog in its own file.
- `scripts/agent-push.sh` refuses this kind of clone ("push from your own
  worktree"). This session pushed with plain `git push origin
  HEAD:fix/lobby-favorites-follow-the-game </dev/null`; hooks ran and passed.
- GitHub GraphQL is blocked in these sessions (`gh pr view/checks/merge` fail with
  403). Use REST: `gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/...`.

---

## 6. Complete Discovery Record

Root causes found (production evidence, read-only queries):
1. **Favorites were keyed to the ROW, not the game.** Tournament stars were a list
   of tournament ids in `user_page_preferences` (key
   `lobby-tournament-favorites:global`); cash stars were `favorite_tables` rows with
   a foreign key to `tables`. Every recurring run is a new tournament row and every
   cash table rebuild/maintenance recreation is a new `tables` row, so stars
   "expired" within hours. `favorite_tables` cascades on table delete, which
   silently erased stars.
2. **Whole-snapshot writes with device ordering.** Filters/view were written as a
   whole row upsert; a stale device (or a load that had not finished) wrote
   defaults over newer choices. Ordering used device timestamps (`changed_at`).
3. **Background default-writes.** Hydration paths wrote cached/default state back
   to the account (a "replay" of an empty view counted as a change).
4. **Switching to the cash section overwrote the saved status filter**
   (`setAllStatusFilter` on section toggle). Fixed with a display-only
   `cashStatusFilter`.
5. Account deletions: 9,669 past `auth.users` deletions explain preference-row
   deletions by cascade (legitimate). `favorite_tables` had 13 deletions that
   cannot be told apart from cascades: UNRECOVERABLE, reported as such.

Production data before migration (read-only counts): 25 legacy tournament star
entries mapping to 19 distinct (player, schedule) favorites; 12 cash entries; all
resolvable. Those 19 tournament stars light 56 live runs; 12 cash stars light 25
live tables. (Counts as of earlier today; re-read after migration.)

Identity architecture (`fn_lobby_tournament_key`, `fn_lobby_cash_key`):
- scheduled tournament: `schedule:<schedule_id>` (every run of the schedule)
- satellite: `satellite:<target schedule: or tournament: key>:<TYPE>:<format_contract>:<max_players>`
- on-demand Spin / Sit N Go board (no schedule, format `sng-v1`/`spin-v1`):
  `board:<club_id>:<union_id>:<TYPE>:<trimmed name>`
- one-off tournament: `tournament:<id>`
- cash game: `cash_game:<cluster_id>` (`tables.cluster_id` = `cash_games.id`;
  rebuilt tables share the cluster)
- cash table without a cluster: `table:<id>`
- explicit renames/recreations: `lobby_game_aliases(old_key -> new_key)`, followed
  by `fn_lobby_current_key` (recursive, at most 8 hops). A name change of a board
  game needs an alias row (a different name is a different game by design).

Client sync architecture (`src/lib/preferenceSync.ts`):
- Only fields the player changed are staged, measured against a baseline taken
  from the last account read. Pending changes persist in localStorage at
  `ca_pref_pending:<owner>:<scope>`, acknowledged revisions at `ca_pref_ack:...`.
- Flush is sequential per scope, up to 4 passes. `callPreferenceRpc` checks both
  the store user and the live session equal the owner; on an auth error it runs
  ONE `refreshSession` then retries only if the session is still that owner.
- Status states: saving, saved, failed, conflict, signed_out; shown by
  `PreferenceSaveStatus` ("Saving", "Saved On This Device, Waiting For
  Connection", "Saved", "Not Saved" + Retry, "Sign In To Save" + Retry, "Changed
  On Another Device" + Dismiss).
- `onResume` flushes on `online` and `visibilitychange`. Logout does NOT clear
  `ca_pref_*` (a pending change waits for its own account).

---

## 7. Work Completed (all pushed to the branch; none merged)

Commits on the branch since base (oldest relevant first): `826429ef4`,
`cd8522330`, `26e6357e6`, `48757f492` (earlier design, now superseded by the
redesign), `b985bac7d` (FULL REDESIGN), `80e1cc9fc` (law-test window fix),
`12a152807` (production proofs + roster test isolation), `fdd07b1cc` (roster
operations test isolation), plus this handoff commit.

Workstream A, database (migration 20261105183133):
- Sequence `player_preference_revision_seq` (server-issued revisions).
- `player_lobby_favorites` (user_id FK auth.users ON DELETE CASCADE, kind, game_key,
  club_id, label, active, revision, created_at, updated_at; PK user,kind,game_key;
  RLS select own; REVOKE ALL from PUBLIC, anon, authenticated, service_role; GRANT
  SELECT to authenticated). No FK to tables/tournaments.
- `lobby_game_aliases` (old_key PK, new_key, reason).
- `lobby_favorites_migration_report` (outcome mapped / duplicate / unresolved).
- Guard trigger `fn_player_preference_guard` on the three preference tables:
  TRUNCATE refused; DELETE allowed only when the `auth.users` row no longer
  exists; INSERT/UPDATE require `auth.uid() = NEW.user_id`; identity columns
  immutable.
- `user_lobby_filters.revisions jsonb NOT NULL DEFAULT '{}'`,
  `user_page_preferences.revision bigint NOT NULL DEFAULT 0`. REVOKE INSERT,
  UPDATE, DELETE, TRUNCATE on both from anon, authenticated.
- `fn_save_lobby_preferences(p_club_id uuid, p_changes jsonb)`: fields
  `filters.<X>`, `view.tab`, `view.favoritesOnly`, `view.sort.<X>`; value <=16 KB;
  <=64 changes; returns results (field, status, revision, value) plus filters,
  view_prefs, revisions.
- `fn_save_page_preferences(p_changes jsonb)`.
- `fn_set_lobby_favorites(p_changes [{kind, game_id, on, base}])`: finds an
  existing row including one saved under an alias key and updates THAT row.
- `fn_my_lobby_favorites()`: (kind, game_id, game_key, active, revision) for every
  live game of the player's favorite rows, tombstones included; live statuses
  ANNOUNCED, REGISTERING, RUNNING, LATE_REG, STARTING_SOON, BAGGED; LIMIT 4000.
- Backfill DO block: acts as each owner (`set_config('request.jwt.claim.sub'...)`),
  writes report rows, leaves legacy sources untouched.
- Revision rule (all three save functions): conflict if `(base IS NULL AND cur >
  0) OR (base IS NOT NULL AND base < cur)`. Conflict replies carry the account's
  current value. A duplicate retry returns a conflict whose value equals what was
  sent; the client treats that as saved.

Workstream B, client (files in section 4). Verified by unit tests only.

Workstream C, production proofs moved to the new save path (this session's last
work): the proofs used to wait for direct POSTs to `user_page_preferences` /
`user_lobby_filters`, which no longer exist after the migration. They now accept
a change only when the owner's own RPC call answers that the account holds it.
The tournament favorite journey now expects every live run of the chosen event's
schedule to be starred together, and after unfavorite + reload the game is kept
as unstarred (tombstone) with nothing starred.

---

## 8. Visual And Product Decisions

- No new artwork. The only new visible element is `PreferenceSaveStatus`, a small
  floating pill (fixed, bottom 120px, right 16px, z 9998) on the club lobby; text
  in Title Case, no em dashes. Not reviewed by Dan visually: UNVERIFIED visually.
- Star buttons keep their existing labels "Add To Favorites" / "Remove From
  Favorites".
- Behaviour change visible to players: starring one run of a recurring tournament
  stars every live run of that schedule; starring a cash table stars every table
  of that cash game. This is the requested "follow the game" behaviour.
- "Unstarred until running" clarification (for the Dan report): a saved favorite
  whose game has no live run is still saved (`fetchSavedFavorites` reads it); it
  simply has no row to light in the lobby until the game runs again.

---

## 9. Functional And Architectural Decisions (status)

| Decision | Status |
|---|---|
| Identity per game (section 6) | implemented, native-proved, NOT in production |
| Server revisions, no device clocks | implemented, native-proved |
| Tombstones (unfavorite = active=false + new revision) | implemented |
| Reconciliation: first change accepted against a revision wins; a later change made against an older state is refused; device shows the account's value and "Changed On Another Device" | implemented |
| Owner-only writes (guard + revokes) | implemented, native-proved incl. service-role refusal |
| Deletion only via real account deletion | implemented (guard checks auth.users) |
| Security model: a database superuser can still act for any account (documented in the migration header); service_role cannot write these rows | documented |
| No background default-writes | implemented, pinned in law test |
| Cash status filter not overwritten by section toggle | implemented, pinned |
| Legacy carry-forward with report | implemented in migration; production counts NOT yet read |

---

## 10. Exact Current State (21:20 UTC)

- Branch `fix/lobby-favorites-follow-the-game`, pushed head `fdd07b1cc` (+ this
  handoff commit if its push succeeded; check `git ls-remote`).
- Working tree clean apart from this handoff.
- CI on `fdd07b1cc` at 21:17 UTC: "Lobby favorites and filters are durable"
  SUCCESS, "Money trigger declaration authority" SUCCESS, "Production Build"
  SUCCESS, Server Engine shards running, others pending. The handoff commit (docs
  only) restarts the run on the new head.
- A local full `npx vitest run tests/` hit its 50-minute timeout without a
  summary: result UNKNOWN. All 285 component test files (3,132 tests) passed
  locally after the last fixes. CI is the authority.
- CI on `fdd07b1cc` FAILED in Client Unit Tests shard 6
  (`tests/components/ComponentPreferencePersistence.test.tsx`, and locally also
  `tests/components/playerCommandWorkspace.test.tsx` "keeps private roster search
  out of durable storage"). Both were test fakes that only knew the old direct
  write; both FIXED in the handoff commit (section 15).
- PR not merged. Migration NOT applied in production. Client NOT published.
- Background watchers in this session (`/tmp/claude-0/watch_pr2.py`, task
  b39pao7kl) die with this container; there is no other watcher. Do not create
  Claude scheduled tasks (CLAUDE.md 10.85).

---

## 11. Changed-File Ledger

| File | Status | Purpose | Verified | Committed |
|---|---|---|---|---|
| supabase/migrations/20261105183133_lobby_favorites_follow_the_game_not_the_row.sql | new | server design | native proof 42/42 local + CI | yes |
| scripts/ci/schema-manifest.d/lobby-favorites-follow-the-game.json | new | declare objects | CI phantom checks pass locally | yes |
| scripts/dev/test-lobby-favorites-postgres.sh | new | native proof | 42 PASS | yes |
| .github/workflows/lobby-favorites-are-durable.yml | new | run native proof in CI | SUCCESS on CI | yes |
| src/lib/preferenceSync.ts | new | save queue | unit tests | yes |
| src/lib/pagePreferenceSave.ts | new | page prefs via RPC | unit tests | yes |
| src/components/lobby/lobbyPreferenceSync.ts | new | lobby staging | unit tests | yes |
| src/components/lobby/lobbyFavorites.ts | rewritten | star door | unit tests | yes |
| src/components/common/PreferenceSaveStatus.tsx | new | save status UI | not visually reviewed | yes |
| src/components/lobby/AdvancedFilters.tsx | modified | stage changed fields | unit tests | yes |
| src/components/lobby/lobbyViewPrefs.ts | modified | same for view | unit tests | yes |
| src/pages/ClubHomePage.tsx | modified | wiring | tsc + unit | yes |
| src/components/quickactions/favoriteTables.ts | modified | Quick Join | unit | yes |
| src/hooks/usePlayerPreference.ts | modified | RPC save | unit | yes |
| src/lib/rosterWorkspace.ts | modified | RPC save | unit | yes |
| src/lib/tableSettingIntents.ts | modified | base on intent | unit | yes |
| src/lib/authUtils.ts | modified | allowExpired identity read | unit | yes |
| src/lib/mysteryBountyProjection.ts | formatter only | none | n/a | yes |
| tests/** (section 4) | new/modified | coverage and pins | passed locally per file | yes |
| tests/e2e/** (section 4) | new/modified | production proofs | syntax + unit-of-helper only; NOT run against production | yes |
| docs/changelog/2026-11-05-lobby-favorites-follow-the-game.md | new | record | n/a | yes |
| docs/laws.d/lobby-favorites-follow-the-game.md | new | law registry | law-registry test | yes |
| docs/HANDOFF-2026-11-05-lobby-favorites-durable.md | new | this file | n/a | see 10 |

No unrelated user changes in the tree.

---

## 12. Asset Ledger

No image assets were created or changed. N/A.

---

## 13. Commands And Tools Used (important ones)

- Native proof (local): `PG_BIN=/usr/lib/postgresql/16/bin TMPDIR=/tmp/lfp bash
  scripts/dev/test-lobby-favorites-postgres.sh` (run as a non-root user; needs a
  local Postgres binary). Result 42 PASS.
- Unit tests: `npx vitest run <files>`; full: `npx vitest run tests/`.
- Type checks: `npx tsc --noEmit` and `npx tsc -p tsconfig.node.json --noEmit`:
  both exit 0 on the redesign.
- Invariant scripts (all exit 0 locally): every `node scripts/ci/check-*.mjs` in
  ci.yml's "TypeScript compilation and repository checks" job plus
  `report-source-grep-tests.mjs --ratchet`. `assert-money-trigger-protection.mjs`
  fails locally only with "Wrong Club Arena repository identity" (needs CI env;
  not a real failure).
- Push: `git push origin HEAD:fix/lobby-favorites-follow-the-game </dev/null`
  (pre-push hook runs tests; takes minutes).
- CI reads (REST): `gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/commits/<sha>/check-runs?per_page=100&filter=latest"`
  and job logs `gh api repos/.../actions/jobs/<job_id>/logs`.
- Production reads: Supabase MCP `execute_sql` on project `kuklfnapbkmacvwxktbh`,
  READ-ONLY SELECTs only. One check confirmed no database function writes
  `user_page_preferences` or `user_lobby_filters` (so the new guard breaks no
  server path).

---

## 14. Verification And Test Results

| Verification | Method | Result | Follow-up |
|---|---|---|---|
| Native DB proof | script, local PG16 and CI PG17 | 42/42 PASS; CI SUCCESS on fdd07b1cc | none |
| Law test (16) | vitest | PASS | none |
| App scenarios (18) | vitest, 5 consecutive runs | PASS | none |
| tsc app + node | tsc | exit 0 | none |
| Repo invariant scripts | node scripts | exit 0 (except identity-only one) | CI authoritative |
| Required check "TypeScript Check" | CI | FAILED on b985bac (byte-count window in law test), FIXED in 80e1cc9 | confirm green on new head |
| Client Unit Tests | CI | FAILED on 80e1cc9 (roster read test storage leak) and 12a1528 (roster operations test storage leak); both FIXED | confirm green on new head; 4 shards were cancelled on 12a1528 so their status on current code is UNKNOWN until this run completes |
| CSS Beat E2E | CI | "failed" on b985bac only because it was cancelled by a newer push | confirm green |
| Production Build | CI | SUCCESS on fdd07b1cc | none |
| Server Engine | CI | running at handoff | confirm |
| Full local suite | vitest tests/ | UNKNOWN (still running at handoff) | rely on CI |
| Production browser proofs | lobby-ui-proof.yml dispatch | NOT RUN (must run after merge and publish) | Phase 5 |
| Production DB verification | rolled-back DO block (Appendix A) | NOT RUN (needs migration installed) | Phase 5 |
| Migration report counts in production | SELECT | NOT RUN | Phase 4 |
| Visual review of save status pill | none | NOT DONE | optional screenshot in Phase 5 |

Infrastructure failures seen earlier (not this PR's): non-required checks
`retired-wallet-transfer` and `mutual-friends-unique` failed on `48757f4` because
postgresql.org downloads failed (curl 55) before any test ran. Commented on the PR.

---

## 15. Setbacks, Failed Approaches, And Lessons

- First design (commits up to `48757f4`) used "combination of current settings" as
  identity and device timestamps for ordering; Dan rejected both. Replaced by the
  redesign in `b985bac`.
- plpgsql "record new has no field" when one trigger serves tables with different
  columns: use nested IFs with `to_jsonb(NEW)->'col'`.
- Invalid uuid cast during backfill: guard with CASE + strict regex.
- Unfavorite through an alias created a duplicate row: update the aliased row.
- `tests/unit/noFixedSizeSourceWindows.test.ts` forbids `body.slice(0, N)` source
  windows in tests: use `tests/helpers/sourceWindow.ts` (`sliceSqlStatement`).
- The new device queue persists in localStorage, so any test file that only
  clears sessionStorage between cases leaks one case's choice into the next. Fix
  is `localStorage.clear()` in that file's beforeEach. Two files needed it; more
  may exist in shards that were cancelled. If a unit test fails with a search or
  filter value from another case, this is the cause.
- jsonb reorders object keys: compare preference values canonically
  (`samePreference` in `tests/e2e/support/preferenceSaveProof.ts`).
- A test that renders a page using page preferences now needs (a) the app's
  user store signed in as the owner (`useUserStore.setState({ user: { id } })`)
  and (b) a `supabase.rpc` fake that answers `fn_save_page_preferences` with
  `{ ok: true, results: [{ field, status: 'applied', revision, value }] }`.
  The global stub in `tests/setup.ts` returns `{ data: null }` for rpc, which
  the client correctly treats as an unconfirmed save, so the pending choice
  stays on the device. Pattern: `tests/components/ComponentPreferencePersistence.test.tsx`
  and the privacy case in `tests/components/playerCommandWorkspace.test.tsx`.
- `scripts/agent-push.sh` refuses non-worktree clones; plain `git push` with hooks
  works.
- GraphQL `gh` commands are blocked; use REST.
- A safety check blocked an `rm` inside `su -c`; avoid that pattern.

---

## 16. Known Defects And Architectural Holes

| Priority | Item | Evidence | Impact | Recommended action | Status |
|---|---|---|---|---|---|
| P1 | Other unit tests may leak localStorage like the two fixed ones | 4 shards cancelled on 12a1528 | red CI | read failing log; add `localStorage.clear()` in that file | open until CI green |
| P1 | Production proofs rewritten but never executed against production | Phase 5 not done | proofs might need small fixes | run them after publish; fix spec, not product, if the spec is wrong | open |
| P2 | While a roster workspace save is unconfirmed (offline, signed out, failing), the roster search sits in localStorage as a pending intent | `ca_table_setting_intent:<viewer>:page:roster:workspace:<club>` | private search on the device until the save confirms | SAME behaviour as main (verified by running the privacy test on main's code: main also keeps the intent until its save confirms; main's test only passed because its old write "succeeded" in the test stub). If Dan wants it never stored, strip `search` before `beginTableSettingIntent` in `src/lib/rosterWorkspace.ts` | pre-existing, not a regression |
| P2 | Old app versions in open tabs write via removed grants | REVOKE INSERT/UPDATE on old tables | an old tab's save fails (no data loss: the account keeps its value; old client shows its own state until reload) | accepted; players get the new bundle on reload | by design |
| P2 | Board (Spin/SNG) games renamed by an operator lose stars unless an alias row is added | identity includes name | star stays saved but lights nothing | add `lobby_game_aliases` row when renaming; document for operators | by design, documented |
| P2 | 13 historical `favorite_tables` deletions unrecoverable | deletion log cannot tell unstar from cascade | those stars are gone | report to Dan | final |
| P3 | Save status pill not visually reviewed | none | cosmetic | screenshot in Phase 5 | open |
| P3 | Superuser can act for any account | documented | accurate security model | none | documented |

---

## 17. Security, Secrets, And Credentials

- GitHub: `gh` CLI authenticated in the session (REST works). Needs repo write to
  merge and `repository_dispatch`.
- Supabase MCP connector for project `kuklfnapbkmacvwxktbh` (read-only use here).
- Production proof workflow creates its own isolated account via
  `scripts/ci/production-e2e-account.mjs`; secrets live in GitHub Actions (names
  such as `SP_EMAIL` are set by the workflow). No secret values were printed.
- Never use Dan's personal account. Service identity for scripts:
  `daniel@smarter.poker` (used only INSIDE the rolled-back verification block).

---

## 18. Database, Migration, And Seed Status

- Migration file: `supabase/migrations/20261105183133_lobby_favorites_follow_the_game_not_the_row.sql`.
  Version `20261105183133`. Reserved through the repo script. One transaction,
  `lock_timeout 3s`. No `@install-window` header (does not lock clubs / tables /
  hand_history; creates functions with row-type parameters and alters only
  `user_lobby_filters` / `user_page_preferences`).
- Applied in production: NO.
- Rollback: not scripted. The migration only adds objects, columns (with defaults),
  triggers and revokes; legacy sources are untouched, so the old data remains if a
  revert is ever needed.
- Seeds: none. Backfill runs inside the migration and is idempotent by PK
  (`ON CONFLICT`).
- After install, read back:
  `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '20261105183133';`
  `SELECT outcome, kind, count(*) FROM public.lobby_favorites_migration_report GROUP BY 1,2;`
  Expected roughly: tournament mapped 19 + duplicates 6, cash mapped 12,
  unresolved 0 (counts may have moved since this morning; report the real ones).
  Do NOT use MCP `list_migrations` (it runs DDL).

---

## 19. Current Blockers And Decision Points

- No decision needs Dan. Approval to merge, deploy and verify was given.
- Technical gate: required checks on the PR's current head must be green.
- Timing gate: no migration dispatch between :50 and :03 UTC (database refuses).

---

## 20. Remaining Work

Critical
1. Get all required checks green on the PR's current head (fix real failures).
2. Squash-merge PR #9552.
3. Dispatch and verify the migration in production; read the report counts.
4. Verify the client publish (both build-info endpoints show the merge commit).
High
5. Run production proofs: `verify-tournament-favorites`, `verify-lobby-filters`,
   `verify-lobby-ui`.
6. Run the rolled-back production verification block (Appendix A).
7. Closeout report to Dan (plain English, "Phase 6 of 6 is done").
Medium
8. Optional: screenshot of the save status pill.

---

## 21. Prioritized Next-Phase Execution Plan

Phase 0: recover state. Clone, checkout the branch, read CLAUDE.md, PUBLISHING.md,
this file. Read the PR head and checks (section 22). Done when you know which
checks are green, running or red.

Phase 1: finish checks. For each red required check, read the job log. Real
failures: fix in the branch with the passing test in the same commit; push with
hooks. Infrastructure failures (downloads, runner loss): re-run the job once
(`gh api -X POST repos/.../actions/jobs/<id>/rerun`) and note it on the PR.
Required checks: TypeScript Check; Client Unit Tests (vitest); Server Engine
(typecheck + tests); Production Build; CSS Beat E2E (multi-table + animations);
Money trigger declaration authority. Also keep "Lobby favorites and filters are
durable" green. Done when all are success on the same head.

Phase 2: merge. REST squash merge with the exact head:
`gh api -X PUT repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/9552/merge -f merge_method=squash -f sha=<head sha>`.
Record the merge commit.

Phase 3: database. Check `date -u`: not :50-:03. Check whether Apply Merged
Migration already ran for this file (Actions list for apply-merged-migration.yml).
If not, dispatch once:
`gh api -X POST repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/dispatches -f event_type=apply-merged-migration -f "client_payload[migration]=<value>" -F "client_payload[dry_run]=false"`.
The exact `<value>` format (bare filename vs `supabase/migrations/...` path) is
UNVERIFIED: read `.github/workflows/apply-merged-migration.yml` around
`MIGRATION_FILE` and a recent successful run's payload before sending. Wait for
the run to finish; read back schema_migrations and the report counts (section 18).
Never apply by hand or via MCP.

Phase 4: client. Wait for `publish-club-arena.yml` on the merge commit to succeed;
verify `https://ca-static.smarter.poker/build-info.json` and
`https://smarter.poker/hub/club-arena/build-info.json` show a revision containing
the merge (a newer main revision that contains it is fine).

Phase 5: production verification.
- Dispatch the proofs (one at a time, read each result):
  `gh api -X POST repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/dispatches -f event_type=verify-tournament-favorites`
  then `verify-lobby-filters`, then `verify-lobby-ui`. They run from main with an
  isolated account created and cleaned up by the workflow. If one fails, read the
  Playwright attachment/log; if the spec is wrong about the new path, fix the spec
  in a follow-up PR (merged is not landed: CLAUDE.md 10.82).
- Run Appendix A in ONE `execute_sql` call. The expected outcome is an ERROR whose
  text starts `VERIFY-RESULT` with `"failed": []`. If it returns success, it
  COMMITTED: inspect and undo deliberately. If it errors for a syntax or column
  reason, fix the block and run once more (it is fully rolled back).
- Check legacy carry-over: favorites rows exist for the players who had legacy
  stars (`SELECT kind, count(DISTINCT user_id), count(*) FROM
  player_lobby_favorites WHERE active GROUP BY 1`).

Phase 6: closeout report to Dan, plain English: what was wrong, what changed,
that it is live (only if verified), production verification results, legacy
carry-over counts (mapped, duplicates, unresolved, and the 13 unrecoverable
historical cash stars), anything left. Include the PR link; keep SHAs out of the
main text.

---

## 22. Exact First Actions For The Next Agent

1. `git clone https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena.git && cd Smarter-Poker-Club-Arena && git checkout fix/lobby-favorites-follow-the-game`
2. Read `CLAUDE.md`, `PUBLISHING.md`, this file, and
   `docs/changelog/2026-11-05-lobby-favorites-follow-the-game.md`.
3. `gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/9552 -q '.head.sha, .state, .merged'`
4. `gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/commits/<head>/check-runs?per_page=100&filter=latest" -q '.check_runs[]|"\(.status) \(.conclusion) \(.name)"' | sort`
5. Red check: `gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/jobs/<job id>/logs | grep -E "FAIL |error"`.
6. Do NOT edit the migration file. Do NOT apply it by hand. Do NOT force-push.
7. Resume at section 21, Phase 1.

---

## 23. Acceptance Criteria

- All required checks green on the merged head; PR merged by squash.
- `schema_migrations` holds 20261105183133; the new tables/functions exist; report
  counts read and reported; unresolved = 0 or each listed.
- Both build-info endpoints serve a revision that contains the merge.
- Production proofs `verify-tournament-favorites` and `verify-lobby-filters` pass;
  `verify-lobby-ui` passes.
- Appendix A returns `VERIFY-RESULT` with an empty `failed` list.
- A player's star survives reload, relogin and a second device; an unfavorite
  survives reload; a filter survives reload and a fresh device; no default or stale
  value overwrites a newer choice.
- Dan receives a plain-English closeout report.

---

## 24. Recommended Commit Strategy

- Any CI fix: one commit per cause, test fix in the same commit as the cause, e.g.
  `test(<area>): start each case as a fresh device`.
- Proof fixes after merge (if needed): new branch from main, e.g.
  `test(lobby): <proof> follows <what>`; separate PR.
- Closeout notes, if any, appended to the existing changelog file in that PR.

---

## 25. Final Continuation Summary

Stopping point: PR #9552 complete and pushed; required checks running on the
latest head; nothing merged; nothing in production. Work first on getting the
checks green and merging. Locked requirements: preferences change only by the
owner or real account deletion; identity follows the game; server revisions, never
device clocks; "Saved" only after the account acknowledges. Greatest technical
risk: another test leaking device storage in a not-yet-run shard. Greatest
data-integrity risk: installing the migration any way other than Apply Merged
Migration from main. Greatest visual risk: none significant (one small status
pill). No decision requires Dan. Continue from section 21 Phase 1; every discovery
needed is in this file and the changelog, so do not restart the investigation.

---

## Appendix A: production verification (ONE execute_sql call, always rolled back)

Run only after the migration is installed. An ERROR starting `VERIFY-RESULT` is
the success case; read its `failed` list.

```sql
DO $verify$
DECLARE
  live text[] := ARRAY['ANNOUNCED','REGISTERING','RUNNING','LATE_REG','STARTING_SOON','BAGGED'];
  a uuid; b uuid;
  sched uuid; sched_run uuid; sched_live int;
  cash_tbl uuid; cash_cluster uuid; cash_live int;
  board_run uuid; club uuid;
  r jsonb; rev_sched bigint; rev_unstar bigint; n int; st text;
  out jsonb := '{}'::jsonb;
  failed text[] := '{}';
BEGIN
  SELECT id INTO a FROM auth.users WHERE email = 'daniel@smarter.poker';
  SELECT u.id INTO b FROM auth.users u WHERE u.id <> a
     AND NOT EXISTS (SELECT 1 FROM public.player_lobby_favorites f WHERE f.user_id = u.id)
   ORDER BY u.created_at LIMIT 1;
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'VERIFY-ABORT no accounts'; END IF;
  SELECT t.schedule_id, count(*) INTO sched, sched_live FROM public.tournaments t
   WHERE t.schedule_id IS NOT NULL AND t.status = ANY(live) GROUP BY 1 ORDER BY 2 DESC LIMIT 1;
  SELECT id INTO sched_run FROM public.tournaments WHERE schedule_id = sched AND status = ANY(live)
   ORDER BY start_time LIMIT 1;
  SELECT tb.cluster_id, count(*) INTO cash_cluster, cash_live FROM public.tables tb
   WHERE tb.cluster_id IS NOT NULL AND tb.tournament_id IS NULL AND tb.is_deleted IS NOT TRUE
     AND coalesce(tb.is_template,false) = false AND coalesce(tb.status,'') <> 'closed'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 1;
  SELECT id, club_id INTO cash_tbl, club FROM public.tables WHERE cluster_id = cash_cluster
     AND tournament_id IS NULL AND is_deleted IS NOT TRUE AND coalesce(is_template,false) = false
     AND coalesce(status,'') <> 'closed' LIMIT 1;
  SELECT t.id INTO board_run FROM public.tournaments t
   WHERE t.schedule_id IS NULL AND upper(coalesce(t.tournament_type,'')) IN ('SPIN','SNG')
     AND t.status = ANY(live) AND public.fn_lobby_tournament_key(t) LIKE 'board:%' LIMIT 1;
  out := out || jsonb_build_object('schedule_live_runs', sched_live, 'cash_live_tables', cash_live,
                                   'board_found', board_run IS NOT NULL);
  SELECT count(DISTINCT public.fn_lobby_cash_key(tb)) INTO n FROM public.tables tb WHERE tb.cluster_id = cash_cluster;
  IF n <> 1 THEN failed := failed || 'cash tables of one game have one identity'; END IF;

  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  r := public.fn_set_lobby_favorites(jsonb_build_array(
    jsonb_build_object('kind','tournament','game_id',sched_run,'on',true,
      'base',(SELECT max(revision) FROM public.fn_my_lobby_favorites() f WHERE f.game_id = sched_run)),
    jsonb_build_object('kind','cash','game_id',cash_tbl,'on',true,
      'base',(SELECT max(revision) FROM public.fn_my_lobby_favorites() f WHERE f.game_id = cash_tbl))
  ) || CASE WHEN board_run IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
    jsonb_build_object('kind','tournament','game_id',board_run,'on',true,
      'base',(SELECT max(revision) FROM public.fn_my_lobby_favorites() f WHERE f.game_id = board_run))) END);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'results') e WHERE e->>'status' <> 'applied') THEN
    failed := failed || ('star applied: ' || (r->'results')::text);
  END IF;
  SELECT count(*) INTO n FROM public.fn_my_lobby_favorites() f
   JOIN public.tournaments t ON t.id = f.game_id WHERE f.active AND t.schedule_id = sched;
  out := out || jsonb_build_object('schedule_runs_starred', n);
  IF n <> sched_live THEN failed := failed || 'every live run of the recurring tournament starred'; END IF;
  SELECT count(*) INTO n FROM public.fn_my_lobby_favorites() f
   JOIN public.tables tb ON tb.id = f.game_id WHERE f.active AND tb.cluster_id = cash_cluster;
  out := out || jsonb_build_object('cash_tables_starred', n);
  IF n <> cash_live THEN failed := failed || 'every live table of the cash game starred'; END IF;
  IF board_run IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.fn_my_lobby_favorites() f WHERE f.active AND f.game_id = board_run;
    IF n <> 1 THEN failed := failed || 'on-demand board starred'; END IF;
  END IF;

  SELECT revision INTO rev_sched FROM public.fn_my_lobby_favorites() WHERE game_id = sched_run;
  r := public.fn_set_lobby_favorites(jsonb_build_array(
    jsonb_build_object('kind','tournament','game_id',sched_run,'on',false,'base',rev_sched)));
  IF r->'results'->0->>'status' <> 'applied' THEN failed := failed || 'explicit unfavorite applied'; END IF;
  rev_unstar := (r->'results'->0->>'revision')::bigint;
  r := public.fn_set_lobby_favorites(jsonb_build_array(
    jsonb_build_object('kind','tournament','game_id',sched_run,'on',true,'base',rev_sched)));
  IF r->'results'->0->>'status' <> 'conflict' OR (r->'results'->0->>'active')::boolean THEN
    failed := failed || 'a stale offline star cannot undo an unfavorite';
  END IF;
  r := public.fn_set_lobby_favorites(jsonb_build_array(
    jsonb_build_object('kind','tournament','game_id',sched_run,'on',false,'base',rev_sched)));
  IF r->'results'->0->>'status' <> 'conflict' OR (r->'results'->0->>'revision')::bigint <> rev_unstar THEN
    failed := failed || 'a duplicate reply changes nothing';
  END IF;
  SELECT count(*) INTO n FROM public.fn_my_lobby_favorites() f
   JOIN public.tournaments t ON t.id = f.game_id WHERE NOT f.active AND t.schedule_id = sched;
  IF n <> sched_live THEN failed := failed || 'unfavorite kept as a record for every run'; END IF;

  r := public.fn_save_lobby_preferences(club, jsonb_build_array(
    jsonb_build_object('field','filters.ZZVERIFY','value',jsonb_build_object('seatMin',4))));
  st := r->'results'->0->>'status';
  IF st IS DISTINCT FROM 'applied' THEN failed := failed || ('filter applied: ' || coalesce(st,'null')); END IF;
  r := public.fn_save_lobby_preferences(club, jsonb_build_array(
    jsonb_build_object('field','filters.ZZVERIFY','value',jsonb_build_object('seatMin',2))));
  IF r->'results'->0->>'status' <> 'conflict' OR r->'results'->0->'value'->>'seatMin' <> '4' THEN
    failed := failed || 'a stale filter snapshot is refused and the newer one kept';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.fn_my_lobby_favorites();
  IF n <> 0 THEN failed := failed || 'another account reads nothing of A'; END IF;
  BEGIN
    INSERT INTO public.player_lobby_favorites (user_id, kind, game_key, active, revision)
    VALUES (a, 'tournament', 'tournament:' || gen_random_uuid(), true, 1);
    failed := failed || 'a write for another account is refused';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.user_lobby_filters SET filters = '{}'::jsonb WHERE user_id = b;
    failed := failed || 'players cannot write filter rows directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.player_lobby_favorites SET active = false WHERE user_id = b;
    failed := failed || 'players cannot write favorite rows directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  BEGIN
    DELETE FROM public.player_lobby_favorites WHERE user_id = a;
    IF FOUND THEN failed := failed || 'only account deletion removes records'; END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  out := out || jsonb_build_object('failed', to_jsonb(failed));
  RAISE EXCEPTION 'VERIFY-RESULT %', out;
END
$verify$;
```

Notes on Appendix A: never run (UNVERIFIED syntax against production); the
`'filters.ZZVERIFY'` field name may be refused as "invalid" if the function
restricts filter keys to known categories: if `filter applied: invalid` appears,
replace `ZZVERIFY` with a real category such as `HOLDEM` (the block is rolled
back, so nothing persists either way). `SET LOCAL ROLE authenticated` requires the
MCP role to be a member of `authenticated` (it normally is on Supabase).
