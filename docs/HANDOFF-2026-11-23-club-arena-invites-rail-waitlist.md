# MILITARY-GRADE CONTINUATION HANDOFF

## Club Arena: invites, private seat holds, unregister, waiting lists, top chairs on the rail, engine-cycle election fix

Written 2026-11-23 about 02:15 America/Chicago (08:15 UTC) by the Claude session
`https://claude.ai/code/session_01BbZPDjyFT9YrX6o9MG1id7` (chat "Poker app share,
unregister, and layout bugs"). Everything below marked CONFIRMED was read from
GitHub, the live endpoints or the repository at the time of writing. Anything not
read is marked UNVERIFIED or UNKNOWN.

All times: Chicago = UTC-6 (CST). The engine cutover clock is America/Chicago.

---

## 1. Executive Continuation Brief

**What is being built.** Fixes and enhancements to Club Arena, the online poker
app at `https://smarter.poker/hub/club-arena/`. It has a Vite/React client, a
Node poker engine on Hetzner and a Supabase/Postgres database. The owner is Dan
Bekavac (founder, solo builder). Players include AI players called **horses**,
never "bots".

**What the work covers (three owner messages, all in this chat):**

1. **First message (2026-11-22, early afternoon Chicago), six items:**
   - Share and invite links for Spins, Sit & Gos, Satellites, Heads Up and MTTs
     were broken. In the "crazy river" glitch, an invite landed on a table with a
     horse already seated and never opened a new table.
   - Players must be able to unregister from a Sit & Go, Heads Up or Spin before
     it starts.
   - The Register and Unregister buttons must be the same size and style and
     never cut off.
   - Horses must join waiting lists, and a game is never "full with no waiting
     list". There is always either a list or one open seat (NLH called out).
   - The 6-max top villain must always stand on the rail, never on the felt. The
     head may be cut off at the top or under the action bar.
   - Then root-cause each fix and harden it so it cannot regress.
2. **Fourth message (2026-11-22 evening):** "FINISH UP ANY AND ALL UNFINISHED
   WORK, AND THEN GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE
   SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS. YOU DECIDE THE
   BUILD ORDER. LAUNCH A SWARM IF IT WILL HELP." This was broken into four phases:
   - Phase 1: private invite games, a seat held for a friend that no horse can take.
   - Phase 2: tournament links carry the club code, a join flow for non-members,
     and the in-app invite sent by the server.
   - Phase 3: top chairs on the rail for every ring size.
   - Phase 4: waiting lists keep a player's place under the hourly table cap, a
     human filling a game asks for a line at once, and closing tables get a line.
3. **2026-11-23 01:02 Chicago:** the same message re-sent, then "IS EVERYTHING
   DONE". That led to two more pieces of work:
   - Phase 1 extended to Sit & Gos (#11839).
   - A real defect in the three-hourly engine release scheduler that skipped the
     01:00 Chicago engine update (PR #11836, still open).

**Current phase.** Every code change is written. All but one are merged. The
remaining work is delivery and verification:

- **(a)** The 04:00 Chicago engine cutover (10:00 UTC, 2026-11-23) must carry the
  engine parts of #11805, #11808 and possibly #11839. Verify it.
- **(b)** The window migration `20261123013136` (the database trigger that
  refuses a held seat to strangers) must install in that 04:00 window. Verify it.
- **(c)** The Sit & Go migration `20261123071654` is held until about 04:15
  Chicago by the nightly schema freeze. Verify it installs.
- **(d)** Merge PR #11836 (scheduler fix) only AFTER the 04:00 cycle seals and
  BEFORE 04:50 Chicago, when the 07:00 cycle's reservation window opens.
- **(e)** Verify live and audit everything for regressions (section 20).

**The single most important thing to understand.** Engine (server) changes do
NOT go live on merge. They go live only at a certified three-hourly engine
cutover (01, 04, 07, 10, 13, 16, 19, 22 Chicago). Each cutover is prepared 30
minutes before the hour by `.github/workflows/stage-engine-release.yml` and
ships only a revision the Backup engine has certified. Client changes publish
within about 10 minutes of merge. Migrations install through the merged-
migration dispatcher, which holds them during cutover windows and the nightly
schema freeze (23:45 to 04:15 Chicago). Window migrations (`-- @install-window:
daily-maintenance`) install only at the 04:00 Chicago break.

**First action for the next agent.** Run the Phase 0 checks in section 22
exactly. They tell you whether the 04:00 cutover sealed, what the engine now
serves, whether the three migrations installed, and whether PR #11836 can be
merged now.

---

## 2. User Requirements And Working Preferences (binding)

### Dan's words, verbatim where it matters

- First message (verbatim): "THE SHARE BUTTON FUNCTIONALITY INSIDE OF THE SPINS,
  SIT N GO'S, SATELLITES HEADS UP AND MTT'S ISN'T WORKING PROPERLY. I NEED YOU TO
  DO A DEEP DIVE ON THE ENTIRE CODE BASE AND FIX ANY AND ALL ISSUES THAT YOU FIND.
  CHECK FOR ANY AND ALL BUGS, GAPS, STUBS, ERRORS, REGRESSIONS OR WIRING ISSUES
  ANYWHERE AND EVERYWHERE. READ THE ATTACHED SCREEN SHOT AND FIX THIS WEIRD GLITCH
  THAT IS HAPPENING WHEN THEY INVITE. ALSO PLAYERS NEED TO BE ABLE TO "UNREGISTER"
  FROM A SIT N GO, HEADS UP OR SPIN IF IT HASN'T STARTED YET. (SEE ERROR MESSAGE
  THAT COMES UP WHEN YOU TRY TO UNREGISTER 1ST ATTACHED SCREEN SHOT) GO THROUGH
  EVERYTHING INSIDE THIS FUNCTIONALITY AS WELL TO INSURE THAT ITS FULLY FIXED,
  UPDATED AND ENHANCED. THEN ONCE YOU ARE COMPLETED AND VERIFIED THAT EVERY SINGLE
  FIX WAS HARD CODED AND FIXED (WITHOUT PATCHES) YOU NEED TO GO BACK THROUGH EACH
  ONE, FIGURE OUT WHY IT BROKE AND HOW. THEN HARDEN EACH AND EVERY ONE OF THE
  ISSUES THAT YOU FIXED SO THEY CAN'T BREAK OR REGRESS AGAIN! (SEE 2ND ATTACHED
  IMAGE). 2, THE REGISTER / UNREGISTER BUTTON NEED TO BE THE SAME SIZE AND STYLE,
  AND SHOULD NEVER BE CUT OFF. (SEE 3RD ATTACHED SCREEN SHOT). 3, Horses need to
  join waiting lists. All games should not be "full with no waiting lists in fact
  there should always be one- seats open if there is no waiting lists correct that
  logic and functionality for No Limit Holdem games. MAKE SURE THIS FUNCTIONALITY
  IS FULLY UPDATED AND CORRECTED. 4, IN THE 6 MAX GAMES THE TOP VILLAIN (the_doc)
  IS TO LOW ON THE TABLE! THEY MUST 100% OF THE TIME BE ON THE RAIL AND NEVER ON
  TOP OF THE TABLE OR OVERA LAPPING THE FELT. THE TOP OF THAT VILLAINS HEAD CAN BE
  "CUT OFF" AT THE TOP OR "UNDER THE ACTION BAR" WITH THE ACTION BAR BEING LAYER 1
  AND THE AVATAR LAYER 2. BUT THE CURRENT LAYOUT IS BROKEN. KEEP EVERYTHING ELSE
  EXACTLY THE SAME. (SEE 4TH ATTACHED IMAGE)"
- "ONCE YOU ARE COMPLETED AND VERIFIED THAT EVERY SINGLE FIX WAS HARD CODED AND
  FIXED (WITHOUT PATCHES) YOU NEED TO GO BACK THROUGH EACH ONE, FIGURE OUT WHY IT
  BROKE AND HOW. THEN HARDEN EACH AND EVERY ONE OF THE ISSUES THAT YOU FIXED SO
  THEY CAN'T BREAK OR REGRESS AGAIN!"
- "DO NOT ASK ME TO TELL YOU THINGS, IF YOU KNOW WHAT TO DO AND FIX IT, JUST DO IT!
  SAVE THAT TO MEMORY AND FINISH THE JOB. PUSH, MERGE AND PUBLISH ALL FOUR FIXES LIVE"
  (saved to memory `/preferences.md`).
- "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY BUILD, FIX
  AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE
  CLAIMING SUCCESS. YOU DECIDE THE BUILD ORDER. LAUNCH A SWARM IF IT WILL HELP."
  (sent twice)
- "STOP SLEEPING AND FINISH THIS JOB UP NOW." He does not want long idle polling
  loops. Keep driving work forward and use waiting time productively.
- "IS EVERYTHING DONE, AND WE Can close this chat?" He wants an honest yes or no.
- The handoff request: give everything, including a regression check and
  bookmarks for where code changes began and ended.

### Standing preferences (from his memory, apply silently)

- You are lead PM with full execution authority. Announce the plan and execute.
  Only surface genuinely irreversible product decisions.
- Never ask Dan to do a job you can do: merging your own PRs, waiting on checks,
  verifying live. Never ask him for approval texts. "You own this code base."
- Report in plain English. Do not make commit SHAs, statistics or internal ids the
  main content of a report to him.
- No unverified data. Do not claim success until everything is verified finished.
- Large builds: use parallel agents when it helps, stay inside scope, no side
  work. Work in numbered phases and report "Phase N of X is done".
- On the owner's Mac, work trees go on the external SSD, and you delete your
  work tree when done.

### Non-negotiable product laws touched by this work (CLAUDE.md)

- **10.5 Horses are players.** Never branch on `is_horse` to deny or give a
  different deal. A horse is refused a held seat by exactly the same rule as a
  human stranger.
- **10.6 Animations always play; never auto-change tables.** Sanctioned
  exceptions: a waiting-list seat offer opens its table, and tournament
  registration opens its assigned game.
- **10.7c Phone avatars never shrink.** `src/components/table/mobileAvatarSize.ts`
  sizes are a floor. No stored sizes, no ratchets, no sizes taken from a moment
  of play.
- **10.11 / 10.12 Fix at the root.** No repair crons, sweeps, back-fills or
  monitors presented as fixes.
- **Popup text.** First Letter Of Every Word Capitalized, no em dashes, no emoji.
- **Production DDL policy (CLAUDE.md section 2).** One BEGIN/COMMIT per migration.
  Versions come only from `node scripts/new-migration.mjs "what it does"`. No DDL
  probes against production. A hot-table lock needs `-- @install-window:
daily-maintenance`. Migrations reach production only from protected main.
- **11.5.** Never spend real chips to test a rule. Probe in a self-rolling-back
  transaction.

---

## 3. Project And Repository Identity

| Item                          | Value                                                                                                                                                                                              | Status                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Project                       | Club Arena (Smarter.Poker)                                                                                                                                                                         | CONFIRMED                           |
| Club Arena repo               | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena` (renamed from `Smarter-Poker/...`; the old path redirects)                                                                                         | CONFIRMED                           |
| World Hub repo                | `Smarter-Poker/Smarter-Poker-World-Hub` (Next.js 14 pages router, hosts `smarter.poker`, rewrites `/hub/club-arena/*` to `https://ca-static.smarter.poker`)                                        | CONFIRMED                           |
| Cloud working clone used here | `/home/claude/smarter-poker-club-arena` (SHALLOW clone; local branch `main` stale at `7591e6ea4`; always use `origin/main`)                                                                        | CONFIRMED                           |
| Worktrees used here           | `/home/claude/wt/*`, all REMOVED after merge (none remain)                                                                                                                                         | CONFIRMED                           |
| World Hub clone used here     | `/home/claude/smarter-poker-world-hub`, DELETED                                                                                                                                                    | CONFIRMED                           |
| Owner's Mac shared clone      | `~/Documents/club-arena` (NEVER commit, checkout or stash there: CLAUDE.md 10.87)                                                                                                                  | from instructions                   |
| origin/main at writing        | `08e32e4ad` or later (main moves every few minutes)                                                                                                                                                | CONFIRMED                           |
| Client                        | Vite + React 19 + TS in `src/`; published by `.github/workflows/publish-club-arena.yml` to the Hetzner static origin; live proof `https://smarter.poker/hub/club-arena/build-info.json` (`ca_sha`) | CONFIRMED                           |
| Engine                        | Node/TS in `server/src`; Hetzner engine-01 `engine.smarter.poker`; live proof `https://engine.smarter.poker/health` (`releaseSha`)                                                                 | CONFIRMED                           |
| Database                      | Supabase Postgres, project id `kuklfnapbkmacvwxktbh`                                                                                                                                               | CONFIRMED (id from earlier context) |
| World Hub hosting             | Vercel project `hub-vanguard`; live proof `https://smarter.poker/api/health` (`commitSha`)                                                                                                         | CONFIRMED                           |
| Package manager               | npm (`npm ci`)                                                                                                                                                                                     | CONFIRMED                           |
| Push helper                   | `bash scripts/agent-push.sh` from an owned worktree (never the shared clone)                                                                                                                       | CONFIRMED                           |
| Merge method used             | REST `PUT /repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/{n}/merge` with `merge_method=squash` and the head `sha`                                                                      | CONFIRMED                           |

---

## 4. Repository Map (only what this work touched or depends on)

### Invites, links, shares (client)

- `src/lib/share.ts`: the one share door. `tableInviteTarget` decides link vs
  table. `tournamentShareUrl(id, { inviteCode })` adds `?i=`. Modified (#11772,
  #11803).
- `src/lib/inviteCode.ts`: normalises the 7-char club code. Modified (#11803).
- `src/lib/mustMoveInviteRouting.ts`: `parseTableInviteParams` and
  `parseTournamentInviteParams`. The join detour keeps `invite` and `i`.
  Modified (#11772, #11803).
- `src/lib/nextOpenGame.ts` (new, #11772): if a linked game has filled or
  started, finds the open game of the same board.
- `src/components/table/InviteLandedLateOverlay.tsx`: "This Game Is Full And
  Already Started. A New One Is Open Now." (#11772)
- `src/components/table/OnlineFriendInvitePicker.tsx`,
  `src/services/NotificationService.ts`: the crossed `i`/`invite` params were
  fixed in #11772.
- `src/services/TableInviteService.ts`: in-app invites call RPC
  `fn_send_game_invite` (#11803).
- `src/hooks/useSenderInviteCode.ts` (`useTournamentSenderInviteCode`) (#11803).
- `src/components/tournament/TournamentClubJoinGate.tsx` and `.css`: a signed-in
  non-member arriving with `i` joins the club, then returns to the tournament
  (#11803).
- `src/pages/MultiTablePage.tsx`: an invite arrival keeps its table and is not
  stolen by restore (#11772).
- World Hub `pages/t/[id].js`, `src/lib/sharedTournamentLink.js`,
  `__tests__/shared-tournament-links.test.mjs`: `/t/` forwards `i` and `invite`
  (World Hub #2909, `d42e5f0`, LIVE).

### Unregister and Register/Unregister button (client + SQL)

- `supabase/migrations/20261122192807_a_sit_and_go_is_unregistered_until_it_actually_starts.sql`:
  a new start authority `sit_and_go_actual_start` for every non-Heads-Up `sng-v1`
  event, in the chip core `fn_ca_unregister_tournament_player_exact` and the
  Diamond door `fn_poker_diamond_tournament_unregister`. Edited by anchored
  replacement. INSTALLED 2026-11-22 22:45:59Z, after one failed attempt at
  22:10:03Z.
- `src/components/tournament/signUpDialog.tsx`,
  `src/pages/tournament/TournamentDetails.tsx` and `.css`: Register and
  Unregister are one button of the same size and style, never cut off.
- `scripts/dev/prove-sit-and-go-unregister-start-gate.sh`: native proof.

### Full game always has a waiting list (engine + client)

- `server/src/services/HorseLastChair.ts` (new, pure): the fleet never buys a
  game's last open chair unless a horse joins the list in the same cycle (#11773).
- `server/src/services/HorseFleetManager.ts`: wiring (#11773, #11805).
- `src/components/table/WaitlistCallToAction.tsx` and
  `src/components/table/ClusterWaitlistCallToAction.tsx`: "Table Full · N Seats
  Open In This Game / Join The Game" (#11773).

### A called name keeps its place, plus closing tables and immediate line (engine + SQL)

- `supabase/migrations/20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap.sql`:
  - `fn_cash_hourly_table_admit` and `fn_cash_hourly_table_admissions`: a call or
    a sanctioned move skips the arrival clock.
  - New `fn_cash_hourly_call_admissible(table, user)`.
  - `fn_offer_open_seat` passes over a player the cap would refuse without
    costing their place.
  - `fn_lightning_admission_policy` gains a 13th input.
  - INSTALLED 04:10:14Z.
- `server/src/cluster/cashSeatCommittedSignal.ts` (new),
  `server/src/services/HorseLineOnArrival.ts` (new): an immediate line ask when a
  person fills a game. Raised from
  `ServerTableEngine.noteSeatArrival` and `ServerTableEngineBase.adoptSeatRoster`.
- `server/src/services/HorseQueueAdmission.ts`: `hourlyAdmissionForWalk` gives a
  full table the cap is closing a line-only admission. This is the "closing
  tables" fix.
- `server/src/services/HorseGameQueue.ts`: patience never empties a full game's
  last name.
- `scripts/ci/test-a-called-name-keeps-its-place-postgres.py` (native proof,
  wired into `.github/workflows/ci.yml` behind the hourly cash caps proof step).

### Private seat holds for invited friends (SQL + engine + client)

- `supabase/migrations/20261123013126_a_private_game_holds_its_seats_for_invited_friends.sql`:
  - Tables `private_game_holds` and `private_game_admissions`.
  - New functions `fn_invite_to_private_game`, `fn_accept_private_game_invite`,
    `fn_cancel_private_game_hold`, `fn_private_game_hold_state`,
    `fn_private_game_live_holds`, `fn_private_game_entry_guard`,
    `fn_private_game_entry_refusal`, `fn_private_game_hold_deadline`,
    `fn_private_game_hold_view` and `fn_ca_private_game_hold_open`.
  - Redefines `fn_set_heads_up_wait_mode` and `fn_check_heads_up_seat_invite`.
  - Hold length: 10 minutes of open play, credited for freeze time.
  - INSTALLED 04:43:28Z.
- `supabase/migrations/20261123013136_a_held_seat_is_refused_to_anyone_but_its_invited_holder.sql`:
  attaches the guard trigger on `tournament_players`, with
  `-- @install-window: daily-maintenance`. NOT YET INSTALLED; queued for the
  04:00 Chicago window on 2026-11-23.
- `supabase/migrations/20261123071654_a_sit_and_go_holds_seats_for_invited_friends.sql`:
  CREATE OR REPLACE of `fn_invite_to_private_game` adding the Sit & Go branch
  (`sng-v1`, 4 to 9 seats, holds up to seats minus one, held in place). NOT YET
  INSTALLED: the dispatcher is holding it for the nightly schema freeze, so it
  installs around 04:15 Chicago.
- `server/src/services/privateGameHolds.ts`: reads live holds. Adds
  `sitAndGoCanHoldSeats`, `privateHeldOpenSeats`, `sitAndGoHorseRoom` and
  `heldSeats()` (#11839).
- `server/src/services/TournamentRecurringService.ts`:
  - The seat-first lane and `topUpWithHorses` respect holds.
  - `registerHorses` reads the Sit & Go hold before the union daily plan
    (#11839).
- `server/src/GameServer.ts`: wiring. `/health` publishes
  `privateSitAndGoHolds: 1` (#11839); the client gates the Sit & Go offer on it.
- `src/lib/privateGameInvite.ts`, `src/hooks/usePrivateGameInviteLauncher.tsx`
  (uses `useAppNavigate` from `src/context/InTabLobbyContext`, NOT
  `useNavigate`), `src/components/table/PrivateGameInviteModal.tsx`,
  `src/hooks/usePrivateSitAndGoHold.tsx` (new, #11839), and
  `src/services/TournamentService.ts` (`registerPlayer` asks
  `fn_accept_private_game_invite` before a Sit & Go purchase).
- Invite entry points: `src/pages/TablePage.tsx` (`handlePrivateTakeSeat` must
  stay AFTER the `useDialogEscape(seatFirstConfirm !== null, ...)` line because
  of a TDZ law), `src/pages/tournament/TournamentDetails.tsx`,
  `src/components/tournament/TournamentLobbyCard.tsx`,
  `src/components/lobby/LobbyTable.tsx` and
  `src/components/lobby/GameLobbyPanel.tsx`.
- `scripts/ci/test-private-game-holds-postgres.py` (72 checks after #11839),
  `scripts/ci/fixtures/private-game-holds/bootstrap.sql`,
  `.github/workflows/private-game-holds.yml`.
- `scripts/ci/schema-manifest.d/a-private-game-holds-its-seats.json`: declares
  the new objects to the phantom-reference gate.

### Top chairs on the rail (client)

- `src/components/table/topChairRail.ts`: replaces `sixSeatTopRail.ts` (deleted
  in #11804). It contains:
  - `topChairRailViewport(w, h)`, true for portrait 481 to 640px only (the phone
    reference layout);
  - `phoneReferenceLayout`, `topChairRest` (the 9-seat phone ring keeps centred
    plates), `sixSeatPhoneRail`, `topChairRailShift`, `topChairCaptionDrop` and
    `stationIsOnTheTopRail`.
- `src/hooks/useProtectedCardLayout.ts`: places top pods from the rail up.
- `src/components/table/opponentAvatarLayout.ts`: `railCapSeat`; the allocator
  never nudges a top chair.
- `src/components/table/mobileAvatarEnlargement.ts`: `topRailSeats`; the tab bar
  is drawn over rail-placed portraits, so they grow behind it instead of
  shrinking.
- `src/components/table/SeatSlot.css`: a comment change only in #11804. The
  6-max phone caption rule came from #11774.
- Browser guard: `tests/e2e/support/mobileLiveTableLayout.ts`,
  `readMobileTableLayout`, with "Top Seat ..." violations; `railViewport =
innerWidth > 480 && innerWidth <= 640 && innerHeight > innerWidth`. This guard
  is also the post-deploy live proof.
- `tests/e2e/support/topChairRailCases.ts`: 9 cases, all at 600px.
- `tests/e2e/support/observerAvatarSizingCases.ts`:
  `registerObserverAvatarSizingCases(family: 'artwork' | 'top-chair-rail')`.
- `tests/e2e/table-proportions.spec.ts`:
  - New top-level describe "every top chair stands on the rail" placed BEFORE
    the import of `registerAddOnNoticeContainmentCases`, ahead of the "cold
    observer and phone geometry" family (see setback S9 for why).
  - Crown assertions gated `if (width > 640)`.
  - The "six-seat compact crown proof" runs at 600x560 (landscape).
- Laws: `tests/every-top-chair-stands-on-the-rail.law.test.tsx`,
  `tests/the-six-max-top-seat-stands-on-the-rail.law.test.tsx` and
  `tests/two-top-chairs-sit-level.law.test.tsx`.

### Release scheduler fix (PR #11836, OPEN)

- `.github/workflows/stage-engine-release.yml`, admission step of job "Prove
  Whether The Server Tree Changed": a push run's moment is now its own
  `created_at` (`PUSHED_AT` removed).
- `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`
  (5 incident cases), `tests/operations/engine-release-recovery-window.py`, the
  `daily-engine-maintenance.law` harness, `docs/ENGINE-RELEASE-RUNBOOK.md`,
  `docs/laws.d/daily-preparation-does-not-wait-for-a-punctual-cron.md` and
  `docs/changelog/2026-11-23-a-reservation-is-elected-by-the-moment-it-claims.md`.

### Changelogs (one per change)

All under `docs/changelog/`:

- `2026-11-22-an-invite-opens-the-game-it-names.md`
- `2026-11-22-a-sit-and-go-is-unregistered-until-it-actually-starts.md`
- `2026-11-22-a-full-game-always-has-a-waiting-list.md`
- `2026-11-22-the-six-max-top-seat-stands-on-the-rail.md`
- `2026-11-22-a-tournament-link-carries-the-club.md`
- `2026-11-22-a-called-name-keeps-its-place.md`
- `2026-11-22-invite-to-game-holds-a-private-seat.md`
- `2026-11-22-every-top-chair-stands-on-the-rail.md`
- `2026-11-23-a-sit-and-go-holds-seats-for-invited-friends.md`
- `2026-11-23-a-reservation-is-elected-by-the-moment-it-claims.md` (in PR #11836)

---

## 5. Applicable Instructions And Constraints (reread before editing)

- Repository root: `CLAUDE.md`, `AGENTS.md`, `AGENT-PLAYBOOK.md`,
  `docs/agent-policy/REFERENCE-INDEX.md`, and `PUBLISHING.md` (push, PR, protected
  merge, live verification; PR body needs a `Lane:` line using an id from
  `ops/ownership.json`).
- Key CLAUDE.md sections:
  - The Nov 21 three-hourly owner order at the very top of the file, and section
    13 (engine maintenance).
  - Section 2 production DDL rules 1 to 11.
  - Sections 4.5, 5, 10.5, 10.6, 10.7c, 10.8 (law registry), 10.11, 10.12, 10.82,
    10.86, 10.87 (shared clone hygiene; never `git stash`), 10.88 and 11.5.
- `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` (cycles at 01, 04, 07, 10, 13, 16,
  19, 22 Chicago; preparation at cycle minus 30 minutes; reservation up to 100
  minutes earlier).
- `docs/ENGINE-RELEASE-RUNBOOK.md`.
- `.claude/skills/club-arena-console/SKILL.md`: read before touching any painted
  surface. Reuse painted controls; no new gradients or border-radius controls.
- GitHub identity: the shell `GH_TOKEN` can read and push. In this cloud session
  the REST merge worked. GraphQL is blocked here (`gh pr view` fails), so use
  `gh api` REST.
- Release-control files (`scripts/ci/read-engine-prequalification.py`
  `CONTROL_INPUTS`):
  - `.github/workflows/engine-release-prequalification.yml`,
    `stage-engine-release.yml`, `auto-deploy-hetzner.yml`, `backup-engine.yml`;
  - `scripts/ci/read-engine-prequalification.py`, `prestage-engine-image.sh`,
    `select-daily-engine.py`, `check-engine-doors-exist.mjs`,
    `window-migration-doors.mjs`, `recorded-migrations.manifest.json`,
    `record-engine-deploy-attempt.mjs`, `record-engine-deploy-exit.mjs`;
  - everything under `server/scripts` and `server/src/maintenance`.

  A merge touching these during a cycle's reservation window changes release
  authority for that cycle. This is why #11836 must wait.

---

## 6. Complete Discovery Record

### D1. Invite and link architecture

- Every share builds its link in `src/lib/share.ts`.
  - A tournament: `smarter.poker/t/<tournament id>`. After #11803 this carries
    `?i=<club code>` and an optional `invite`.
  - A table: `smarter.poker/g/<table id>?i=<club code>&invite=<seat-hold token>`
    (and `cluster` for cash).
- World Hub `/g/[id]` and `/t/[id]` forward the allowed params through
  `sanitizeShareParams`.
- Board rule (Dan 2026-11-08): every open Spin and Heads Up board opens with one
  horse (`SEAT_FIRST_OPENING_HORSES = 1`, `server/src/config/seatFirstLadder.ts`).
  A Heads Up starts the moment a person takes the other seat. A Spin fills 3 to 7
  minutes after a person sits. A filled board reopens as a new tournament id
  (`TournamentRecurringService.ensureBoardOpen`, keyed on owner and name), so a
  link goes stale within minutes. This was the "crazy river" glitch.
- Tournament read access is club-scoped (RESTRICTIVE policy
  `poker_arena_tournament_access`, `fn_poker_can_read_games`), so a non-member
  sees nothing without the join gate.
- `public.notifications` has no browser INSERT. World Hub migrations
  20261020170027, 20261020171316 and 20260421023031 record this, so the old
  client-side invite insert was refused. Fixed by the SECURITY DEFINER
  `fn_send_game_invite`:
  - friend or clubmate only;
  - idempotent for 60 seconds;
  - rate limited;
  - send log in `smarter_private.ca_game_invite_sends`.

### D2. Unregister start authority

- `fn_ca_unregister_tournament_player_exact` (body last set by 20261102154336)
  used the scheduled clock for every `sng-v1` that was not heads-up.
- A fixed Sit & Go satellite (`fn_ensure_fixed_sng_satellite`, 20261028163610)
  sets `start_time = now + 2 minutes` as a fill-window opening. After that the
  clock answered `tournament_started` even though the event starts only when full.
- Fixed with the `sit_and_go_actual_start` authority. A launch receipt or a
  started status refuses the unregister. The race is resolved by the
  `tournaments` row lock that the launch also takes.
- Another team's related changes, all INSTALLED:
  - #11765 (`0b8276ce2`, migration 20261122185915);
  - #11788 (`735299cd5`, migration 20261122222254: a Sit & Go whose launch has
    begun cannot be unregistered).

  The law was adjusted twice to coexist with them (#11785 and #11789).

### D3. Waiting-list architecture

- People and horses share one list per game: `cash_game_waitlist`, written by
  `fn_cash_game_join` and by `HorseFleetManager.syncHorseGameQueues`.
- `fn_offer_open_seat` calls names in arrival order. A call holds a chair for 60
  seconds; a lapsed call removes the name (20261023094000).
- The cluster tick (`fn_cash_cluster_tick` / `_uncapped`; #11790 by another team
  changed its locks to FOR NO KEY UPDATE) opens feeders:
  - 6-max: on two buyers.
  - Full ring (7 to 9): on four names, moving the last two to sit at the feeder.
- The hourly cash policy (2026-11-16) has a table cap plus two 2 to 4 minute
  pacing clocks (`fn_cash_hourly_table_admit`). It keeps weekly horse cash rake
  in budget by limiting the number of tables horses play.
- Dan's feeder-start ruling for 9-handed games: once 4 or more are on the list,
  the last two players to sit in the full main move to a new feeder. They are
  first to move back. The two main seats stay empty until the feeder has 7.
- Lightning games have no list (Oct 24 ruling).
- A must-move game's lobby shows only its table count, never "Waitlist N".

### D4. Top-chair layout pipeline

- On the phone the table is laid out at 600px (`PHONE_TABLE_LAYOUT_WIDTH_PX`) and
  scaled to the device.
- Top chairs (`.seat-wrapper--cap` / `--top`) used to be placed from the top down
  (crown to tab bar, or 8px under the Mini BBJ). The allocator then pushed them
  down, so plates sat 10 to 22% down the canvas, on the felt. The felt window
  starts at 8.9%; rail stations are at y 5 and 6%.
- Fix: plates rest on their own rail station. The 9-seat phone ring keeps
  centred plates and gains a floor.
- On a portrait tablet (641 to 768px) the canvas starts right under the tab bar.
  A rail-standing chair leaves no lane above it for a tabled hand, so the hand
  falls onto the felt and the ALL IN marker collides with the cards and the pot
  (CSS Beat 768x1024 6-max PLO5 all-in). So the rail rule is limited to 481 to
  640px portrait.
- Raw widths of 480px or less are mini tiles or squeezed desktop windows; the
  rule collided with mini tabled hands there.

### D5. Engine release pipeline (critical for delivery)

- `stage-engine-release.yml` runs on every push, on a schedule and on Backup
  completion. Its "Prove Whether The Server Tree Changed" job:
  - finds the reservation window of the next cycle;
  - elects one owner run per cycle: the lowest run id created inside
    [reservation, end) that carries the same release controls;
  - the owner waits until cycle minus 30 minutes, then the "Record the daily
    release evidence" job selects a Backup-certified candidate
    (`scripts/ci/select-daily-engine.py`; artifact
    `daily-engine-selection-<cycle>.zip` with `outcome`, `targetSha` and
    `reason`);
  - "Dispatch The Exact Main SHA" sends it to `auto-deploy-hetzner.yml`, which
    drains, freezes, proves, seals or rolls back, and thaws.
- Cutover log: GitHub issue #11599 (a comment per sealed cycle).
- Observed this night:
  - **19:00 cycle** sealed `735299cd`.
  - **22:00 cycle** was owned by run 45096806923, whose selection said
    `keep-serving`: "No newer protected candidate has complete current evidence
    by the cutoff". That is the normal gate, not a bug.
  - **01:00 cycle** was stranded. Push run 45114163784 had `pushed_at`
    04:49:59Z, `created_at` 04:50:01Z, and the reservation opened at 04:50:00Z.
    It judged itself by `pushed_at` (outside) and prepared nothing, while every
    later run judged it by `created_at` (inside) and deferred to it.
- Fixed in PR #11836 (open).
- Migration dispatcher (`.github/scripts/dispatch-merged-migrations.sh`,
  `scripts/ci/merged-migration-dispatch.mjs`):
  - holds ordinary migrations in [cycle minus 90 minutes, cycle plus 10 minutes)
    of each three-hourly cycle;
  - holds during the nightly release schema freeze 23:45 to 04:15 Chicago;
  - sends each file once, without retry.
- Window migrations install only in the 04:00 Chicago window
  (`stage-engine-release.yml` job `window-migrations`,
  `scripts/ci/install-window-migrations.mjs`).

### D6. CI gates and quirks learned (each one cost time)

- **Phantom refs** (`scripts/ci/check-phantom-tables.mjs`): every new rpc or
  table must be declared in a fragment under `scripts/ci/schema-manifest.d/`
  until the nightly manifest refresh.
- **Definer authorization** (`scripts/ci/check-definer-authorization.mjs`):
  every redefined SECURITY DEFINER function must restate `REVOKE ALL ... FROM
PUBLIC, anon, authenticated` and its GRANTs.
- **Probe law**: every redefined function needs a `-- @probe-for:
schema.fn` DO-block probe that unwinds itself. It must accept production's
  signed-out refusal (SQLSTATE 28000 / P0001 `SESSION_REVOKED:%`).
- **`tests/unit/requiredCiRunnerRecovery.test.ts`** pins `ci.yml` steps. Adding
  a step means pinning it there.
- **`tests/unit/noFixedSizeSourceWindows.test.ts`**: never `slice(a, a+N)` in
  source pins; use `tests/helpers/sourceWindow` or
  `server/src/testHelpers/sourceWindow`.
- **`tests/law-registry.law.test.ts`**: every `*.law.test.*` needs
  `docs/laws.d/<name>.md`.
- **`tests/no-tdz-in-table-route.law.test.ts`**: hooks must stay in order in
  `TablePage.tsx`.
- **CSS Beat Playwright** (`ci.yml` around line 5266) runs 10 shards per
  partition (portrait / general). Playwright puts a whole default-mode describe
  in one group:
  - The "cold observer and phone geometry" family is about 69 tests.
  - Shard size is about 66 to 67.
  - When that group starts in the last few slots of a shard, the next shard gets
    ZERO tests, and `scripts/ci/playwright-flaky-summary.mjs` fails with "the
    report lists no tests". This is LATENT ON MAIN and can hit any PR that
    shifts the test count. See defect H1.
- **Shallow clone**: some laws read git history (window-migration law,
  backup-certified law, break-clocks law) and fail locally with missing commits.
  They pass in CI.

### D7. Local test tooling in this container (gone after the session)

- PostgreSQL 16 at `/usr/lib/postgresql/16`. `initdb` refuses root, so run
  native proofs as user `pgproof`: `su pgproof -s /bin/bash -c "cd <wt> &&
TMPDIR=/tmp timeout 900 python3 scripts/ci/<proof>.py"`.
- Playwright browsers at `/opt/pw-browsers`. Recipe:
  - `npx vite build`
  - `npx vite preview --host 127.0.0.1 --port 7113 --strictPort`
  - `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers ARENA_BASE_URL=http://127.0.0.1:7113/hub/club-arena
BASE_URL=http://127.0.0.1:7113/hub/club-arena/ CI=1 npx playwright test <spec> --project=chromium`
  - The full `tests/e2e/table-proportions.spec.ts` takes about 22 minutes
    locally.
- Shard check without running:
  `npx playwright test <the 28 CSS Beat specs> --project=chromium --project=webkit-footer --grep="<CSS_BEAT_GREP>" --shard=k/10 --list | grep -c "›"`.

---

## 7. Work Completed During This Chat (workstreams)

Status key: LIVE = the client publish or engine release holding the change is
CONFIRMED serving. PENDING = merged but not yet serving.

### Task 1 (first message), all merged

| WS                                                  | PR                     | Squash                                | What                                                                                                                                                                    | Client | Engine               | SQL                      |
| --------------------------------------------------- | ---------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------- | ------------------------ |
| T1.1 Invite opens the game it names                 | #11772                 | `d56dcf8a7`                           | crossed i/invite; join detour keeps token; tournament tables shared as tournament; "full and started, a new one is open" redirect; invite arrival not stolen by restore | LIVE   | none                 | none                     |
| T1.2 Unregister until actually started + one button | #11771, #11785, #11789 | `7a54cc2c1`, `49176f684`, `bbbc374d6` | `sit_and_go_actual_start`; Register/Unregister one button same size/style                                                                                               | LIVE   | none                 | 20261122192807 INSTALLED |
| T1.3 Full game always has a list or an open chair   | #11773                 | `a0a85b117`                           | HorseLastChair; plate "Seats Open In This Game"                                                                                                                         | LIVE   | LIVE (in `735299cd`) | none                     |
| T1.4 6-max top seat on the rail (phone)             | #11774                 | `62534edf7`                           | `sixSeatTopRail.ts` (later generalised)                                                                                                                                 | LIVE   | none                 | none                     |

### Task 2 (four phases), all merged

| Phase                                                                        | PR                                                                                                          | Squash      | Client                           | Engine                      | SQL                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------- | --------------------------- | -------------------------------------------------------------- |
| 2 Links carry club, non-member join, server-sent invite                      | #11803 (+ World Hub #2909 `d42e5f0`)                                                                        | `eaf2e398a` | LIVE (World Hub LIVE `d42e5f06`) | none                        | 20261123013356 INSTALLED 04:10:17Z                             |
| 4 A called name keeps its place (+ closing tables, immediate line, patience) | #11805 (squash title is misleading: "test(ci): pin the called-name proof step behind the hourly cap proof") | `ffec83e5d` | n/a                              | PENDING (not in `735299cd`) | 20261123013241 INSTALLED 04:10:14Z                             |
| 1 Private seat holds, Heads Up and Spin                                      | #11808                                                                                                      | `8d4a7ef72` | LIVE                             | PENDING                     | 013126 INSTALLED 04:43:28Z; 013136 QUEUED for the 04:00 window |
| 3 Every top chair on the rail (phone layout)                                 | #11804                                                                                                      | `82dca44b3` | LIVE                             | none                        | none                                                           |

### Task 3 (01:02 Chicago resend)

| WS                        | PR     | Commit                                                                         | State                                                                                                                                                                               |
| ------------------------- | ------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sit & Go seat holds       | #11839 | `08e32e4ad` (merged 08:11:34Z)                                                 | Client publish run 45136628290 was IN PROGRESS at writing. Engine PENDING. Migration 20261123071654 held by dispatcher run 45136628450 until about 04:15 Chicago.                   |
| Engine-cycle election fix | #11836 | `ad3540f38` (branch `claude/a-reservation-is-elected-by-the-moment-it-claims`) | OPEN, all latest checks green (an older `ownership` run is red; the latest passed after the body got `Lane: release-custody`). DO NOT merge before the 04:00 seal (see section 19). |

### Per-workstream detail and bookmarks

Audit any change with `git show <squash>`. The squash's parent is the "begin"
bookmark; the squash is the "end" bookmark.

- **T1.1** (begin `d56dcf8a7^`, end `d56dcf8a7`)
  - Files: `src/services/NotificationService.ts` (`buildTableInviteDeepLink`
    param order); `src/lib/mustMoveInviteRouting.ts` (`parseTableInviteParams`
    return path and `inviteToken`); `src/lib/share.ts` (`tableInviteTarget`);
    `src/lib/nextOpenGame.ts` (new); `src/components/table/InviteLandedLateOverlay.tsx`;
    `src/pages/tournament/TournamentDetails.tsx` and `.css`;
    `src/pages/MultiTablePage.tsx`; `src/pages/TablePage.tsx`;
    `src/components/table/OnlineFriendInvitePicker.tsx`.
  - Law: `tests/an-invite-opens-the-game-it-names.law.test.ts` (round-trip with
    real shapes: 7-char code, uuid, 16 to 64 char token).
  - Also updated: `tests/unit/notificationTableInviteDeepLink.test.ts`,
    `TableInviteService.test.ts`, `tableInviteRoutingAndHardening.test.tsx` and
    `gameInviteLinkAndHeadsUpPrompt.test.ts`.
  - Why it broke: the unit tests used fake values and asserted the crossed
    output as correct.
  - Limits: not browser-verified (typecheck and unit tests only).
- **T1.2** (begin `7a54cc2c1^`, end `bbbc374d6`)
  - Migration: anchored replacement; each anchor must occur exactly once or the
    file aborts. The receipt check constraint is widened by exactly one value.
  - Client: `signUpDialog.tsx` says "You Can Unregister Any Time Before The
    Tournament Starts".
  - Laws: `a-sit-and-go-is-unregistered-until-it-actually-starts.law.test.ts`
    and `register-and-unregister-are-one-button.law.test.ts`.
  - Native proof: `scripts/dev/prove-sit-and-go-unregister-start-gate.sh`.
  - The first install attempt failed at 22:10:03Z (run 45076168844; cause
    UNKNOWN to this writer, most likely the parallel 20261122185915 landing
    first). The retry succeeded at 22:45:59Z (run 45079526355).
- **T1.3** (begin `a0a85b117^`, end `a0a85b117`)
  - Law: `server/src/services/aFullGameAlwaysHasAWaitingList.law.test.ts`
    simulates all nine cash variants at every size 2 to 9.
  - Plate test: `tests/unit/clusterWaitlistCallToAction.test.tsx`.
- **T1.4** (begin `62534edf7^`, end `62534edf7`)
  - Measured the plate's bottom edge at 10.5 to 19.2% of the canvas before and
    5.0% after.
  - Law: `the-six-max-top-seat-stands-on-the-rail.law.test.tsx`.
- **Phase 2** (begin `eaf2e398a^`, end `eaf2e398a`)
  - Law: `tests/a-tournament-link-carries-the-club.law.test.ts`.
  - Manifest fragment: `scripts/ci/schema-manifest.d/a-game-invite-is-sent-by-the-server.json`.
  - World Hub test: `__tests__/shared-tournament-links.test.mjs`.
  - Install order is safe either way: World Hub only forwards params, and Club
    Arena reads them when present.
- **Phase 4** (begin `ffec83e5d^`, end `ffec83e5d`)
  - Six defects fixed, documented in `docs/changelog/2026-11-22-a-called-name-keeps-its-place.md`:
    1. called names lapsed under pacing;
    2. the second bump of a full-ring feeder start was refused;
    3. a closing table was called to a horse it would refuse;
    4. a person taking the last chair left no line until the next cycle;
    5. a full table the cap is closing got no new names (the "closing tables"
       item; my earlier report to Dan wrongly said this was not built);
    6. patience could empty a full game's last name.
  - Native proof: `scripts/ci/test-a-called-name-keeps-its-place-postgres.py`.
  - Law: `server/src/services/aCalledNameKeepsItsPlace.law.test.ts`.
  - Updated: `tests/a-feeder-the-hourly-cap-would-refuse-is-not-opened.law.test.ts`
    (regex for the reserved count), `server/src/services/HorseFleetPolicyWiring.test.ts`
    (seat reads equal 2) and `tests/unit/requiredCiRunnerRecovery.test.ts`
    (`calledNameStep` pinned, `splice(index, 2)`).
- **Phase 1** (begin `8d4a7ef72^`, end `8d4a7ef72`)
  - Includes manifest fragment `scripts/ci/schema-manifest.d/a-private-game-holds-its-seats.json`
    (fixed a phantom-refs failure) and law
    `server/src/services/aSeatHeldForAFriendIsNotGivenToAHorse.law.test.ts`.
  - Probes accept `SESSION_REVOKED`.
- **Phase 3** (begin `82dca44b3^`, end `82dca44b3`)
  - Generalised to every top chair.
  - Final scope: phone layout 481 to 640px portrait.
  - The CSS Beat shard fix moved the rail cases into their own group ahead of
    the cold family.
- **Sit & Go holds** (begin `08e32e4ad^`, end `08e32e4ad`)
  - Held in place, not a private copy (Sit & Gos have one board per target).
  - The inviter is registered through the normal door in the same transaction.
  - Up to seats minus one friends.
  - No new trigger: the 013136 guard covers every `tournament_players` insert.
  - Lock order: no lock before the registration door is called, to avoid
    deadlock.
  - Client offer gated on engine `/health` `privateSitAndGoHolds: 1`.
  - Native proof: 72 checks.
  - New tests: `tests/unit/aSitAndGoHoldsASeatForAFriend.test.ts` (16 cases);
    the engine law gained 13 cases.
- **Scheduler fix** (begin `c12c2539d`, branch base; end `ad3540f38`)
  - Detail in sections 4 and 19.

---

## 8. Visual And Product Decisions

- **Top chairs.** On a phone (600px layout, 481 to 640px portrait), every top
  chair's name plate rests its bottom edge on the chair's rail station.
  - Applies to rings of 2 to 10 seats, cash and tournament, seated or watched.
  - The 9-seat phone ring keeps centred plates.
  - Neither plate nor portrait reaches the felt window (8.9%).
  - The tab bar and the jackpot plaque paint above the portrait; the head may run
    under them or be cut off.
  - No portrait shrinks (10.7c).
  - Portrait tablets (641 to 768px), raw widths of 480px or less, landscape and
    desktop keep their earlier placement. Tablets are excluded because the
    tabled-hand lane would land on the felt (D4).
  - The rule is LOCKED as Dan stated it. Widening to tablets needs a design for
    the tabled-hand lane first (section 20).
- **Register/Unregister.** One button, same size and style, never cut off
  (`TournamentDetails`, `signUpDialog.tsx`).
- **Invite UI.**
  - `PrivateGameInviteModal` offers the private game, with a Fewer / More friend
    count for Sit & Gos.
  - Held states: "Seat Held For Your Friend" / "Seats Held For Your Friends"
    (time left, Share, Cancel / Cancel Hold).
  - The friend sees "Your Seat Is Held" with Take Seat.
  - A stale link shows "This Game Is Full And Already Started. A New One Is Open
    Now." with Play New Game or Browse Open Games.
  - Built from existing painted plates and inline buttons; no new painted
    controls.
- **Waitlist plate.** "Table Full · N Seats Open In This Game / Join The Game"
  when a sibling table has room. A real list prints its count. A must-move game's
  lobby shows only the table count.
- **Dan's reference screenshots** (four images in the first message) were chat
  attachments. They were NOT saved to the repository (UNKNOWN whether stored
  anywhere).

---

## 9. Functional And Architectural Decisions

| Decision                                                                                                                                                                        | State                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A tournament table is shared as its tournament; the only table link is a Heads Up seat held for a named player (with token)                                                     | Implemented, LIVE                                             |
| Stale link: offer the same board's open game; never buy or seat by it                                                                                                           | Implemented, LIVE                                             |
| Sit & Go (non-HU `sng-v1`) can be unregistered until it actually starts (launch receipt / started status / hand persisted)                                                      | Implemented, INSTALLED                                        |
| Fleet never buys a game's last chair without a horse joining the list in the same cycle; 2-seat tables still take their second player                                           | Implemented, LIVE                                             |
| Hourly cap gates horse table starts and arrivals at closing tables only; clocks gate only unsolicited fleet seating, never called names or sanctioned moves; people never gated | SQL INSTALLED; engine PENDING                                 |
| A call the cap would refuse passes that player over for this seat only, place kept (`fn_cash_hourly_call_admissible`)                                                           | SQL INSTALLED                                                 |
| A person filling a game triggers an immediate horse line ask (event-driven, no cron)                                                                                            | Engine PENDING                                                |
| A full table the cap is closing still gets line names (line-only admission)                                                                                                     | Engine PENDING                                                |
| Private holds: 10 minutes of open play, freeze credited; HU 1 seat, Spin up to 2, Sit & Go up to seats minus one (held in place)                                                | SQL partly INSTALLED (013126); 071654 PENDING; engine PENDING |
| Database guard refuses a held seat to anyone but its holder, identical for horses                                                                                               | Trigger 013136 QUEUED for the 04:00 window                    |
| Tournament links carry `?i=`; a non-member joins, then returns                                                                                                                  | LIVE                                                          |
| In-app game invites only through `fn_send_game_invite` (friend or clubmate, 60 s idempotent, rate limited)                                                                      | LIVE                                                          |
| Engine-cycle election: claim and election use the run's `created_at`                                                                                                            | PR #11836 OPEN                                                |

---

## 10. Exact Current State (2026-11-23 about 08:15 UTC / 02:15 Chicago)

- **Live client:** `ca_sha 23a5ee274...` (includes everything up to #11804).
  Publish run 45136628290 for `08e32e4ad` (#11839) was in progress.
- **Live engine:** `releaseSha 735299cd5fda6b59c43d1379371d1a3dfb1a050f` (sealed
  in the 19:00 Chicago cycle of 11-22). The 22:00 and 01:00 cycles shipped
  nothing new. `/health.maintenance.schedule` reads three-hourly, `startHours
[1,4,7,10,13,16,19,22]`, policy `three-hourly-01Gw7aDs`. There is no
  `privateSitAndGoHolds` field yet.
- **World Hub live:** `d42e5f06d7f52748b29f29b745354bbc6c314f69`.
- **04:00 cycle owner:** stage run 45134198393 (push, created 07:51:59Z, head
  `69dcf25b1`), in progress and waiting for the 03:30 Chicago cutoff (09:30 UTC).
- **Backup certifications:** recent backup-engine runs succeeded for `8d4a7ef72`,
  `c0706e2b3` and `82dca44b3` (workflow_dispatch 05:09Z). A run for `c12c2539d`
  was in progress.
- **Migration dispatcher runs in progress:** 45136628450 (#11839) and others.
- **Open PRs from this work:** #11836 only.
- **Local:** no worktrees remain; no dev server or preview is running.
  `/home/claude/smarter-poker-club-arena` is a shallow clone on stale `main`
  (`7591e6ea4`) with no local changes. This handoff file is at
  `/home/claude/handoff/HANDOFF-2026-11-23-club-arena-invites-rail-waitlist.md`
  and also committed to `docs/` through a docs PR (see section 25).

---

## 11. Changed-File Ledger

Status: all Committed=yes (squash merged) except #11836 (committed and pushed on
its branch, not merged). Every file was verified by the CI run on its PR (all
required checks green before merge) unless noted.

| PR                        | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #11774 `62534edf7`        | `docs/changelog/2026-11-22-the-six-max-top-seat-stands-on-the-rail.md`, `docs/laws.d/tests-the-six-max-top-seat-stands-on-the-rail.md`, `src/components/table/SeatSlot.css`, `src/components/table/mobileAvatarEnlargement.ts`, `src/components/table/opponentAvatarLayout.ts`, `src/components/table/sixSeatTopRail.ts` (later deleted), `src/hooks/useProtectedCardLayout.ts`, `tests/e2e/support/mobileAvatarSizingCases.ts`, `tests/e2e/support/mobileLiveTableLayout.ts`, `tests/the-six-max-top-seat-stands-on-the-rail.law.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| #11772 `d56dcf8a7`        | `docs/changelog/2026-11-22-an-invite-opens-the-game-it-names.md`, `docs/laws.d/an-invite-opens-the-game-it-names.md`, `src/components/table/InviteLandedLateOverlay.tsx`, `src/components/table/OnlineFriendInvitePicker.tsx`, `src/lib/mustMoveInviteRouting.ts`, `src/lib/nextOpenGame.ts`, `src/lib/share.ts`, `src/pages/MultiTablePage.tsx`, `src/pages/TablePage.tsx`, `src/pages/tournament/TournamentDetails.css`, `src/pages/tournament/TournamentDetails.tsx`, `src/services/NotificationService.ts`, `tests/an-invite-opens-the-game-it-names.law.test.ts`, `tests/unit/TableInviteService.test.ts`, `tests/unit/gameInviteLinkAndHeadsUpPrompt.test.ts`, `tests/unit/notificationTableInviteDeepLink.test.ts`, `tests/unit/tableInviteRoutingAndHardening.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| #11773 `a0a85b117`        | `docs/changelog/2026-11-22-a-full-game-always-has-a-waiting-list.md`, `docs/laws.d/server-src-services-aFullGameAlwaysHasAWaitingList.md`, `server/src/services/HorseFleetManager.ts`, `server/src/services/HorseGameQueue.test.ts`, `server/src/services/HorseLastChair.ts`, `server/src/services/HorseSitVerdict.test.ts`, `server/src/services/aFullGameAlwaysHasAWaitingList.law.test.ts`, `src/components/table/ClusterWaitlistCallToAction.tsx`, `src/components/table/WaitlistCallToAction.tsx`, `tests/unit/clusterWaitlistCallToAction.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| #11771 `7a54cc2c1`        | changelog + 2 laws.d entries, `scripts/dev/prove-sit-and-go-unregister-start-gate.sh`, `src/components/tournament/signUpDialog.tsx`, `src/pages/tournament/TournamentDetails.css`, `src/pages/tournament/TournamentDetails.tsx`, `supabase/migrations/20261122192807_...sql`, `tests/a-sit-and-go-is-unregistered-until-it-actually-starts.law.test.ts`, `tests/register-and-unregister-are-one-button.law.test.ts`, `tests/unit/tournamentEntryTicketRegistration.test.tsx`, `tests/unit/tourneyUxSweep20260825.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| #11785 `49176f684`        | same changelog/laws.d, prove script, `signUpDialog.tsx`, the 20261122192807 migration (made verify-only of the parallel rule), the unregister law, `tournamentEntryTicketRegistration.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| #11789 `bbbc374d6`        | unregister changelog and law (admits a later tightening)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| #11803 `eaf2e398a`        | `docs/changelog/2026-11-22-a-tournament-link-carries-the-club.md`, `docs/laws.d/a-tournament-link-carries-the-club.md`, `scripts/ci/schema-manifest.d/a-game-invite-is-sent-by-the-server.json`, `src/components/table/TableLoadFailureOverlay.tsx`, `src/components/table/TournamentBreakScreen.tsx`, `src/components/tournament/TournamentClubJoinGate.css`, `src/components/tournament/TournamentClubJoinGate.tsx`, `src/components/tournament/TournamentLobbyCard.tsx`, `src/components/tournament/TournamentRankingCard.tsx`, `src/hooks/useSenderInviteCode.ts`, `src/lib/inviteCode.ts`, `src/lib/mustMoveInviteRouting.ts`, `src/lib/share.ts`, `src/pages/TournamentPage.tsx`, `src/pages/tournament/TournamentDetails.tsx`, `src/pages/tournament/TournamentLobbyPage.tsx`, `src/services/TableInviteService.ts`, `supabase/migrations/20261123013356_a_game_invite_is_sent_by_the_server_to_a_clubmate_or_friend.sql`, `tests/a-tournament-link-carries-the-club.law.test.ts`, `tests/an-invite-opens-the-game-it-names.law.test.ts`, `tests/unit/TableInviteService.test.ts`, `tests/unit/lobbyCardInviteAndFrameLayout.test.tsx`, `tests/unit/tournamentLobbyPopupIsFullScreen.test.tsx`. World Hub #2909: `pages/t/[id].js`, `src/lib/sharedTournamentLink.js`, `__tests__/shared-tournament-links.test.mjs` (+ note) |
| #11805 `ffec83e5d`        | `.github/workflows/ci.yml`, `docs/changelog/2026-11-22-a-called-name-keeps-its-place.md`, `docs/changelog/2026-11-22-a-full-game-always-has-a-waiting-list.md`, `docs/laws.d/server-src-services-aCalledNameKeepsItsPlace.md`, `scripts/ci/test-a-called-name-keeps-its-place-postgres.py`, `scripts/ci/test-hourly-cash-caps-postgres.py`, `server/src/cluster/cashSeatCommittedSignal.ts`, `server/src/engine/ServerTableEngine.ts`, `server/src/engine/ServerTableEngineBase.ts`, `server/src/services/HorseFleetManager.ts`, `server/src/services/HorseFleetPolicyWiring.test.ts`, `server/src/services/HorseGameQueue.ts`, `server/src/services/HorseLastChair.ts`, `server/src/services/HorseLineOnArrival.ts`, `server/src/services/HorseQueueAdmission.ts`, `server/src/services/aCalledNameKeepsItsPlace.law.test.ts`, `server/src/services/horsesPlayTheDiamondArena.law.test.ts`, `supabase/migrations/20261123013241_...sql`, `tests/a-feeder-the-hourly-cap-would-refuse-is-not-opened.law.test.ts`, `tests/unit/requiredCiRunnerRecovery.test.ts`                                                                                                                                                                                                                                                                     |
| #11808 `8d4a7ef72`        | `.github/workflows/private-game-holds.yml`, `docs/changelog/2026-11-22-invite-to-game-holds-a-private-seat.md`, `docs/laws.d/server-src-services-aSeatHeldForAFriendIsNotGivenToAHorse.md`, `scripts/ci/fixtures/private-game-holds/bootstrap.sql`, `scripts/ci/schema-manifest.d/a-private-game-holds-its-seats.json`, `scripts/ci/test-private-game-holds-postgres.py`, `server/src/GameServer.ts`, `server/src/services/TournamentRecurringService.ts`, `server/src/services/aFinalizedPoolIsNotFilled.test.ts`, `server/src/services/aHumansOpponentSeatIsKeptForPeople.test.ts`, `server/src/services/aPausedFleetTakesNoTournamentSeat.test.ts`, `server/src/services/aSeatHeldForAFriendIsNotGivenToAHorse.law.test.ts`, `server/src/services/headsUpWaitModeHold.test.ts`, `server/src/services/privateGameHolds.ts`, `server/src/services/seatFirstSeatPrecheck.test.ts`, `src/components/lobby/GameLobbyPanel.tsx`, `src/components/lobby/LobbyTable.tsx`, `src/components/table/PrivateGameInviteModal.tsx`, `src/components/tournament/TournamentLobbyCard.tsx`, `src/hooks/usePrivateGameInviteLauncher.tsx`, `src/lib/privateGameInvite.ts`, `src/pages/TablePage.tsx`, `src/pages/tournament/TournamentDetails.tsx`, `supabase/migrations/20261123013126_...sql`, `supabase/migrations/20261123013136_...sql`        |
| #11804 `82dca44b3`        | `docs/changelog/2026-11-22-every-top-chair-stands-on-the-rail.md`, `docs/laws.d/tests-every-top-chair-stands-on-the-rail.md`, `docs/laws.d/tests-the-six-max-top-seat-stands-on-the-rail.md`, `docs/laws.d/two-top-chairs-sit-level.md`, `src/components/table/SeatSlot.css`, `src/components/table/mobileAvatarEnlargement.ts`, `src/components/table/opponentAvatarLayout.ts`, `src/components/table/sixSeatTopRail.ts` (deleted), `src/components/table/topChairRail.ts` (new), `src/hooks/useProtectedCardLayout.ts`, `tests/e2e/support/mobileAvatarSizingCases.ts`, `tests/e2e/support/mobileLiveTableLayout.ts`, `tests/e2e/support/observerAvatarSizingCases.ts`, `tests/e2e/support/topChairRailCases.ts` (new), `tests/e2e/table-proportions.spec.ts`, `tests/every-top-chair-stands-on-the-rail.law.test.tsx` (new), `tests/the-six-max-top-seat-stands-on-the-rail.law.test.tsx`, `tests/two-top-chairs-sit-level.law.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                         |
| #11839 `08e32e4ad`        | `.github/workflows/private-game-holds.yml`, both Phase-1 and new Sit & Go changelogs, laws.d entry, `bootstrap.sql`, `test-private-game-holds-postgres.py`, `server/src/GameServer.ts`, `server/src/services/FixedSngHorsePlan.test.ts`, `server/src/services/TournamentRecurringService.ts`, the engine law, `server/src/services/privateGameHolds.ts`, `src/components/lobby/GameLobbyPanel.tsx`, `src/components/lobby/LobbyTable.tsx`, `src/components/table/PrivateGameInviteModal.tsx`, `src/components/tournament/TournamentLobbyCard.tsx`, `src/hooks/usePrivateGameInviteLauncher.tsx`, `src/hooks/usePrivateSitAndGoHold.tsx` (new), `src/lib/privateGameInvite.ts`, `src/pages/tournament/TournamentDetails.tsx`, `src/services/TournamentService.ts`, `supabase/migrations/20261123071654_...sql`, `tests/unit/aSitAndGoHoldsASeatForAFriend.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| #11836 `ad3540f38` (OPEN) | `.github/workflows/stage-engine-release.yml`, `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`, `tests/operations/engine-release-recovery-window.py`, the `daily-engine-maintenance.law` harness, `docs/ENGINE-RELEASE-RUNBOOK.md`, `docs/laws.d/daily-preparation-does-not-wait-for-a-punctual-cron.md`, `docs/changelog/2026-11-23-a-reservation-is-elected-by-the-moment-it-claims.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

No user-owned uncommitted changes exist anywhere this work touched.

---

## 12. Asset Ledger

No image, icon or art asset was created or changed. Dan's four reference
screenshots from the first message are listed below; their storage location is
UNKNOWN (not in the repo).

| Asset                                  | Path                 | Purpose                                                                                | Approved  | Implemented | Tracked |
| -------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- | --------- | ----------- | ------- |
| Unregister error screenshot            | chat attachment only | shows "Unregister Failed: This Tournament Has Started" on "Satellite Into Nightly 20K" | reference | fixed       | no      |
| Invite glitch screenshot (crazy_river) | chat attachment only | stale-link landing                                                                     | reference | fixed       | no      |
| Register/Unregister cut-off screenshot | chat attachment only | "REGIST" cut off beside Invite To Game                                                 | reference | fixed       | no      |
| 6-max top villain screenshot (the_doc) | chat attachment only | top chair on the felt                                                                  | reference | fixed       | no      |

---

## 13. Commands And Tools Used (no secrets)

- Push: `cd <worktree> && bash scripts/agent-push.sh` (verifies the remote ref).
  Never push from `/home/claude/smarter-poker-club-arena` or the Mac shared
  clone.
- Merge (helper `/tmp/merge.py`, recreate if missing):
  `curl -s -X PUT https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/<n>/merge -H 'Content-Type: application/json' -d '{"merge_method":"squash","sha":"<head sha>"}'`.
- Check runs: `curl -s .../commits/<sha>/check-runs?per_page=100&filter=latest`.
  The failure-log reader fetched `.../actions/jobs/<job id>/logs` and grepped it.
- Rerun failed jobs: `gh api -X POST repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/<run>/rerun-failed-jobs`
  (refused with "This workflow is already running" while other jobs run).
- Live checks:
  - `curl -s https://smarter.poker/hub/club-arena/build-info.json`
  - `curl -s https://ca-static.smarter.poker/build-info.json`
  - `curl -s https://engine.smarter.poker/health` (`releaseSha`,
    `maintenance.schedule`, `privateSitAndGoHolds`)
  - `curl -s https://smarter.poker/api/health` (World Hub)
- Is a fix live? `git fetch origin main && git merge-base --is-ancestor <fix sha> <live sha>`.
- Migration install status: list `.../actions/workflows/apply-merged-migration.yml/runs?per_page=100`
  and match the display title to the migration file name. Dispatcher:
  `.../workflows/dispatch-merged-migrations.yml/runs`.
- Stage owner and decision: `.../actions/workflows/stage-engine-release.yml/runs?created=<from>..<to>`,
  then read the job "Prove Whether The Server Tree Changed" log for "Daily
  preparation for <cycle> is owned by this run" or "belongs to earlier run".
  The selection artifact is downloaded with
  `gh api repos/.../actions/artifacts/<id>/zip`.
- Local gates: `node scripts/ci/check-phantom-tables.mjs`,
  `check-phantom-columns.mjs`, `check-definer-authorization.mjs <merge-base>`,
  `check-migrations-applied.mjs <merge-base>`, `npx tsc --noEmit -p tsconfig.json`,
  server typecheck with `NODE_OPTIONS=--max-old-space-size=4096`, and
  `npx vitest run <files>`.
- Supabase MCP `execute_sql` against production was DENIED in this session
  (unauthorized). No production read was done. Production facts come from
  GitHub workflow runs only.

---

## 14. Verification And Test Results

| Verification                                                                                          | Method                                                                                                                                    | Result                                                                                                                                                       | Follow-Up              |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Required CI on #11772, #11771, #11785, #11789, #11773, #11774, #11803, #11805, #11808, #11804, #11839 | GitHub checks                                                                                                                             | All green at merge (#11808: a flaky `ruleReceiptsAreJournaledWithTheirHand.test.ts` horse test failed once and passed on rerun; #11804 needed the shard fix) | none                   |
| #11836 CI                                                                                             | GitHub checks                                                                                                                             | latest 42 success, 15 skipped; two older `ownership` failures superseded by a later success                                                                  | merge after 04:00 seal |
| Client typecheck                                                                                      | `npx tsc --noEmit`                                                                                                                        | clean (on each branch before push)                                                                                                                           | none                   |
| Native Postgres proofs                                                                                | `test-private-game-holds-postgres.py` (72 checks after #11839), `test-a-called-name-keeps-its-place-postgres.py`, unregister prove script | passed locally and in CI                                                                                                                                     | none                   |
| Table layout browser suite                                                                            | local `table-proportions.spec.ts`, 132 or more cases; CI CSS Beat 20 shards                                                               | all passed on #11804 final; one local load-timeout at 320px 9-seat passed on rerun                                                                           | none                   |
| Live client publish                                                                                   | build-info `ca_sha` contains each fix                                                                                                     | CONFIRMED for everything except #11839 (publishing at writing)                                                                                               | confirm #11839         |
| Live engine                                                                                           | `/health releaseSha`                                                                                                                      | `735299cd`; #11805, #11808, #11839 NOT live                                                                                                                  | verify after 04:00     |
| Post-Deploy E2E for `82dca44b3`                                                                       | GitHub "Post-Deploy E2E"                                                                                                                  | "Client browser verification" job CANCELLED (superseded); live-table verification was in progress                                                            | UNVERIFIED, re-check   |
| Real-browser manual checks of invite flows, held seats, join gate, Sit & Go hold UI                   | not done                                                                                                                                  | NOT RUN                                                                                                                                                      | section 20             |
| Production SQL verification                                                                           | not possible (MCP denied)                                                                                                                 | NOT RUN                                                                                                                                                      | section 20             |
| Concurrency (two sessions) for the Sit & Go invite lock order                                         | not done                                                                                                                                  | NOT RUN                                                                                                                                                      | section 20             |

---

## 15. Setbacks, Failed Approaches, And Lessons

- **S1.** Sub-agent tool `isolation: worktree` was denied. Make worktrees by
  hand: `git worktree add -b claude/<slug> /home/claude/wt/<slug> origin/main`
  and symlink `node_modules` and `server/node_modules` from the main clone (the
  lockfiles were identical).
- **S2.** `initdb` refuses root. Use the non-root `pgproof` user and `chmod o+rx`
  the directories it reads.
- **S3.** A commit chain once pushed despite a failing test because the command
  chain did not stop on failure. Always use `&&` and check the exit code before
  pushing.
- **S4.** Phase 4 CI failures:
  - `requiredCiRunnerRecovery` (new `ci.yml` step);
  - definer authorization (4 functions needed restated grants);
  - the probe law (2 functions needed probes);
  - the feeder law regex;
  - `HorseFleetPolicyWiring` (2 seat reads).
    All were fixed by updating the pins in the same PR.
- **S5.** Phase 1 CI failures:
  - `useNavigate` outside a Router in card tests (use `useAppNavigate`);
  - TDZ law (`handlePrivateTakeSeat` moved after `useDialogEscape`);
  - law registry entry missing;
  - the probe failed on production's `SESSION_REVOKED` (accept SQLSTATE 28000 /
    P0001);
  - merge conflicts with #11803 in `TournamentDetails.tsx` and
    `TournamentLobbyCard.tsx` (both imports kept; `shareTournamentLink` uses
    `tournamentShareUrl(tournament.id, { inviteCode })`);
  - phantom-refs (the manifest fragment was added).
- **S6.** Phase 3 first generalised the rule to widths of 480px or less, which
  broke the mini-tile CSS Beat cases. Narrowed to 481 to 768px.
- **S7.** At 768px the crown assertion (lines ~1695 and ~1797 of
  `table-proportions.spec.ts`) went negative, and the 6-max PLO5 all-in case
  found the ALL IN marker on the tabled cards and the pot. The root cause is the
  tablet's tabled-hand lane. Narrowed to 481 to 640px.
- **S8.** The "six-seat compact crown proof" synthetic test (600x1000 portrait)
  became a rail viewport, where the crown proof no longer applies. Moved to
  600x560 landscape.
- **S9.** CSS Beat general shard 7 got zero tests. The 9 rail cases enlarged the
  cold default-mode group (69 + 9) past the shard size, and even after the split
  the boundary alignment emptied shard 7. Fixed by placing the rail group ahead
  of the cold family, checked with `--list --shard`.

  The fragility remains latent on main (H1).

- **S10.** The Supabase MCP production SELECT was denied, so no production
  verification was possible from this session.
- **S11.** The owner stopped four sub-agents mid-build ("STOP SLEEPING"). The
  work was finished by hand. Avoid long silent sleep loops; poll briefly and keep
  working.
- **S12.** Reported to Dan that "closing tables" was unbuilt. That was WRONG: it
  was defect 5 of #11805. This was corrected to him at 01:05 Chicago. Read the
  changelog before claiming something is missing.
- **S13.** The session's server process restarted at about 07:25Z. The background
  agents were auto-resumed and finished.
- **S14.** An earlier attempt to install 20261122192807 failed (run 45076168844);
  the retry succeeded. The cause was not investigated.

---

## 16. Known Defects And Architectural Holes

| Priority | Defect / Hole                                                                                                                                                                                   | Evidence                                     | Impact                                                                                                                     | Recommended Fix                                                                                                                                               | Status                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| P0       | Engine parts of #11805, #11808, #11839 not serving                                                                                                                                              | `/health releaseSha 735299cd`                | Waiting-list fixes, immediate line, closing-table line, and horses respecting held seats are absent in the engine          | Verify the 04:00 cycle seals with a candidate containing them; if it keeps serving, read the selection artifact `reason`                                      | Pending 04:00                |
| P0       | Held-seat DB guard (013136) not installed                                                                                                                                                       | window migration, queued                     | A held seat can be taken through any door until it installs (the client/engine path honour holds; the old engine does not) | Verify the 04:00 `window-migrations` job installs it                                                                                                          | Pending 04:00                |
| P1       | Scheduler can strand a cycle when an owner push run's push time precedes the reservation by seconds                                                                                             | 01:00 cycle 2026-11-23                       | Any lane's engine work misses a cutover                                                                                    | Merge #11836 after the 04:00 seal and before 04:50 Chicago                                                                                                    | PR open                      |
| P1       | Residual stranding: an elected owner whose own API reads fail prepares nothing and later runs still defer                                                                                       | #11836 agent report; changelog "Not covered" | Missed cycle                                                                                                               | Design: a later run may take over when the owner recorded no preparation by a deadline (changes the once-per-cycle rule; needs care)                          | Not started                  |
| H1       | CSS Beat sharding: one default-mode group (cold observer family, 69 tests) larger than a shard (66 to 67) empties a shard depending on alignment                                                | S9                                           | Random PRs fail "the report lists no tests"                                                                                | Split the cold family into bounded groups under the shard size, OR make the step compute the planned shard count (`--list`) and accept an empty planned shard | Not started (latent on main) |
| H2       | Portrait tablets (641 to 768px) top chairs still on the felt                                                                                                                                    | D4, S7                                       | Dan's rule holds on phones only                                                                                            | Design a tabled-hand lane above the plate for tablets, then extend `topChairRailViewport`                                                                     | Not started                  |
| H3       | 6/9-seat Sit & Go boards the union daily plan pre-filled to one short refuse an invite (no room for inviter plus friend)                                                                        | #11839 report                                | Inviter told before paying; next board opens after                                                                         | Product decision                                                                                                                                              | Not started                  |
| H4       | Human-only 6/9 Sit & Go satellite boards still wait for the daily plan; "if a human joins it starts" does not apply to them                                                                     | #11839 report                                | Behaviour gap versus Dan's stated rule                                                                                     | Confirm with the owner's rules / horse plan migrations 20261029032444 and later                                                                               | Needs investigation          |
| H5       | Phase 4 residual refusals: host seat ceiling and variety-first hold on an empty extra table still decline a call, which lapses; a 2-seat table takes its second player with nobody free to wait | Phase 4 changelog "The sweep"                | A name can still lapse in those two cases                                                                                  | Evaluate whether they violate "keeps their place"                                                                                                             | Documented, not changed      |
| H6       | Nothing browser- or production-verified for the invite flows, held seats, join gate, server-sent invite, Sit & Go hold UI (incl. `/tournaments/:id?held=1` from the in-lobby tab)               | sections 13-14                               | Unknown UI defects                                                                                                         | Manual run on production with a test identity (never Dan's account; CLAUDE.md 10.10) and/or Playwright                                                        | Not done                     |
| H7       | Sit & Go invite lock order (no lock before the registration door) proved by reasoning only                                                                                                      | #11839 report                                | Deadlock or double registration under concurrency (low likelihood)                                                         | Two-session native test                                                                                                                                       | Not done                     |
| H8       | Between the Sit & Go engine flag going live and migration 071654 installing (or the reverse), the client may offer Sit & Go holds that the RPC refuses (`format_not_supported`)                 | install order                                | Brief confusing error                                                                                                      | Verify timing; both expected by about 04:15 Chicago                                                                                                           | Watch                        |
| H9       | #11805's squash title is misleading ("test(ci): pin the called-name proof step...")                                                                                                             | git log                                      | Audit confusion only                                                                                                       | none (history), mention in reports                                                                                                                            | Accept                       |
| H10      | 20261122192807 first install attempt failed (cause unknown)                                                                                                                                     | run 45076168844                              | none now (retry installed)                                                                                                 | Optional: read that run's log                                                                                                                                 | Optional                     |
| H11      | Post-Deploy E2E "Client browser verification" for `82dca44b3` was cancelled                                                                                                                     | section 14                                   | Live mobile layout proof not observed for Phase 3                                                                          | Re-check the latest Post-Deploy E2E run on main for a pass that includes `82dca44b3`                                                                          | Pending                      |

---

## 17. Security, Secrets, And Credentials (names only)

- `GH_TOKEN` / `gh` login (cloud session): read, push and REST merge worked;
  GraphQL is blocked.
- `SUPABASE_SERVICE_ROLE_KEY` is used by the engine (server side only).
  `CRON_SECRET` belongs to World Hub crons and is not used here.
- Production database checks must go through a workflow identity (CLAUDE.md
  1.2.5), never a copied key. The Supabase MCP `execute_sql` was denied in this
  session.
- Test identity for browser checks: `daniel@smarter.poker` (god role) through
  configured env names `SP_EMAIL` / `TEST_USER_EMAIL`. NEVER Dan's personal
  account (CLAUDE.md 10.10).
- No secret was printed or exposed during this work.

---

## 18. Database, Migration, And Seed Status

| Migration                                                                  | From          | Type                                                                     | Status                                                                               |
| -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 20261122192807_a_sit_and_go_is_unregistered_until_it_actually_starts       | #11771/#11785 | function edits + constraint                                              | INSTALLED 2026-11-22 22:45:59Z                                                       |
| 20261123013356_a_game_invite_is_sent_by_the_server_to_a_clubmate_or_friend | #11803        | new fn + `smarter_private.ca_game_invite_sends`                          | INSTALLED 04:10:17Z                                                                  |
| 20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap          | #11805        | functions only                                                           | INSTALLED 04:10:14Z                                                                  |
| 20261123013126_a_private_game_holds_its_seats_for_invited_friends          | #11808        | tables `private_game_holds`, `private_game_admissions` + functions       | INSTALLED 04:43:28Z                                                                  |
| 20261123013136_a_held_seat_is_refused_to_anyone_but_its_invited_holder     | #11808        | trigger on `tournament_players`, `-- @install-window: daily-maintenance` | QUEUED for the 04:00 Chicago window, 2026-11-23                                      |
| 20261123071654_a_sit_and_go_holds_seats_for_invited_friends                | #11839        | CREATE OR REPLACE `fn_invite_to_private_game`                            | HELD by dispatcher run 45136628450 until about 04:15 Chicago (nightly schema freeze) |

Other team's migrations relied on here (installed): 20261122185915,
20261122222254 and 20261122232612 (#11790).

No seeds. No rollback was tested (migrations are forward-only and installed once
by the applier). None of these writes money directly; the private-hold
inviter registration goes through the normal registration door.

---

## 19. Current Blockers And Decision Points

1. **When to merge #11836.**
   - It is a release-control change. Merging inside a cycle's reservation
     window changes release authority for that cycle (the election rule "the
     first run carrying the controls the cutoff binds owns the date").
   - Safe slot: after the 04:00 Chicago cycle SEALS (a cutover-log comment on
     issue #11599 "Cycle: 2026-11-23 04:00 CST Result: SEALED", or the
     `auto-deploy-hetzner` run succeeded and `/health releaseSha` changed) and
     before 04:50 Chicago (10:50 UTC), when the 07:00 cycle's reservation opens.
   - If that slot is missed, the next safe slots are just after each later cycle
     seals (07:05 to 07:50, 10:05 to 10:50 Chicago, and so on).
   - Technical decision, not the owner's: merge it yourself.
2. **If the 04:00 cycle keeps serving `735299cd`:**
   - Download its `daily-engine-selection-2026-11-23.zip` (or similar) artifact
     and read `outcome` and `reason`.
   - Do NOT force a release or dispatch Stage a second time. CLAUDE.md: a second
     Stage dispatch for a claimed window raises a false release alert.
   - The next cycle (07:00) will pick up a certified candidate.
3. **H3/H4 (Sit & Go daily plan versus "if a human joins it starts")** is a
   product question. Investigate first; ask Dan only if a real business choice
   remains. He dislikes being asked things that can be decided.
4. **H2 tablet rail** needs a layout design. Technical: decide it yourself,
   keeping the 10.7c and console rules.

---

## 20. Remaining Work

**Critical**

- Verify the 04:00 cutover:
  - the engine `releaseSha` contains `ffec83e5d`, `8d4a7ef72` and (if certified)
    `08e32e4ad`;
  - `/health` shows `privateSitAndGoHolds: 1` once `08e32e4ad` is in.
- Verify the window migration 013136 installed (the `window-migrations` job of
  the owning stage run, and the applier run titled with 013136).
- Verify 20261123071654 installed (an apply-merged-migration run titled with it,
  `success`).
- Merge #11836 in the safe slot; verify it on main.
- Verify the #11839 client is live: build-info `ca_sha` contains `08e32e4ad`.

**High**

- Live verification with the service test identity (not Dan's) of:
  - invite to a Heads Up / Spin, with the friend taking the held seat;
  - a stranger being refused;
  - Cancel;
  - expiry after 10 minutes;
  - a Sit & Go hold for 1 to (seats minus 1) friends;
  - a tournament link with `?i=` for a non-member (join, then return);
  - the in-app invite arriving;
  - the stale-link redirect;
  - unregister from a fixed Sit & Go satellite before it fills;
  - Register/Unregister on a 375px phone.
- Regression audit (section 21, Phase 6): re-run the laws and native proofs
  listed in section 14 on current main, and the CSS Beat suites. Read recent
  production error signals and incidents for the touched surfaces (invites, holds,
  unregister, waitlist, table layout) through allowed workflows, and look at the
  Post-Deploy E2E results after each release.
- Fix H1 (CSS Beat shard fragility) at the root.
- Look at the residual stranding (P1 second row) and design a safe takeover.

**Medium**

- H2 tablet top-chair rail design.
- H3/H4 Sit & Go daily-plan interaction.
- H5 residual lapses.
- H7 two-session concurrency proof for the Sit & Go invite.

**Low / Optional**

- H10 read the failed install log.
- Persist Dan's reference screenshots if he wants them kept.

---

## 21. Prioritized Next-Phase Execution Plan

- **Phase 0: Recover and verify state (first 15 minutes).** Use the commands in
  section 22. Exit criterion: you know the engine sha, the 04:00 seal outcome,
  each migration's install state, the #11836 merge state and the live client
  sha.
- **Phase 1: Protect delivery.**
  - If 04:00 sealed, merge #11836 in the safe slot (section 19.1). Check `main`
    contains `ad3540f38`'s change. Then watch the 07:00 cycle: a run must log
    "Daily preparation for 2026-11-23T07 (Chicago) is owned by this run" and the
    cycle must seal.
  - If 04:00 did not seal, diagnose from the artifact and wait for 07:00. Merge
    #11836 right after a seal.
- **Phase 2: Confirm engine behaviour live.**
  - Once `releaseSha` contains the three merges, read `/health` for
    `privateSitAndGoHolds`.
  - Read engine-visible signals that the waiting-list changes run: the fleet
    cycle log counters `last_chair left_open=N paired=M`. The engine log is
    reachable only through approved read-only workflows; never ssh with
    unapproved keys (CLAUDE.md 1.2.5).
- **Phase 3: Live manual and browser verification** of the High list in
  section 20, with the service identity. Take screenshots at 390x844 (phone
  layout 600px) and 768x1024.
- **Phase 4: Regression audit.**
  - Re-run on current main (in a fresh worktree, full depth or `--unshallow` to
    avoid the history-reading laws failing):
    - `tests/an-invite-opens-the-game-it-names.law.test.ts`,
      `tests/a-tournament-link-carries-the-club.law.test.ts`,
      `tests/a-sit-and-go-is-unregistered-until-it-actually-starts.law.test.ts`,
      `tests/register-and-unregister-are-one-button.law.test.ts`;
    - `tests/every-top-chair-stands-on-the-rail.law.test.tsx`,
      `tests/the-six-max-top-seat-stands-on-the-rail.law.test.tsx`,
      `tests/two-top-chairs-sit-level.law.test.tsx`,
      `tests/mobile-avatars-never-ratchet-smaller.law.test.ts`,
      `tests/law-registry.law.test.ts`;
    - `tests/unit/aSitAndGoHoldsASeatForAFriend.test.ts`;
    - `server/src/services/aFullGameAlwaysHasAWaitingList.law.test.ts`,
      `aCalledNameKeepsItsPlace.law.test.ts`,
      `aSeatHeldForAFriendIsNotGivenToAHorse.law.test.ts` (server vitest
      config);
    - the native proofs `scripts/ci/test-private-game-holds-postgres.py` and
      `scripts/ci/test-a-called-name-keeps-its-place-postgres.py`;
    - `tests/e2e/table-proportions.spec.ts`.
  - Check whether anything regressed elsewhere:
    - lobby invite plaques (#11750 / #11764 by another team touched SNG invite
      placement);
    - the Heads Up Specific Player mode from #11709 (the Phase 1 functions
      redefine `fn_set_heads_up_wait_mode` and `fn_check_heads_up_seat_invite`);
    - must-move routing;
    - waitlist lobby status text.
  - Fix any regression at its root with a law.
- **Phase 5: Harden CI (H1)** and the residual scheduler stranding. Make
  separate PRs. The release-control one must merge only in a post-seal slot.
- **Phase 6: Medium items (H2 to H5, H7)**, each as its own PR with laws, a
  changelog and live verification.
- **Phase 7: Report to Dan** in plain English, phase by phase ("Phase N of X is
  done"), naming only what is verified live.

---

## 22. Exact First Actions For The Next Agent

1. Get the repo (cloud): `git clone https://github.com/Smarter-Software-PIQ/smarter-poker-club-arena`
   (full history preferred), or use an owned worktree. Never work in
   `~/Documents/club-arena` on the Mac.
2. Read `CLAUDE.md` (top three owner orders, sections 2, 10.5, 10.7c, 10.8 to
   10.12, 10.86 to 10.88, 11, 13), `AGENTS.md`, `PUBLISHING.md`,
   `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` and this file.
3. State checks:
   ```bash
   date -u
   curl -s https://engine.smarter.poker/health | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('releaseSha'),d.get('privateSitAndGoHolds'),d['maintenance']['phase'])"
   curl -s https://smarter.poker/hub/club-arena/build-info.json
   git fetch origin main
   for c in ffec83e5d 8d4a7ef72 08e32e4ad; do git merge-base --is-ancestor $c <releaseSha> && echo "$c engine LIVE" || echo "$c engine not live"; done
   gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/issues/11599/comments -q '.[-1].body' | head -8
   gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/11836 -q '.state,.merged'
   curl -s "https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/workflows/apply-merged-migration.yml/runs?per_page=50" | python3 -c "import json,sys;[print(r['conclusion'],r['created_at'],r['display_title'][23:100]) for r in json.load(sys.stdin)['workflow_runs'] if any(k in r['display_title'] for k in ['20261123013136','20261123071654'])]"
   ```
4. If 04:00 sealed and it is before 04:50 Chicago, merge #11836 (REST squash with
   the head sha). If after 04:50, wait for the 07:00 seal, then merge.
5. Do not modify the merged migration files (they are installed; changes need
   new migrations from `node scripts/new-migration.mjs`).
6. Resume at section 21, Phase 2.

---

## 23. Acceptance Criteria

- Engine `/health releaseSha` contains `ffec83e5d`, `8d4a7ef72` and `08e32e4ad`,
  and `privateSitAndGoHolds` is 1.
- `apply-merged-migration` shows success for 20261123013136 and 20261123071654.
- `main` contains #11836's change, and at least one later cycle is prepared and
  sealed after it merges.
- The live client `ca_sha` contains `08e32e4ad`.
- Live proof with the service identity:
  - a held seat can be taken only by the invited friend;
  - a stranger is told it is held and no money moves;
  - no horse sits in a held seat;
  - Cancel and expiry return the board to normal and the inviter is told;
  - unregister works before a Sit & Go fills;
  - Register/Unregister is one button, uncut at 375px;
  - a stale link offers the open game;
  - a tournament link with `?i=` takes a non-member through join and back;
  - an in-app invite arrives.
- On a phone (600px layout), every top chair's plate bottom is at its rail
  station and nothing overlaps the felt or the jackpot. Portrait sizes are
  unchanged.
- A full cash game always shows a list or an open chair. A called name never
  lapses because of pacing.
- All laws and proofs listed in section 21 Phase 4 pass on main. CSS Beat is
  green with no empty shard.
- No worktree or temporary file left behind.

---

## 24. Recommended Commit Strategy (remaining work)

- `test(ci): the cold observer family never outgrows a CSS Beat shard`: H1
  (tests only; run `--list --shard` for every shard of both partitions).
- `fix(release): an elected owner that prepared nothing yields the cycle`:
  residual P1. Release control; merge only post-seal; extend the punctual-cron
  law.
- `fix(table): a portrait tablet's top chair stands on the rail with its tabled hand above it`:
  H2 (client; full `table-proportions.spec.ts` plus CSS Beat).
- Each H3/H4/H5/H7 item as its own PR with a changelog and a law.

---

## 25. Final Continuation Summary

- **Exact stopping point.** All code is merged except the scheduler fix
  (#11836, open, green). The last tool call was waiting for the #11839 client
  publish (interrupted). It is 02:15 Chicago on 2026-11-23. The 04:00 cycle is
  owned by stage run 45134198393 and waiting for its 03:30 cutoff.
- **Work first on:** Phase 0 checks, then merging #11836 in the post-04:00-seal
  slot (before 04:50 Chicago), then confirming the engine and migration delivery.
- **Most important locked requirements:**
  - horses are treated identically (no `is_horse` deals);
  - top chairs on the rail on phones;
  - avatars never shrink;
  - fix at the root, no sweeps;
  - never auto-change tables;
  - migrations only from protected main;
  - plain-English reports to Dan with no claims of success before verification.
- **Greatest technical risk:** the release pipeline not shipping the engine parts
  (a certification gap or stranding).
- **Greatest visual risk:** tablets and untested invite or held-seat UI in a
  real browser.
- **Greatest data-integrity risk:** a held seat being taken before the 013136
  trigger installs, and the Sit & Go invite's registration plus hold transaction
  under concurrency.
- **Decisions still needing the user:** none required now. Possibly H3/H4 if
  investigation shows a genuine product choice.
- **How to continue without restarting discovery:** everything needed (which
  PRs and commits hold which change, which migrations are installed or queued,
  how to tell what is live, the release timing rules, every gate that failed and
  why) is in this file. Start at section 22, do Phase 0, and follow section 21 in
  order. Every change can be audited with `git show <squash sha>` against the
  bookmarks in section 7. Every claim of "live" must be re-proved with the
  merge-base ancestor check against the live client `ca_sha` and the engine
  `releaseSha`.

### Files created while preparing this handoff

- `/home/claude/handoff/HANDOFF-2026-11-23-club-arena-invites-rail-waitlist.md`
  (this file)
- `docs/HANDOFF-2026-11-23-club-arena-invites-rail-waitlist.md` in the
  repository, on a docs-only branch and PR (see the chat message for the PR
  number)
