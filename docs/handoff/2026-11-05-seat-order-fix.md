# MILITARY-GRADE CONTINUATION HANDOFF — Club Arena "Player Drawn In The Wrong Seat" Fix (Mongo's report)

Prepared 2026-11-05 ~15:20 America/Chicago (21:20 UTC) by the outgoing agent.
Paste this whole document into the new agent's first message.

---

## 1. Executive Continuation Brief

**What:** Smarter.Poker **Club Arena** (online poker client, Vite + React SPA) had a display bug on phones: a player was drawn in the wrong chair, so the action order looked wrong to everyone at the table.

**Report (Chris "Mongo", iPhone, 11:47–11:51 Chicago, PLO8 Morning Stack – Table 1, Midway Union):** "BigWade still acts when he should of he was in the other seat … it's moved him back and forth." BigWade was drawn in the bottom-left corner, below Cali_Duncan and next to Mongo, while the left-high chair stood empty.

**Root cause (CONFIRMED from data + code):** The engine was correct. Engine hand history, engine snapshots and `table_seats` all had: 1 sixesquads9, 2 Mongo (hero), 3 Cali_Duncan, 4 BUTTONCHAMP, 5 BigWade, 6 raypatel, 7 champp, 8 king_01, 9 EMPTY. The **client opponent-spacing allocator** `src/components/table/opponentAvatarLayout.ts` nudges avatars (`--sp-opponent-x/-y` on `.seat`) so broad art does not overlap. Its candidate shifts include "slide to the page edge", with no travel bound in the first passes. On a dense 9-max phone ring it parked seat 5's avatar ~580px down the left column, under seat 3. Each re-layout could choose differently, hence "back and forth".

**Status: FIXED, MERGED AND PUBLISHED.**
- PR #9546 squash-merged as **6e684dbef5336425076fc3d6ebd799d4e2f77465**, "fix(table): a player is always drawn in his own chair".
- Live builds now serve **32be41e184a37fb189878454dcfb3314f8de486d**, a later main commit (#9563, another agent) that CONTAINS the fix. This was verified with `git merge-base --is-ancestor`.
- The live JS and CSS assets were downloaded and inspected; the fix code is present (see §14).

**What is NOT finished:**
1. The post-deploy live browser verification (`post-deploy-e2e.yml`) for the live build was still running at handoff. The run for the fix commit itself was cancelled because a newer publish superseded it.
2. No screenshots or recording from a **real logged-in live mobile table** were captured. The agent cannot sign in; Dan's Chrome extension was not connected and the built-in browser was not signed in.
3. Dan asked for the chat to be archived. The agent has no tool to archive chats; Dan must do that himself.

**First action for the next agent:** check post-deploy run **42111267968** (live build 32be41e18). If its "Client browser verification" and "Live-table and engine verification" jobs passed, the remaining item is live mobile visual evidence (§21 Phase 2).

---

## 2. User Requirements And Working Preferences (Dan Bekavac, owner)

- **Root-cause, hard-coded fixes only**, then prevent recurrence (CLAUDE.md 10.11/10.12): "YOU NEED TO HARD CODE FIX THIS AT ITS ROOT CAUSE, THEN PREVENT IT FROM EVER HAPPENING AGAIN!" No monitors, sweeps or repair jobs as the fix.
- **Dan's explicit second ruling (13:18 Chicago), binding:**
  1. Every player's displayed position must correspond to his authoritative seat, with the correct rotation for the viewer. **"Preserving circular order alone is insufficient if players can still shift together into the wrong seat positions."** Verify empty seats, the viewer's position, and the wrap from the last seat to the first. This is a general constraint across all supported layouts; keep Mongo's table as a regression case.
  2. Avatar, name, stack, cards, bet, action indicator, note marker and **tap target** must all stay with the correct player and seat. Confirm whether the new note marker triggered it. Test notes on and off, long names, and marker dimensions.
  3. Verify real mobile rendering: repeated recalcs, resize, portrait/landscape, notes appearing, reconnects, hand transitions, join/leave, other seat counts and rotations. The fallback must be stable: no snap, oscillation or flicker. Keep regression coverage independent of the algorithm, plus a **browser-level** check.
  4. Publish through the normal frontend pipeline. Seat assignments, action order, balances and hand history must stay unaffected. Confirm the live assets contain the fix, and state whether open clients need a refresh.
  5. Final report must include: the merged commit and production build id; confirmation the build contains #9546; regression and browser results; **mobile screenshots or a recording after repeated updates**; confirmation that notes, action indicators and tap targets identify the correct player; and remaining limitations.
- Dan's later message (14:25): "GET EVERYTHING INSIDE THIS CHAT FINISHED, PUSHED AND PUBLISHED AND ARCHIVE THIS CHAT ONCE EVERYTHING IS VERIFIED."
- Standing preferences:
  - Report in plain English, not jargon, SHAs or identifiers as the main content.
  - Never ask Dan to do a job the agent can do, including merging its own PRs.
  - When Dan's input is needed, end the reply with the exact line he should send.
  - Don't claim success until verified.
  - AI players are "horses", never "bots".
- **Approval note:** this session's safety guard blocked the first merge as "Merge Without Review". Dan then gave explicit written sign-off: "APPROVED — MERGE PR #9546 AND SHIP THE SEAT-ORDER FIX LIVE." The merge succeeded after that.

---

## 3. Project And Repository Identity

| Item | Value | Status |
|---|---|---|
| Repo | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena` (GitHub; remote URL also seen as lowercase `smarter-poker-club-arena`, "repository moved" notice is harmless) | confirmed |
| Outgoing agent clone | `/home/claude/smarter-poker-club-arena` (cloud container, shallow clone) — **will not exist for the next agent** | confirmed |
| Branch used | `fix/chairs-never-change-order` (merged; PR #9546 closed) | confirmed |
| Default branch | `main` (protected; squash merges) | confirmed |
| Framework | Vite + React 19 + TypeScript; Playwright e2e; Vitest unit | confirmed |
| Package manager | npm (`npm ci --ignore-scripts` worked) | confirmed |
| DB | Supabase project `kuklfnapbkmacvwxktbh` ("PokerIQ-Production") | confirmed |
| Hosting | Hetzner static origin `https://ca-static.smarter.poker`, served via World Hub rewrite at `https://smarter.poker/hub/club-arena/` | confirmed |
| Publisher | `.github/workflows/publish-club-arena.yml` | confirmed |
| Live verification | `.github/workflows/post-deploy-e2e.yml` | confirmed |
| Engine | Hetzner game server, **not changed** by this work | confirmed |

---

## 4. Repository Map (relevant only)

| Path | What / why | Modified? |
|---|---|---|
| `src/components/table/opponentAvatarLayout.ts` | Opponent avatar spacing allocator (`createOpponentAvatarLayout`, `jointOpponentShifts`). **Root-cause file.** | YES |
| `src/components/table/SeatSlot.css` | Seat styles; `--sp-opponent-x/y` translate on `.seat`. Tap-area fix added after the `.table-page .seat:not(.seat--hero)` translate rule (~line 395–420). | YES |
| `src/components/table/SeatSlot.tsx` | Seat markup; avatar `onClick` lives on `.seat__avatar` (~line 3290); note marker `.seat__note-marker` (~3417). | no |
| `src/hooks/useProtectedCardLayout.ts` | Calls `artwork.space()`, `ready()`, `awaitingInitialLayout()`, `lock()`, `tryShiftOwnerForWager`. | no |
| `src/lib/tableSeatGeometry.ts` | Seat rings per size (`SEAT_LAYOUTS` 2..9, `SEAT_POSITIONS_10MAX`), `rotateSeatsForHero`, `seatRingSize`. Verified correct. | no |
| `src/components/table/tableGeometry.ts` | `fitSeatToViewport`, `seatPodPx`. Verified order-preserving. | no |
| `src/utils/mapEngineSnapshot.ts` | Engine snapshot to per-seat arrays (index = seat-1). Verified correct. | no |
| `src/pages/TablePage.tsx` (~32k lines) | Renders `seatPositions.map((pos, idx) => …)` (~line 28746); `getPlayerAtSeat`; `positions[idx]`. Verified seat-indexed. | no |
| `tests/the-chairs-never-change-order.law.test.ts` | NEW permanent law (unit). | NEW |
| `docs/laws.d/the-chairs-never-change-order.md` | Law registry entry (required by `tests/law-registry.law.test.ts`). | NEW |
| `tests/e2e/css/the-chairs-never-change-order.spec.ts` | NEW browser-level check (real CSS + real ring/fit/allocator, bundled with esbuild into `page.setContent`). | NEW |
| `tests/unit/opponentAvatarLayout.test.ts` | Existing fixture "fits all eight compact opponents…" updated for the new rule. | YES |
| `.github/workflows/ci.yml` | Added the new spec to the CSS Beat Playwright list (~line 4858). | YES |
| `scripts/qualification/*/source-binding.json` (6 files) + `scripts/qualification/cash-native-hosted.manifest.json` | Re-pinned sha256/bytes of `ci.yml` (required by `scripts/ci/verify-source-bindings.py`). | YES |
| `tests/unit/requiredCiRunnerRecovery.test.ts` | Re-pinned `css-beats-e2e` job hash. | YES |
| `tests/unit/browserDeliveryParallel.test.ts` | CSS Beat spec count 26 → 27. | YES |
| `docs/changelog/2026-11-05-the-chairs-never-change-order.md` | Changelog (required by CLAUDE.md 10.9). | NEW |

---

## 5. Applicable Instructions

Read before editing: `CLAUDE.md` (root, long), `AGENTS.md`, `AGENT-PLAYBOOK.md`, `PUBLISHING.md`, `docs/agent-policy/REFERENCE-INDEX.md`.

Rules that shaped this work:
- 10.11/10.12: root fix, no band-aids.
- 10.8: every `*.law.test.*` needs a `docs/laws.d/` entry.
- 10.6: animation law, untouched.
- 1.4: claim "deployed" only when the merged SHA is visible on both build-info endpoints.
- "NEVER PUSH A RED TEST".
- `.husky/pre-push` runs touched tests; never `--no-verify`.
- 2026-11-05 CLAUDE.md note: push with `bash scripts/agent-push.sh` from your own worktree. Plain `git push` worked in this container.
- Client-only change: no engine window and no migration needed.

---

## 6. Complete Discovery Record

**Data evidence (Supabase `kuklfnapbkmacvwxktbh`):**
- Table `8dd73d4c-5be5-4e1d-8795-91a13e4d0056` = "PLO8 Morning Stack - Table 1", max_players 9.
- `hand_history` rows (#55414869 11:47:52, #55415924 11:49:45, #55416829 11:51) list seats 1–8 as above, with BigWade = seat 5 (`userId 9ecd6262-…`).
- `hand_state_snapshots` (engine) agrees.
- `table_seats` agrees on seat numbers. Seats 3/4/5 carry `status='left'` with `left_at IS NULL` (stale status). That is not the cause, but it is a data oddity worth noting. Their profile usernames are mitten / quillhuntington / oc_sophia; horses display aliases.
- Screens (`hand #55416820` shown) map to hand_history 55416829.

**Screenshot analysis:**
- Position labels on Mongo's phone were correct for each player: BigWade "MP"/"CO"/"BB" = seat 5. So the state arrays were right.
- Right side (king R-high, EMPTY R-low, sixes lower-right cap) matched the ring with the hero at seat 2.
- Left side: Cali at the lower-left cap, BUTTONCHAMP at left-low, left-high **empty**, and BigWade drawn below the caps at ~y 100%.
- So only BigWade's `.seat` was translated. The wrapper (rail anchor) was correct.

**Code facts verified:**
- `rotateSeatsForHero`, `seatRingSize`, `fitSeatToViewport`, `mapEngineSnapshot`, GAME_START merge, DB restore and presence merge are all seat-indexed and correct.
- `seatIdentityOverrides` changes only avatar/frame/aura.
- The allocator writes `--sp-opponent-x/y`. `SeatSlot.css` applies them with `translate … !important` on `.table-page .seat:not(.seat--empty)`.
- In `jointOpponentShifts`, `opponentShiftCandidates` adds `bounds.top + bounds.height - part.top - part.height` (slide to the page bottom). On the first two passes `topLaneBottom` is undefined, so `withinAuxiliaryLane` returns true and travel is unbounded.

**The note marker was NOT the trigger.** It is a 16px absolutely positioned child of the avatar and is not part of the spacing measurement.

**Additional defects found and fixed:**
1. On a **10-max, viewer seat 3, 375px** ring, the OLD code moved p2 **253px** down into the next seat (found by the new browser test).
2. On the **320px nine-seat ring**, the previously accepted layout slid the right-high chair ~70px into the top-right cap's spot. Order was kept, but the two players sat in each other's seats.
3. **Tap theft:** scaled character art (`scale: var(--sp-opponent-art-scale)` on `.seat__avatar`, plus `--sp-bust-scale` on the img) overhung a neighbour's name plate. A tap there opened the NEIGHBOUR's player menu.
4. When no spacing solution existed, `space()` set `spacingReady=false`. That made `awaitingInitialLayout()` true, and `useProtectedCardLayout` then returned early, holding back bet, button and tag placement.

---

## 7. Work Completed (all merged in #9546 → 6e684dbef)

**A. Ring-order law** (`opponentAvatarLayout.ts`)
- Added `opponentRingOrderKept(before, after, centre?)`: the clockwise angular order of every chair (occupied, empty, hero) must be identical.

**B. Own-seat law (Dan's second ruling)**
- Added `opponentSeatsKept(rails, shown, centre?)`: order kept AND every shown chair is nearer its own rail than any other rail.
- `jointOpponentShifts` gained params `otherChairs: ChairPoint[]` (hero and empty rails) and `seatRule: 'own-seat' | 'compact'`.
- Inside its search, a full solution is accepted only if it passes the rule; otherwise the search continues.

**C. Compact rule (smallest phones only)**
- Added `opponentSeatsCompact`: order kept AND each chair's travel is ≤ 1.1 × the distance from its rail to the nearest other rail.
- `space()` now runs all solver passes with `'own-seat'` first. Only if that yields nothing does it clear action translates and rerun all passes with `'compact'`.
- Reason: on a 320px nine-seat ring no own-seat layout exists without overlapping plates and bets reading as another player's. This was proven by `tests/e2e/table-proportions.spec.ts` failing in CI on the first strict attempt.
- Mongo's frame (580px) and the 10-max 253px drop both fail the compact rule.

**D. Rails fallback**
- If both rules fail, every chair is placed exactly on its rail (`[0,0]`) and recorded in `state.shifts`.
- `spacingReady` is no longer set false, so markers are placed and the next pass short-circuits. No oscillation.

**E. DOM backstop `holdChairs()`** (inside `createOpponentAvatarLayout`)
- Reads each chair's wrapper rect (rail; the nudge never moves the wrapper) and its current nudge.
- If the frame passes neither `opponentSeatsKept` nor `opponentSeatsCompact`, it withdraws every nudge.
- It runs after every `space()` (the public `space` is wrapped) and inside `tryShiftOwnerForWager` before `accept()`.

**F. Tap-area fix** (`SeatSlot.css`)
- `.table-page .seat .seat__avatar { pointer-events:none }`.
- `.seat__avatar::before { content:''; position:absolute; inset:0; pointer-events:auto; transform-origin:50% 100%; scale: calc(1 / var(--sp-opponent-art-scale, 1)) }`. Hero gets `scale:1`.
- Art paints as before; the tap area equals the unscaled slot; clicks dispatch to `.seat__avatar`, so handlers are unchanged.

**G. Tests and CI wiring** (see §11 and §14).

---

## 8. Visual Decisions
No artwork or visual design changed. Art scale, positions on the rail, fonts and colours are untouched. The only visual difference: chairs that used to be shoved off their seat now stay on it, and on tiny phones neighbours may lean by at most about one seat gap.

## 9. Functional Decisions
- Engine, seat assignment, action order, balances and hand history: **untouched** (client-only presentation fix).
- No engine release, no DB migration, no maintenance window needed.

---

## 10. Exact Current State (21:20 UTC)

- main HEAD `32be41e18` (#9563, another agent), which contains `6e684dbef` (#9546).
- Both build-info endpoints report `ca_sha 32be41e184a37fb189878454dcfb3314f8de486d`, built 2026-11-05T21:15:26Z, `publish-club-arena.yml` run 42110187944.
- The fix-commit publish run 42108715157 also succeeded and was live at 21:04:47Z before being superseded.
- Post-deploy run **42111267968** (for 32be41e18) was IN PROGRESS:
  - "Confirm The Hetzner Web Publish Reached Production": success
  - "Installed certification cleanup protects live tables": success
  - "The Live SEO Contract Holds": in progress
  - "Client browser verification": pending
  - "Live-table and engine verification": pending
- Another post-deploy run 42110790843 for the same SHA was pending.
- Post-deploy run 42109683262 (6e684dbef) was **cancelled** (superseded), not failed.
- Outgoing container git status: clean on `fix/chairs-never-change-order` (already merged; nothing unpushed).


**Update 21:50 UTC: after-publish results for the live build.** Both post-deploy runs on 32be41e18 (42110790843 and 42111267968) failed one test: "320px live mobile table containment" reported "Six-Max Crown Does Not Meet The Top Bar" (`tests/e2e/support/mobileLiveTableLayout.ts` ~line 662, from `production-live-table-realtime.spec.ts:2565`). **This is not caused by #9546.** The same failure, with the same message, happened BEFORE the fix existed, on d505ec5bc (run 42094502522), 5e2d6a233 (42093085472) and ac00b6426 (42084140655). It passed on 2b98f67c4 and 2433d2cb7, so it comes and goes. The other three live-table tests passed. "Client browser verification" was cancelled (superseded) on both runs. Next agent: watch the post-deploy run for ef412e45f or later. If you take on the crown failure, treat it as a separate defect: the six-max top seat's avatar art does not reach the top bar (allowed gap is -12 to +2 scaled px, and it only applies when the table is wider than 480px).

## 11. Changed-File Ledger (all committed and merged in #9546)

| File | Status | Purpose | Verified |
|---|---|---|---|
| src/components/table/opponentAvatarLayout.ts | modified | rules, solver gating, compact pass, rails fallback, holdChairs backstop | unit + browser + CI |
| src/components/table/SeatSlot.css | modified | tap area bounded to own slot | browser + CI |
| tests/the-chairs-never-change-order.law.test.ts | new | law: order, own-seat, compact, seat-number mapping 2–10 every viewer seat, DOM backstop | pass |
| docs/laws.d/the-chairs-never-change-order.md | new | law registry | registry test pass |
| tests/e2e/css/the-chairs-never-change-order.spec.ts | new | browser-level rendered check | 4/4 local pass; CI pass |
| tests/unit/opponentAvatarLayout.test.ts | modified | 320px fixture now asserts old answer refused under own-seat, accepted under compact | pass |
| .github/workflows/ci.yml | modified | spec added to CSS Beat list | CI pass |
| scripts/qualification/{cash-original17,original-flow-eligibility,weekly-cohort-cutoff,weekly-initial-selector,weekly-standalone-selector}/source-binding.json, scripts/qualification/cash-native-hosted.manifest.json | modified | ci.yml re-pin | verify-source-bindings pass |
| tests/unit/requiredCiRunnerRecovery.test.ts | modified | css-beats-e2e hash re-pin | pass |
| tests/unit/browserDeliveryParallel.test.ts | modified | spec count 27 | pass |
| docs/changelog/2026-11-05-the-chairs-never-change-order.md | new | changelog | n/a |

## 12. Asset Ledger
- Mongo's 5 screenshots were uploaded to the chat only (container paths `/mnt/user-data/uploads/Screenshot_2026-11-05_at_11_54_58AM.png` … `11_55_24AM.png`); they are **not persisted in the repo**.
  - 11_54_58 = 11:47 table
  - 11_55_04 = 11:49 table
  - 11_55_11 = 11:51 table
  - 11_55_17 and 11_55_24 = iMessage threads
- Browser-test art fixtures used: `tests/e2e/fixtures/table-art/vip_wolf@2x.webp`, `vip_aztec_warrior@2x.webp` (pre-existing).
- Browser screenshots (portrait renders, correct seat order) were produced in the outgoing container under `test-results/the-chairs-never-change-order/` and are **lost** with the container. Regenerate as described in §13.

## 13. Commands

- Install: `npm ci --ignore-scripts --no-audit --no-fund`
- Type-check: `npx tsc --noEmit -p tsconfig.app.json` → clean
- Unit/law: `npx vitest run tests/the-chairs-never-change-order.law.test.ts tests/unit/opponentAvatarLayout.test.ts tests/unit/protectedCardLayoutRevision.test.tsx tests/law-registry.law.test.ts`
- Bindings: `python3 scripts/ci/verify-source-bindings.py` → "Every pinned source file still hashes to its recorded bytes."
- Browser (local, no login): `npx playwright install chromium`, then a temporary config at repo root (do NOT commit it):

  ```ts
  import { defineConfig } from '@playwright/test';
  export default defineConfig({ testDir: './tests/e2e', testMatch: /(css\/the-chairs-never-change-order|table-proportions)\.spec\.ts$/, workers: 1, retries: 0, timeout: 300_000, reporter: 'line', use: { browserName: 'chromium' } });
  ```

  Run `npx playwright test -c <that file>`. Screenshots land in `test-results/the-chairs-never-change-order/`.

  Use **workers: 1**. With 4 workers, the 320px 9-seat table-proportions cases flake locally, including on unmodified main.
- Live asset check: fetch `https://ca-static.smarter.poker/index.html`, find `assets/index-*.js`, grep it for `assets/TablePage-*.js`, then grep that file for `"compact"`. Grep `CommunityCards-*-v6.css` for `calc(1 / var(--sp-opponent-art-scale, 1))`.
- Merge used: `gh api -X PUT repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/9546/merge -f merge_method=squash -f sha=<head>`

## 14. Verification Results

| Verification | Result |
|---|---|
| Type-check | PASS |
| Law + allocator unit tests (56) | PASS |
| 323 seat/layout/table unit files (3,915 tests), first version | PASS |
| New browser spec: Mongo table (notes on/off, long names, 5 passes), forced Mongo frame repaired, 6 phone sizes incl. landscape with join/leave, every size 2–10 × every viewer seat | 4/4 PASS locally; CI pass |
| Same browser spec against OLD code | FAILS on 10-max viewer-3 (p2 in seat 3's spot) and landscape (champp nearer seat 8). Proves it catches the bug class. Does NOT reproduce Mongo's exact case (his real art unavailable). |
| table-proportions 320px 9-seat (6 cases), serial, with fix | 6/6 PASS locally |
| PR #9546 CI, final head 15f85eee | ALL checks success (64) |
| Publish run 42108715157 | success |
| build-info both endpoints | now 32be41e18, which contains 6e684dbef (ancestry verified) |
| Live assets contain fix | YES: TablePage-D0BY6i_k-v6.js has `"compact"===o?…` and `F("compact")`; CommunityCards-D-zUrNd4-v6.css has the `seat__avatar:before … scale:calc(1 / var(--sp-opponent-art-scale, 1))` rule |
| Post-deploy e2e for live build | **IN PROGRESS at handoff (run 42111267968)** |
| Live logged-in mobile table screenshots/recording | **NOT DONE** (no sign-in available) |
| Reconnect and hand-transition behaviour on a live table | **NOT DIRECTLY TESTED**. Covered in principle: the allocator re-runs per layout key and the backstop runs on every pass. |

Not-this-change failures seen:
- `Club Create Certification` fails on every recent main at the "ubuntu-apt-mirror.py" step.
- Locally, `tests/unit/privateRecordHosting.test.ts` fails on plain main in the container (environmental).

## 15. Setbacks And Lessons
- First fix used ring order only. Dan rejected order-only, so own-seat was added. The 320px CI then failed: no own-seat layout exists there. Solution: the tiered compact rule.
- Option-filtering by nearest-rail killed the legitimate 320px fixture. Whole-solution checks plus a second tier work.
- Editing `ci.yml` cascades: 6 source-binding pins, the `requiredCiRunnerRecovery` hash and the `browserDeliveryParallel` spec count. Tests in `tests/e2e/` top level must be wired into post-deploy or declared (ratchet ≤ 18). Putting the spec under `tests/e2e/css/` avoids that.
- The harness has no TablePage: landscape felt sizing is not representative, so taps and decorations are asserted only in portrait.
- Auth: the agent cannot type passwords. Live screenshots need Dan signed in (built-in browser) or the CI post-deploy jobs (service identity).
- One background wait was killed at its time limit. Use `until` loops with `run_in_background`, under 60 min.

## 16. Known Defects / Holes

| Pri | Item | Status |
|---|---|---|
| High | No live logged-in mobile visual proof yet | open |
| Med | `table_seats` rows 3/4/5 on table 8dd73d4c had `status='left'` with `left_at NULL` while seated (stale status). Not the cause, but suspicious seat-row hygiene. | open, uninvestigated |
| Med | Compact tier still lets neighbours lean up to ~1.1 seat gaps on 320px phones. Dan's strict wording is satisfied everywhere except where physically impossible. **Tell Dan.** | by design, disclosed |
| Low | Landscape phone not representable in harness | limitation |
| Low | Already-open clients keep the old bundle until a normal refresh or reload (`index.html` is `max-age=0, must-revalidate`; old assets remain in the append-only pool). | expected |

## 17. Secrets
None handled. `gh` was preconfigured in the container. No secret values were printed.

## 18. Database
No schema or data changes. Read-only SQL only.

## 19. Blockers / Decisions
- Live mobile screenshots need a signed-in browser. Ask Dan to sign in to smarter.poker in the Claude desktop app's built-in browser, or rely on post-deploy "Client browser verification" and "Live-table and engine verification".
- Archiving the chat: only Dan can do it.

## 20. Remaining Work
- **Critical:** confirm post-deploy run 42111267968 (or the newest post-deploy for a commit containing 6e684dbef) is green, especially "Client browser verification" and "Live-table and engine verification". If red, read the failing job and fix the root cause if it is this change's.
- **High:**
  - Capture live mobile evidence: Mongo's table or any 9-max cash table at 375–393px width, several hands, notes on and off; tap each plate; confirm the right player menu.
  - Report to Dan in plain English with the §2 item 5 list.
- **Medium:** investigate the stale `status='left'` seat rows.
- **Optional:** add a production e2e case for seat order on a live table.

## 21. Next-Phase Plan
- **Phase 0:** Clone the repo and read CLAUDE.md, PUBLISHING.md and the changelog file. Confirm `git log origin/main` contains `6e684dbef`. Confirm both build-info endpoints report a SHA whose ancestry contains `6e684dbef`.
- **Phase 1:** Check post-deploy (`gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/workflows/post-deploy-e2e.yml/runs?per_page=5`). If green, move on. If red, read the failing step; decide whether it's this change or unrelated (compare with other recent runs); fix or report.
- **Phase 2:** Live visual proof via a signed-in browser (Dan signs in himself), phone viewport. Screenshots after repeated hands, notes toggled, tap targets checked.
- **Phase 3:** Final plain-English report to Dan; remind him to archive the chat.

## 22. Exact First Actions
1. `git clone --depth 50 https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena && cd Smarter-Poker-Club-Arena`
2. Read `CLAUDE.md`, `PUBLISHING.md`, `docs/changelog/2026-11-05-the-chairs-never-change-order.md`.
3. `git log --oneline -30 | grep "own chair"` to confirm `6e684dbef`.
4. `curl -s https://smarter.poker/hub/club-arena/build-info.json` and `curl -s https://ca-static.smarter.poker/build-info.json`, then `git merge-base --is-ancestor 6e684dbef <ca_sha>`.
5. Check post-deploy run status (Phase 1).
6. Do NOT change `opponentAvatarLayout.ts` rules without updating the law test and Dan's rulings.

## 23. Acceptance Criteria
- Live build contains #9546 (DONE).
- Post-deploy client and live-table verification green on a build containing it (PENDING).
- On a live phone table, every player is drawn in his own chair, in order, after repeated hands; notes, action tags, badges and taps belong to the right player (PENDING visual proof).
- Engine, seat, action order, balances and hand history unchanged (DONE, client-only).

## 24. Commit Strategy
No further commits are required. If you add a live e2e spec: one PR, "test(e2e): live seat order holds on a phone table", wired into `post-deploy-e2e.yml` or declared.

## 25. Final Continuation Summary
The fix is merged and live. The only open items are: confirm the post-deploy live verification is green, capture live mobile visual evidence (needs a signed-in browser), and give Dan a plain-English final report.

Greatest technical risk: the compact tier on 320px phones (by design). Data-integrity risk: none from this change; stale `status='left'` seat rows are a separate question. Dan must archive the chat himself.

Continue from Phase 1 without re-doing discovery. The root cause, the fix, the laws and the tests are all on main.
