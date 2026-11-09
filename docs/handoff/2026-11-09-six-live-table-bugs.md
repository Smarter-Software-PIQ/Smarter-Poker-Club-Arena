# MILITARY-GRADE CONTINUATION HANDOFF

# Club Arena — Dan's six live-table bugs, 2026-11-09

Written 2026-11-09 ~15:40 UTC (09:40 America/Chicago) by the agent that did the work.
Every claim below is labelled **CONFIRMED**, **UNVERIFIED**, or **UNKNOWN — NEXT AGENT MUST INSPECT**.
No secret values appear anywhere in this document.

---

## 1. EXECUTIVE CONTINUATION BRIEF

**What is being built.** Club Arena is the online-poker product inside the
Smarter.Poker platform: a Vite + React 19 + TypeScript single-page app published
to its own Hetzner static origin and served to players through a World Hub
rewrite at `https://smarter.poker/hub/club-arena/`. The authoritative game engine
is a separate Node service on a Hetzner VPS. Dan Bekavac is the founder and the
sole product owner; he reports defects from screenshots of live play.

**The business/product objective of THIS task.** On 2026-11-09 Dan sent three
screenshots — a live PLO4 Lightning cash table and a finished heads-up match —
and listed six defects, saying "you need to fix all of these bugs now". Four are
visual/ergonomic defects on the felt; one is an overlay z-order defect; one is a
correctness defect that told a losing player they had won and quoted a prize they
had not been paid. The objective was all six fixed, merged, published and proved
live.

**Current phase: CLOSEOUT.** All six are delivered and live. One documentation
pull request is still open to put the final record on `main`.

**Major work completed (CONFIRMED).**

- Items 1, 2, 3, 5, 6 merged as squash `490c72a315a000f66575edb6cd53b96e5635da41` (PR #10151), publisher run `42630046134` terminal-success.
- Item 4 merged as squash `6a91dbe1cde711d021452e799bb0e4968fabb465` (PR #10172), publisher run `42642327309` terminal-success.
- All six verified present in the **current** live bundle (see §10).

**The immediate unfinished objective.** Merge PR **#10185**
(`docs/six-fix-checkpoint-final-2026-11-09`, head `b753cdeebfdcf8905bd6c7e879953352f58efdd7`).
It contains the closing checkpoint record **and one source fix found while writing
this handoff** (§7.7 — a comment that asserted the opposite of the code).

**THE MOST IMPORTANT THING THE NEXT AGENT MUST UNDERSTAND.**
`--seat-avatar-hero-ratio` **is 1.3333 and must stay 1.3333.** Dan's 2026-11-09
complaint that "the hero avatar is smaller than all the other avatars" was NOT
caused by that ratio, and setting it to 1 breaks four separately measured
constants at once (proven by experiment, §15.1). A comment shipped in
`490c72a31` wrongly claimed the ratio was superseded and that "at 1 the frame and
the bust agree"; that comment is corrected in PR #10185 but **is still on `main`
until #10185 merges**. If you read `src/styles/design-tokens.css` on `main`
before that merge, the comment there is wrong and the value is right.

**FIRST ACTION.** See §22. In short: confirm #10185's checks, merge it, confirm
the publisher, confirm both endpoints, then release the work tree
`/home/claude/ca-work`.

---

## 2. USER REQUIREMENTS AND WORKING PREFERENCES

### 2.1 The assignment, Dan's exact words (the authority for all six)

> 1, the stand up and leave button for lightning games needs to move to the left side, not in the middle of the table covering the top villain. (see 1st attached image). And it should just say, "Leave Next Hand"
> 2, the fold check bet buttons are too small on movile, they should be double the current size. we have alot of room on the bottom to increase the sizes.
> 3, the message button, previous hand, time bank and rabbit hunt buttons should all be the same size as the hamburger menu button.
> 4, the "hero" avatar is smaller then all the other avatars at the table, it should always be the same size.
> 5, the action slider menu that pops up when click raise, allows the time bank to appear and bleed through. (see 2nd attached image)
> 6, in heads up, the loser received a Champion and prize 38 even though they lost. (see 3rd attached image).
> you need to fix all of these bugs now.

The three screenshots were pasted into the chat. **They are NOT in the
repository and are NOT recoverable from this handoff.** What was read off them is
recorded in §6 and in the changelogs; if you need the images, ask Dan.

### 2.2 Later instructions from Dan in this chat (all CONFIRMED, all binding)

1. "Merge PR #10151 and publish it through the normal protected route now. Verify the deployed revision at both public endpoints, then check the five shipped fixes in the signed-in browser on phone and desktop. This client delivery can proceed independently of the engine cutover."
2. "Keep the two action-button size exceptions explicitly recorded."
3. "The hero-avatar requirement remains assigned. Finish it in a separate focused change. Measure the visible hero and opponent artwork across supported layouts and fix any actual size difference without disturbing hole cards or action controls. If measurements establish equal visible sizing already, document that evidence and identify what causes the reported appearance before changing the frame."
4. Scope reset: "Reset this chat to its original authorized scope... Identify unrelated work you adopted. Preserve its files and evidence, hand it to the established owner and obtain acknowledgment... Keep one checkpoint for this task, remove unrelated completion gates, and finish the original assignment without expanding into other programmes."
5. "Issue #10176 belongs to its owner. Their acknowledgment is not a completion gate for this chat once your delivery passes its required checks."
6. "Keep the three remaining behavioral checks accurately marked as test-covered until observed live. Use an existing approved test route if available; creating a new test club or funding accounts requires separate scope."
7. "Describe the earlier timeout as unresolved timing fragility unless its cause was independently established; a later pass alone does not prove it was a flake."
8. "No additional improvements are needed." — the seven improvement ideas in §20.5 are **recorded, NOT authorized**.

### 2.3 Dan's standing working preferences (from persistent memory, CONFIRMED)

- Operate as lead project manager with full autonomous execution authority; announce the plan and execute; surface only genuinely irreversible product decisions.
- **No unverified data.** Never fabricate analysis. Never default to stale dates.
- Report progress in **plain English, not engineering jargon** — commit hashes, statistics and internal identifiers must not be the main content: "i have no clue what your talking about or what you worked on".
- **Never ask Dan to do a job the agent can and should do itself** — including merging its own pull requests and finishing delivery through to live: "DON'T EVER ASK THE HUMAN TO DO A JOB YOU CAN DO AND SHOULD DO".
- When the agent genuinely needs Dan to say something to unblock it, **end the reply with the exact line he should send back, word for word**.
- Do not claim success until everything is verified finished.
- Mobile-first: 375px first, then scale up.
- Agent work trees belong on the external SSD, not the Mac boot drive, and an agent deletes what it no longer needs — its work tree included — once finished. (N.B. this session ran in a cloud container, not on the Mac; see §3.)

### 2.4 Locked product rules this task touched (from `CLAUDE.md`, all binding)

- **10.5 HORSES ARE PLAYERS.** A horse is treated identically to a human in everything. Never use `is_horse` to deny a horse anything. Relevant here: the avatar work must not branch on horse identity, and it does not.
- **10.6 ANIMATIONS MUST ALWAYS PLAY / NEVER AUTO-CHANGE TABLES.**
- **10.7 "em bars" means EM DASHES (U+2014), nothing else.** It is a copy rule. It does **not** ban the hamburger menu or any artwork. Two agents misread it and removed the hamburger from the whole app twice in two days.
- **Dan 2026-08-20 (binding):** every popup/toast renders with First Letter Of Every Word Capitalized and **em dashes are forbidden in popup text**, enforced centrally in `src/utils/popupStyle.ts`.
- **Dan 2026-08-15 (binding, STILL IN FORCE):** "HERO avatar should always be 33% bigger than the villains."
- **Dan 2026-08-20 (binding):** "avatars must be CONNECTED to the name box" — an avatar deliberately tucks into its own seat's name plate. A small own-seat overlap is correct, not a defect.
- **Section 5 rule 8, NEVER PUSH A RED TEST.** `npx vitest run tests/` in `publish-club-arena.yml` is what publishes the bundle; a red test stops the publish for every agent.
- **Section 5 rule 3:** no emoji in source files (breaks the SWC compiler).
- **10.9 / 10.11 / 10.12:** fix at the root; a detector, a repair job, a cron or a back-pay pass is never the fix.
- **10.86:** "I could not tell" is a distinct outcome and must have its own name; never coerce an unreadable answer into an empty one; every guard must have a named reader; a fix that leaves the same trap one level up has not landed.
- **1.4 Claiming success:** a change is deployed only after required checks and merge are green, the owning Hetzner workflow is terminal-success, **and** the exact merged revision is independently visible on the live endpoint. Never say "should be live in a few minutes".

---

## 3. PROJECT AND REPOSITORY IDENTITY

| Field                             | Value                                                                                                                                                                                     | Status    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Project                           | Club Arena (Smarter.Poker)                                                                                                                                                                | CONFIRMED |
| GitHub repository                 | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`                                                                                                                                           | CONFIRMED |
| Previous owner name               | `Smarter-Poker` (renamed). The old owner path answers with a redirect to the numeric repo id and some proxies refuse clients that follow it — **prefer the new owner path**               | CONFIRMED |
| Repository root used this session | `/home/claude/ca-work` (a **git worktree**)                                                                                                                                               | CONFIRMED |
| Parent clone                      | `/home/claude/smarter-poker-club-arena`, on branch `main` at `f05296451`                                                                                                                  | CONFIRMED |
| Git dir of the worktree           | `/home/claude/smarter-poker-club-arena/.git/worktrees/ca-work`                                                                                                                            | CONFIRMED |
| Active branch in the worktree     | `docs/six-fix-checkpoint-final-2026-11-09`                                                                                                                                                | CONFIRMED |
| Worktree git status               | **clean**, nothing staged, unstaged or untracked                                                                                                                                          | CONFIRMED |
| Remote `origin`                   | `https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena`                                                                                                                        | CONFIRMED |
| Framework                         | Vite + React 19 + TypeScript, React Router v7, CSS Modules + global CSS                                                                                                                   | CONFIRMED |
| Package manager / runtime         | npm; Node v22.23.4 in this container                                                                                                                                                      | CONFIRMED |
| Test runners                      | vitest v4.1.11 (unit + law), Playwright (e2e, "CSS Beat")                                                                                                                                 | CONFIRMED |
| Database                          | Supabase PostgreSQL (project ref `kuklfnapbkmacvwxktbh` appears in test fixtures) — **no database work in this task**                                                                     | CONFIRMED |
| Client hosting                    | Hetzner static origin `https://ca-static.smarter.poker`, served through the World Hub rewrite `/hub/club-arena/:path*`                                                                    | CONFIRMED |
| Engine hosting                    | Hetzner VPS `5.161.252.33` = `engine.smarter.poker`. **Not touched by this task.**                                                                                                        | CONFIRMED |
| Backup engine host                | `5.161.236.0`, reachable only as `ssh ca-backup`. **Not touched.**                                                                                                                        | CONFIRMED |
| Execution environment             | Ephemeral Anthropic cloud container, linked to Dan's Mac Studio (`smarterpokers-mac-studio-local`) through the remote-devices bridge. **Nothing in this container survives the session.** | CONFIRMED |

### 3.1 Environment facts that cost time and will cost the next agent time

1. **`git remote` comes back lowercase from the repo-attach tool.** The pre-push
   merged-branch guard then fails with
   `[merged-branch guard] BLOCKED: GitHub did not identify the trusted destination repository`.
   **Fix, always, immediately after attaching the repo:**
   `git remote set-url origin https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena`
   (exact casing). This happened twice in this session. CONFIRMED.
2. **GitHub GraphQL is refused from this session type.** `gh pr create`,
   `gh pr merge` and anything else GraphQL-backed return
   `HTTP 403: GitHub GraphQL is not available from Claude Code sessions`.
   **Use REST**: `gh api -X POST repos/{owner}/{repo}/pulls --input body.json`,
   `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=squash -f sha=<head>`.
   CONFIRMED.
3. **`env -u GH_TOKEN -u GITHUB_TOKEN gh ...` does NOT work here.** `CLAUDE.md`
   §11 recommends it for the Mac, where `gh` has its own login. In this cloud
   container the ambient `GH_TOKEN` is the only identity and stripping it gives
   `gh auth login`. The ambient token **can** merge over REST — it did, twice.
   CONFIRMED 2026-11-09; re-check in one call before routing around it (10.86).
4. **Pushing takes minutes.** `.husky/pre-push` runs a long battery of guards.
   Always `bash scripts/agent-push.sh` (never bare `git push`), expect 2–6
   minutes, and run it with a long timeout or in the background. CONFIRMED.
5. **`scripts/guard-shared-clone.sh` refuses pushes from the shared clone.** Work
   in a worktree. CONFIRMED.
6. **The commit author guard refuses `noreply@anthropic.com` as the author.** This
   session used
   `user.name "Smarter-Poker"`, `user.email "254329056+Smarter-Poker@users.noreply.github.com"`.
   The `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer is fine —
   it is the **author** field that is guarded. A harness reminder repeatedly asked
   for `noreply@anthropic.com` as the author; that was declined each time and the
   decision must stand. CONFIRMED.
7. **Playwright and Chromium are pre-installed.** Do not run `playwright install`
   or reinstall Playwright — another version will not find this browser.
   `CI=1` skips the webServer for the CSS Beat specs. CONFIRMED.
8. **`node_modules` in the worktree is symlinked from the parent clone.**
   CONFIRMED (set up this session).
9. **A `.mjs` script placed in the scratchpad cannot `import 'playwright'`** —
   Node resolves packages from the script's directory. Copy such scripts into the
   repo root to run them. CONFIRMED.
10. **Esbuild prints an `import.meta` / "set the output format to esm" warning**
    when bundling the test fixture in IIFE format. It is noise; the bundle works.
    CONFIRMED.
11. **Running the full `table-proportions` suite takes ~10.2 minutes** and
    saturates the container's CPU, which can make _other_ vitest files exceed
    their timeouts. Do not run both at once. CONFIRMED (this is what tripped the
    horse-refund scan at 39.1 s — §16.1).

---

## 4. REPOSITORY MAP (the paths that matter for this task)

```
/home/claude/ca-work/                                   ← worktree, work here
├── CLAUDE.md                                           ← BINDING. read in full before editing
├── AGENTS.md, AGENT-PLAYBOOK.md                        ← read at task start (CLAUDE.md says so)
├── PUBLISHING.md                                       ← the push/merge/publish/verify procedure
├── CHECKPOINT-six-live-table-fixes.md                  ← THIS TASK'S SINGLE RECORD (modified; in PR #10185)
├── docs/
│   ├── LAWS.md                                         ← Dan's rulings + resolved conflicts
│   ├── laws.d/                                         ← one file per *.law.test.*; registry enforced both ways
│   │   ├── a-loser-is-never-told-they-won.md            ← NEW this task
│   │   ├── nothing-floats-over-the-open-bet-slider.md   ← NEW this task
│   │   ├── the-felt-controls-are-the-size-dan-set.md    ← NEW this task
│   │   └── the-hero-avatar-is-never-the-smallest.md     ← NEW this task
│   ├── changelog/
│   │   ├── 2026-11-09-six-live-table-fixes.md           ← NEW: items 1,2,3,5,6 + live-verification record
│   │   └── 2026-11-09-the-hero-avatar-is-never-the-smallest.md  ← NEW: item 4
│   ├── ENGINE-RELEASE-RUNBOOK.md                       ← NOT USED. engine only
│   ├── HANDOFF_CURRENT_STATE.md                        ← A DIFFERENT PROGRAMME (engine restart). DO NOT CONFUSE
│   └── BAND-AIDS-REGISTER.md
├── scripts/
│   ├── agent-push.sh                                   ← the ONLY sanctioned push route
│   ├── guard-shared-clone.sh
│   ├── check-checkout-freshness.sh, check-unpushed-work.sh
│   ├── new-migration.mjs, reserve-migration-version.sh ← NOT USED (no migrations here)
│   └── dev/
│       └── measure-seat-avatar-art.mjs                 ← NEW this task. read-only measurement harness
├── src/
│   ├── pages/
│   │   ├── TablePage.tsx                               ← MODIFIED (items 1, 5, 6). ~32k lines
│   │   └── TablePage.css                               ← MODIFIED (pointer-events on the new stack)
│   ├── components/
│   │   ├── lightning/LightningLeaveControl.tsx         ← MODIFIED (item 1, label)
│   │   └── table/
│   │       ├── ActionPanel.tsx                         ← MODIFIED (item 5, onRaiseModeChange)
│   │       ├── ActionPanel.css                         ← MODIFIED (item 2, button heights)
│   │       ├── TableToolIconSizing.css                 ← MODIFIED (item 3, THE actual fix)
│   │       ├── TableTabBar.css                         ← NOT modified; declares --sp-tabbar-control (52px / 44px)
│   │       ├── SeatSlot.css                            ← NOT modified. 5000+ lines. the avatar geometry lattice
│   │       ├── SeatSlot.tsx                            ← NOT modified. decides isBustArt from the avatar URL
│   │       ├── opponentAvatarLayout.ts                 ← MODIFIED (item 4, THE fix)
│   │       └── bustArtGain.ts                          ← NOT modified. GENERATED per-character correction table
│   ├── hooks/useProtectedCardLayout.ts                 ← NOT modified. reads --sp-opponent-x/-y
│   ├── styles/design-tokens.css                        ← MODIFIED twice: once in 490c72a31 (comment only, WRONG),
│   │                                                      once in PR #10185 (comment corrected). VALUE never changed
│   └── utils/popupStyle.ts                             ← NOT modified. the toast Title Case + em-dash ban
└── tests/
    ├── a-loser-is-never-told-they-won.law.test.tsx     ← NEW (item 6)
    ├── nothing-floats-over-the-open-bet-slider.law.test.ts ← NEW (items 1 + 5)
    ├── the-felt-controls-are-the-size-dan-set.law.test.ts  ← NEW (items 2 + 3)
    ├── the-hero-avatar-is-never-the-smallest.law.test.ts   ← NEW (item 4)
    ├── a-refund-never-reads-horse-identity.law.test.ts ← ANOTHER LANE'S. DO NOT EDIT. see §16.1
    ├── law-registry.law.test.ts                        ← enforces docs/laws.d both ways
    ├── lightning/lightning-leave-control.test.tsx      ← MODIFIED (new button name)
    ├── unit/tournamentChampionCloseout.law.test.ts     ← MODIFIED (item 6)
    ├── unit/tournamentAllFormatsCloseout.law.test.ts   ← MODIFIED (item 6)
    ├── unit/opponentAvatarLayout.test.ts               ← NOT modified; passes with the cap
    ├── unit/topRailCapCascade.test.ts                  ← NOT modified; passes
    └── e2e/
        ├── table-proportions.spec.ts                   ← MODIFIED (2 beats). 99 tests, ~10.2 min
        ├── top-rail-seat.spec.ts                       ← NOT modified; 17 tests pass
        ├── css/the-chairs-never-change-order.spec.ts   ← NOT modified; passes
        └── support/
            ├── portraitRailScene.tsx                   ← MODIFIED (item 4, new data-hero-avatar knob)
            ├── portraitRailFixture.tsx                 ← NOT modified (9-line mount)
            ├── feltHarness.mjs                         ← MODIFIED (formatting only)
            ├── geometry-baseline.json                  ← MODIFIED (btnH 52→96, feltH −44 on four phones)
            └── fixtures/table-art/                     ← bundled approved artwork used by the measurements
```

---

## 5. APPLICABLE INSTRUCTIONS AND CONSTRAINTS

| File                                                                     | Scope                                                                                      | Must reread before                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `CLAUDE.md` (repo root)                                                  | everything. Owner directions, delivery, laws 10.5–10.87, DDL policy, 11.5 money-probe rule | any edit at all                             |
| `AGENTS.md`, `AGENT-PLAYBOOK.md`, `docs/agent-policy/REFERENCE-INDEX.md` | current operating policy                                                                   | task start and every resumption             |
| `PUBLISHING.md`                                                          | push, protected merge, publication, live verification                                      | any delivery step                           |
| `docs/LAWS.md` + `docs/laws.d/*`                                         | Dan's rulings and the law registry                                                         | adding or changing any `*.law.test.*`       |
| `.claude/skills/club-arena-console/SKILL.md`                             | the #ClubArenaConsole painted-chassis standard                                             | redesigning any page, popup, card or button |

### 5.1 Conflicts and ambiguities found, and how they were resolved

1. **"Hero 33% bigger" (2026-08-15) vs "hero should always be the same size" (2026-11-09).**
   Looks like two opposite rulings. **It is not.** Measurement (§6.4) showed the
   hero's declared circle is already the largest at every breakpoint and the
   reported appearance came from the opponent normaliser, not from the ratio. The
   ratio was left at 1.3333 and the normaliser was capped. **The 2026-08-15 ruling
   stands.** Do not "resolve" this by setting the ratio to 1 — and do not write a
   third rule (`CLAUDE.md` 10.8 forbids it).
2. **A stale comment asserting the opposite of its own value.** `design-tokens.css`
   shipped a comment saying the ratio was superseded. Corrected in PR #10185. §7.7.
3. **A GitHub-harness reminder demanded `noreply@anthropic.com` as the commit
   author**, which the repo's own guard refuses. The repo guard won. §3.1 item 6.

---

## 6. COMPLETE DISCOVERY RECORD

### 6.1 How a Club Arena change reaches players (CONFIRMED)

Owned branch → pull request → required checks → **protected squash merge** →
`publish-club-arena.yml` builds on GitHub compute and rsyncs `dist/` to the
Hetzner origin `/srv/club-arena` as `releases/<sha>/` plus an **atomically
swapped** `current` symlink plus an **append-only** `pool/` → the World Hub's
single rewrite `/hub/club-arena/:path*` → `https://ca-static.smarter.poker/:path*`
serves it. The browser never sees the origin host, so the shared
`smarter-poker-auth` localStorage session is untouched.

- There is exactly **one** publisher. `tests/no-commit-left-behind.law.test.ts` counts them.
- `/assets/*` and `/fonts/*` are **append-only**. Never prune the pool — a player holding the previous `index.html` still requests the previous hashed chunks mid-hand.
- Nothing may be re-created under the World Hub's `public/hub/club-arena/` — Next.js serves `public/` **before** the rewrite and would silently shadow the live bundle.
- Verification is `build-info.json` on **both** `https://ca-static.smarter.poker/` and `https://smarter.poker/hub/club-arena/`.
- **With concurrent merges, verify the live revision CONTAINS your change** rather than forcing an older revision back. This mattered — see §10.3.

### 6.2 The seat-avatar geometry lattice (the deep discovery; all CONFIRMED by reading the code and measuring)

```
--table-w  (the scaler's measured width)
  └── --seat-avatar-full : clamp(50px, calc(var(--table-w) * 0.158), 124px)      [SeatSlot.css:35]
        └── --seat-avatar-base : var(--seat-avatar-full)                          [SeatSlot.css:51]
              │     ...overridden per breakpoint and per ring; the ONLY thing the
              │     responsive blocks are allowed to touch
              ├── .seat        --seat-avatar-size : var(--seat-avatar-base)       [SeatSlot.css:52]
              └── .seat.seat--hero
                        --seat-avatar-size : calc(base * var(--seat-avatar-hero-ratio, 1.3333))
                        width             : max(--sp-seat-plate-min, size * 8/7) !important
                                                                                  [SeatSlot.css:1233]
--seat-avatar-size then drives, directly or indirectly:
  .seat__avatar-wrap  w/h                     [SeatSlot.css:313]
  .seat__avatar       w/h  (overflow:hidden, border-radius 50%, 2.5px border,
                            a dark gradient background — SO THE CIRCLE IS VISIBLE)  [SeatSlot.css:335]
  .seat__avatar .sp-cosmetic font-size         [SeatSlot.css:376]
  --sp-wrap-overlap = max(3px, size * 0.0714)  [SeatSlot.css:50]  (the name-box tuck)
  --vh-card-h -> --vh-card-w  = EVERY VILLAIN HOLE CARD
  the bust anchoring and the initials glyph
```

**Two different portrait modes, and this is the crux of item 4:**

- `SeatSlot.tsx:2612` — `const isBustArt = /\/avatars\/(table|free|vip)\//.test(avatarUrl)`.
  Character art from the platform's own sets gets `.seat__avatar--bust`:
  `object-fit: contain`, `object-position: 50% 100%` (feet on the slot's bottom
  edge), `transform: translateY(--sp-bust-clip) scale(--sp-bust-effective-scale)`
  where `--sp-bust-effective-scale = --sp-bust-scale (1.45, or 1.05 on some top
rails) × --sp-bust-gain` (the **generated** per-character correction in
  `bustArtGain.ts`).
- Anything else — **a player's uploaded photograph** — keeps `.seat__avatar-img`'s
  default `object-fit: cover`, `border-radius: 50%`, and fills the circle edge to
  edge.

**`opponentAvatarLayout.ts` is what actually sizes an opponent pod on screen.**
It decodes every portrait into a canvas, finds its alpha bounding box, computes
each portrait's painted subject height through object-fit/object-position and the
bust transform (`subject()`, line 1019), takes the **hero's** subject as the
target (`anchorImage()` = the image inside `.seat--hero`, falling back to
`.seat-wrapper--hero`), and writes `--sp-opponent-art-scale` per opponent so each
opponent's painted subject matches the hero's. **That custom property is consumed
by `.seat__avatar`** (`SeatSlot.css:392`, `scale: var(--sp-opponent-art-scale, 1)`
with `transform-origin: 50% 100%`), with a counter-scale on an inner element for
tap targets (`SeatSlot.css:417`).

**Consequence, measured, 9-max at 375px:** the declared opponent slot is
**37.66px** and the declared hero slot is **66.67px** — the normaliser is
load-bearing for the opponent pod size, multiplying the opponent circle by ~1.77
to ~1.99. So the factor is not cosmetic: it decides how big an opponent's
**visible circle** is, which the rule's own comment claims it does not ("These
paint-only properties do not feed avatar/card/panel dimensions or the table
geometry").

**If nobody is seated in the hero chair**, `anchorImage()` returns nothing and the
reference becomes "the largest decoded subject at the table"
(`opponentAvatarLayout.ts` ~line 1325). CONFIRMED live: a 6-handed table with no
hero showed six circles at 84.92 / 84.65 px and factors 1 / 0.9968. **This is a
silent fallback nobody designed:** on a spectator view the reference seat is
whichever artwork happens to be biggest. Recorded as a latent inconsistency in
§16.4. It is now bounded by the cap but is still arbitrary.

**`prepare()` bails (returns false, leaving every opponent unscaled) if** any
portrait has not yet produced alpha metadata, or the hero's own alpha is
unavailable (`if (!heroAlpha) return false; // Preserve existing visible artwork`).
A cross-origin photograph that taints the canvas would land here. UNVERIFIED
whether any production photograph actually taints it — **worth an inspection**.

### 6.3 Item-by-item root cause (all CONFIRMED by reading the code)

**Item 1 — the Lightning leave control.** It was rendered into `TableHUD`'s
`centerTop` slot, which sits over the top villain. Two traps: (a) the upper-left
HUD column is nulled when `embeddedTableId` is set, and **every Lightning table is
embedded**, so simply moving the control into that column would have deleted it;
(b) the control is ~180px wide, so a full-width wrapper over the felt becomes an
invisible slab that eats taps on the seats.

**Item 2 — phone action buttons.** Root `--sp-action-btn-h` is
`clamp(46px, min(calc(36.5px + 2.545vw), calc(20px + 6vh)), 72px)`. "Double" is
not uniformly achievable: the bar's height and the hero's own card band are
coupled through `--sp-bottom-row-h → --sp-action-reserve → --sp-hud-line / --sp-table-bottom`.
96px holds at ≤480px, but two phones could not take it (found by bisection, §15.3).

**Item 3 — the felt tool buttons.** A change on 2026-11-01 moved the tiles onto
`--sp-tabbar-control` (52px, 44px on short 320px phones) but left the **painted
frame** normalisation on the old 40px Lobby footprint (`--sp-game-tool-size`).
Measured off Dan's screenshot: hamburger 39px, each tool 30–31px — a ratio of
0.77–0.79. **A half-landed change**, the pattern `CLAUDE.md` 10.83 is about.

**Item 5 — the time bank bleeding through the bet slider.** The `.ca-raising`
class was correctly hiding the chat bubble and previous-hand card, but the
time-bank tile carries `position: relative` **and** `backdrop-filter`, making it
its own stacking context on a compositor that need not honour an inherited
`visibility`. A CSS rule was the wrong tool; the answer is structural.

**Item 6 — the heads-up loser told they won.** `announceSpectatorChampion` in
`TablePage.tsx` is **both** the spectator path **and** the committed-participant
path. Both called `setTournamentWinner` with the champion's name, the champion's
prize and **no `position`**; `TournamentWinnerOverlay`'s `position` prop defaults
to `1`, so the overlay printed "Champion! / 1st Place / <winner> / Prize: <winner's prize>"
to the player who had just lost, then navigated them to the lobby with their own
correct result behind it. Heads-up makes it unmissable because the loser is the
only other person it can be shown to; at a 200-runner final it showed the same
thing to **everyone** who busted in the money.

**Item 4 — the hero avatar.** See §6.4.

### 6.4 Item 4, measured (THE central evidence of this task)

Tool: `scripts/dev/measure-seat-avatar-art.mjs` (new, read-only). It mounts the
repo's own isolated rail fixture with the repo's real stylesheets and bundled
artwork, and reports per seat the rendered `.seat__avatar` circle and the painted
subject inside it (decoded alpha box mapped through object-fit/object-position and
the bust transform, then clipped to the circle because `.seat__avatar` is
`overflow: hidden`). Env knobs: `WIDTHS=`, `RINGS=`, `HERO_KINDS=`, `--json`.

**9-max at 375px, before the fix:**

|                                  | declared circle                     | applied factor | rendered circle |
| -------------------------------- | ----------------------------------- | -------------- | --------------- |
| hero                             | 66.67px (= clamp floor 50 × 1.3333) | —              | 66.66px         |
| opponent, **character-art** hero | 37.66px                             | 1.7709         | 66.68px         |
| opponent, **photograph** hero    | 37.66px                             | 1.9871         | **74.80px**     |

**Why no guard ever caught it:** every e2e scene in the repository gives the hero
character art, whose painted subject carries transparent margins, so the factor
lands the opponent circle on the hero's to within **0.02px**. A real human player
has a **photograph** — opaque edge to edge, so its painted subject **is** its whole
circle — the target grows ~12%, and every opponent circle overshoots the hero's on
every phone width. **The combination "photograph hero + character-art opponents"
had never been rendered in a test.**

At desktop 9-max the same mechanism was worse in the other direction: the two
capped top seats rendered **106.1px** against the hero's **76.8px** (+38%).

**After the cap** (320 / 375 / 393 / 430 / 480 / 600 / 768 / 1024 px × 2/6/9 rings):

- character-art hero: hero and every opponent render the **identical** circle at every width and ring, desktop 9-max included;
- photograph hero: every opponent circle **equals** the hero's at every phone width, and stays **smaller** at 1024 short rings as it already did;
- the character-art factor moves by **0.0006** (66.68 → 66.66px), so nothing anyone has reviewed changes.

**Clearance** (`verify-hero-overlap.mjs`, §12; photograph hero, 375×667 / 393×852 / 1024×900 / 1440×900 × 2/6/9 rings, ActionPanel mounted via `data-action="active"`):

| what                                              | overlap                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| any avatar vs **another** seat's hole cards       | **0 px²** at all 12 layouts                                                                                |
| any avatar vs **another** seat's name label       | **0 px²** at all 12 layouts                                                                                |
| any avatar vs the action controls                 | **0 px²** at all 12 layouts                                                                                |
| any avatar vs **its own** seat's label / card row | 232.7–319.8 px² (cards), 316.6–429.4 px² (label) — **Dan's connected-name-box design, not an obstruction** |

Hero ≥ every opponent at every one of the 12 layouts. On phones exactly equal; on
desktop the hero is larger, per the 2026-08-15 ruling.

---

## 7. WORK COMPLETED DURING THIS CHAT

### 7.1 Item 1 — Lightning leave control (CONFIRMED complete, live)

- `src/pages/TablePage.tsx`: the `centerTop={...}` prop was **removed entirely**. The control now renders in `upperLeft` inside a new `<div className="hud-ul-column hud-ul-column--stack">`, **outside** the `embeddedTableId ? null : (...)` guard so it survives on embedded tables, keyed `` `${lightningRoom.poolSessionId}/${userId}` ``, and gated on `lightningRoom && !lightningRoomClosed && userId && userId !== 'guest'`.
- `src/pages/TablePage.css`: added, immediately after the `.hud-ul-column--stack` rule —
  `.table-hud__corner > .hud-ul-column--stack { pointer-events: none; }` and
  `.table-hud__corner > .hud-ul-column--stack > * { pointer-events: auto; }`
  so the 180px control cannot become an invisible slab over the seats.
- `src/components/lightning/LightningLeaveControl.tsx`:
  `const label = busy ? 'Leaving...' : 'Leave Next Hand';`
- `tests/lightning/lightning-leave-control.test.tsx`: `name: 'Leave Next Hand'` (updated **in the same commit** as the behaviour it pins — §5 rule 8).
- Pinned by `tests/nothing-floats-over-the-open-bet-slider.law.test.ts` (it pins the placement, the not-gated-on-embedded fact, and the pointer transparency).

### 7.2 Item 2 — phone action buttons (CONFIRMED complete, live)

`src/components/table/ActionPanel.css`, final shipped state (CONFIRMED by reading the file and the published stylesheet):

| value                                                              | condition                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `clamp(46px, min(calc(36.5px + 2.545vw), calc(20px + 6vh)), 72px)` | `:root`, unchanged                                                                                |
| **`96px`**                                                         | `@media (max-width: 480px)` — the "double"                                                        |
| **`52px`**                                                         | `@media (max-width: 375px) and (max-height: 700px) and (orientation: portrait)` — **EXCEPTION 1** |
| **`48px`**                                                         | `@media (max-width: 340px) and (orientation: portrait)` — **EXCEPTION 2**                         |

Also at ≤480px: `--sp-bar-inset: max(12px, env(...))`, `--sp-action-pad-top: 6px`,
`.action-btn__label { font-size: 1.25rem }`, `.action-btn__amount { font-size: 1rem }`.

**The two exceptions are Dan-acknowledged and must stay recorded.** The declaration
**order** of the three also matters (a later one wins at equal specificity), which
is why `the-felt-controls-are-the-size-dan-set.law.test.ts` pins the count as well
as the values.

`tests/e2e/support/geometry-baseline.json`: `btnH` 52 → **96** and `feltH` −44 on
four phone profiles. Regenerate with `node scripts/dev/update-geometry-baseline.mjs`
if these legitimately change again.

`tests/e2e/table-proportions.spec.ts` — the embedded action-row beat now reads the
**declared** height instead of a literal:

```ts
const declaredButtonHeight = await page.evaluate(() =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-action-btn-h'))
);
expect(declaredButtonHeight, 'the phone action button height').toBeCloseTo(
  width <= 375 && height <= 700 ? 52 : 96,
  0
);
for (const buttonHeight of measured.buttonHeights)
  expect(buttonHeight, `${state}: readable button`).toBeCloseTo(declaredButtonHeight, 0);
```

### 7.3 Item 3 — felt tool buttons (CONFIRMED complete, live)

`src/components/table/TableToolIconSizing.css` — the whole fix:

```css
.table-page
  :is(.chat-collapsed__icon-img, .tbc-icon-img, .rabbit-hunt__icon-img, .prev-hand-card__icon-img) {
  --sp-table-tool-frame: var(--sp-tabbar-control, 52px);
  width: calc(var(--sp-table-tool-frame) * var(--sp-tool-art-scale, 1));
  height: calc(var(--sp-table-tool-frame) * var(--sp-tool-art-scale, 1));
  max-width: none;
  flex-shrink: 0;
  translate: calc(var(--sp-table-tool-frame) * var(--sp-tool-art-x, 0))
    calc(var(--sp-table-tool-frame) * var(--sp-tool-art-y, 0));
}
```

**Do not be confused by the measured image box.** Each asset carries its own
`--sp-tool-art-scale` (chat `1.28643216`, previous hand `1.26732673`, …), so the
`<img>` element measures ~1.25–1.29× the frame. That extra is **transparent
gutter**; the painted glyph lands on the 52px frame and the tiles still sit 8px
apart. Measuring `getBoundingClientRect()` on the `<img>` and comparing it to the
hamburger's 52×52 will look wrong and is not. Measure the frame, or the painted
alpha bounds.

`--sp-game-tool-size` keeps its own separate consumers (the add-chips button, the
seat-change dock) and is **no longer** what these tools read.

### 7.4 Item 5 — raise slider / time bank (CONFIRMED complete, live)

Structural, not CSS, because a `backdrop-filter` stacking context need not honour
an inherited `visibility`.

- `src/components/table/ActionPanel.tsx`: new optional prop `onRaiseModeChange?: (open: boolean) => void`, reported from the existing `.ca-raising` effect and **cleared on unmount**:

```ts
useEffect(() => {
  const host = panelRootRef.current?.closest('.table-page') ?? document.body;
  host.classList.toggle('ca-raising', isRaiseMode);
  onRaiseModeChange?.(isRaiseMode);
  return () => {
    host.classList.remove('ca-raising');
    onRaiseModeChange?.(false);
  };
}, [isRaiseMode, onRaiseModeChange]);
```

- `src/pages/TablePage.tsx`: `const [raisePanelOpen, setRaisePanelOpen] = useState(false);` near `showTableMenu`; `bottomLeft={ raisePanelOpen ? null : (<div className="hud-ul-column hud-bl-row"> ... </div>) }`; `<ActionPanel onRaiseModeChange={setRaisePanelOpen} ... />`.
- The `.ca-raising` CSS block **stays** beside it (belt and braces), pinned by the law.

### 7.5 Item 6 — heads-up loser (CONFIRMED complete, live)

`announceSpectatorChampion` in `src/pages/TablePage.tsx`, final shipped logic:

```ts
const myFinish = participant ? Number(participant.position) : null;
const myPrize = participant ? Number(participant.prize) || 0 : 0;
const iWon = myFinish === 1;
const iCashed = myFinish != null && myFinish > 1 && myPrize > 0;
const celebrates = !participant || !!qualifiers || iWon || iCashed;

let announcedPrize = prize;
if (qualifiers) announcedPrize = 0;
else if (participant) announcedPrize = myPrize;

if (celebrates) {
  setTournamentWinner({
    prize: announcedPrize,
    name: formatGameTitle(durableTournamentName) || 'Tournament',
    championName: qualifiers || iCashed ? undefined : champion?.username || 'Champion',
    ...(iCashed && !qualifiers && myFinish != null ? { position: myFinish } : {}),
    ...(qualifiers ? { qualifiers } : {}),
  });
}
if (participant) {
  goToLobbyWithResult(
    participant.position,
    participant.prize,
    celebrates ? TOURNAMENT_CHAMPION_DISPLAY_MS : 2500
  );
  return;
}
```

Resulting behaviour: spectator / qualifier list unchanged; **this player won** → champion card with their own prize; **this player cashed** → the overlay's existing paid-finish face with their own place and prize, never the champion's name; **this player lost unpaid** → **no celebration at all**, and they leave on the 2.5 s bust beat instead of a ~20 s trophy dwell. The `qualifiers` branch is untouched (it is only ever set when there is no champion row and the viewer is a qualifier).

Tests rewritten **in the same commit**: `tests/unit/tournamentChampionCloseout.law.test.ts` (three cases — cashing participant gets own finish/prize `{prize: 40.25, championName: undefined, position: 2}`; unpaid loser gets no announce and a 2.5 s exit; a participant who won still gets the champion card) and `tests/unit/tournamentAllFormatsCloseout.law.test.ts` (runner-up branch now expects `{championName: undefined, prize: 20, position: 2}`).

### 7.6 Item 4 — the hero avatar (CONFIRMED complete, live)

`src/components/table/opponentAvatarLayout.ts`, inside `prepare()`, the entire change:

```ts
const slotHeight = (avatar: HTMLElement) => {
  const declared = getComputedStyle(avatar).height;
  return declared.endsWith('px') && Number.isFinite(parseFloat(declared))
    ? parseFloat(declared)
    : avatar.offsetHeight;
};
const heroSlot = slotHeight(hero.closest<HTMLElement>('.seat__avatar')!);
// ... per opponent:
const ownSlot = slotHeight(avatar);
const ceiling = heroSlot > 0 && ownSlot > 0 ? heroSlot / ownSlot : Infinity;
const factor = Math.min(target / subject(image, own, false).height, ceiling);
```

plus a ~30-line comment carrying the measurement. **Why computed `height`:** `scale:`
does not participate in layout, so these reads are feedback-free. **Semantics:** an
opponent's rendered circle may equal the hero's and may be smaller; never larger.

`tests/e2e/support/portraitRailScene.tsx` — one **opt-in, default-off** knob so a
measurement can mount a photograph hero beside character-art opponents:

```tsx
avatar:
  i === 0 && document.documentElement.dataset.heroAvatar
    ? document.documentElement.dataset.heroAvatar
    : `https://smarter.poker/avatars/table/${...existing expression...}`,
```

Every pre-existing scene is unaffected (no scene sets `data-hero-avatar`).

`scripts/dev/measure-seat-avatar-art.mjs` — new, read-only, 247 lines.

### 7.7 The comment correction found while writing this handoff (CONFIRMED committed and pushed; **NOT yet on `main`**)

`src/styles/design-tokens.css` shipped, in `490c72a31`, a comment above
`--seat-avatar-hero-ratio` claiming Dan's 2026-11-09 report **superseded** his
2026-08-15 "33% bigger" ruling and that "At 1 the frame and the bust agree again,
for every seat" — sitting **directly above a value of `1.3333`**. It is debris from
the first, reverted attempt at item 4: the revert restored the value and missed
the prose. **The value was always 1.3333** — verified at `origin/main`, at
`490c72a31`, and at `490c72a31^`.

This is the exact mechanism of the hamburger revert war (`CLAUDE.md` 10.7): a
written claim in the repo contradicting the code, re-enforced by every agent who
reads the repo. The next agent would have set the token to 1 and re-broken the
four measured constants.

Replaced with a comment that states: the 2026-08-15 ruling is **in force**, do not
set this to 1, **do not trust an earlier version of this comment**, what actually
caused the 2026-11-09 report, and what setting it to 1 breaks. **Comment only — no
selector, value or declaration changed.** Commit `b753cdeeb`, in PR #10185.

### 7.8 Documentation and records created

- `docs/changelog/2026-11-09-six-live-table-fixes.md` — items 1,2,3,5,6, their root causes, plus a "Verified live" section (merge, publisher run, both endpoints, what was read off every published chunk and off the running page).
- `docs/changelog/2026-11-09-the-hero-avatar-is-never-the-smallest.md` — item 4, the before/after tables, the fix, the pins.
- `CHECKPOINT-six-live-table-fixes.md` — **the single record for this task**: Dan's six items verbatim, acceptance criteria, per-item state, what remains, adopted work handed back, what was deliberately left untouched, owned resources released, and (in PR #10185) the final live evidence and the two acceptance gaps.
- Four `docs/laws.d/*.md` registry entries (`tests/law-registry.law.test.ts` enforces the mapping both ways).

### 7.9 Adopted work handed back (CONFIRMED; **acknowledgment NOT obtained**)

`tests/a-refund-never-reads-horse-identity.law.test.ts` belongs to the lane that
added it in PR **#10141** (`f05296451`, 2026-11-08). It timed out once on an
earlier head of PR #10172. This task **measured it and handed it back**; it changed
nothing of that lane's. Issue **#10176** filed with the measurement, the 10.86
reading and a suggested shape for the fix; cross-lane notice posted on **#10141**.
**Issue #10176: state open, 0 comments.** Per Dan, it is **not** a completion gate.

---

## 8. VISUAL AND PRODUCT DECISIONS

**Reference images:** Dan's three screenshots, pasted into the chat only. **Not in
the repository, not recoverable from here.** What was measured off them is in §6.3
and §6.4. If pixel-exact re-verification is needed, ask Dan to re-send.

| Surface                 | Locked decision                                                                                                                                                          | Implemented                 | Where                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------- |
| Lightning leave control | upper-left HUD stack, label exactly **"Leave Next Hand"** ("Leaving..." while busy), never in `centerTop`, never gated on `embeddedTableId`, wrapper pointer-transparent | YES, live                   | `TablePage.tsx`, `TablePage.css`, `LightningLeaveControl.tsx` |
| Phone action buttons    | **96px** at ≤480px; **52px** at 375×667 portrait; **48px** at ≤340px portrait; order of the three declarations is load-bearing                                           | YES, live                   | `ActionPanel.css`                                             |
| Felt tool buttons       | painted frame = `--sp-tabbar-control` (**52px**, **44px** at 320px), identical to the hamburger                                                                          | YES, live                   | `TableToolIconSizing.css`                                     |
| Hero avatar             | hero circle is **never smaller** than an opponent's. `--seat-avatar-hero-ratio` stays **1.3333**                                                                         | YES, live                   | `opponentAvatarLayout.ts`                                     |
| Bet-slider overlay      | the bottom-left HUD row **unmounts** while the slider is open                                                                                                            | YES, live                   | `TablePage.tsx`, `ActionPanel.tsx`                            |
| Heads-up result         | the viewer's own finish and own prize; **no celebration for an unpaid loser**                                                                                            | YES, live                   | `TablePage.tsx`                                               |
| Avatar / name-box tuck  | an avatar deliberately overlaps **its own** seat's plate and card row (Dan 2026-08-20). **Not a defect**                                                                 | pre-existing, preserved     | `SeatSlot.css` `--sp-wrap-overlap`                            |
| Header portrait frame   | 1px black hairline; the artwork's chrome ring stays masked by an opaque disc (10.7b)                                                                                     | pre-existing, **untouched** | `GlobalHeader.module.css`                                     |

**REJECTED / OBSOLETE — do not resurrect:**

- `--seat-avatar-hero-ratio: 1`. Measured, implemented, **reverted**, never shipped. §15.1.
- The comment asserting that ratio change. Corrected in #10185. §7.7.
- Any CSS-only attempt at item 5 (`visibility`/`opacity` on the time-bank tile). §15.2.
- Lifting `.seat__cards--hero` with `top: calc(var(--seat-avatar-size) * -0.1667)` / `-0.3333`. These were steps inside the reverted hero-resize attempt and are meaningless without it. §15.1.

---

## 9. FUNCTIONAL AND ARCHITECTURAL DECISIONS

| Area                                                                                                                                                                          | State after this task                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Opponent painted-subject normalisation                                                                                                                                        | **IMPLEMENTED** and now capped at the hero's declared circle                    |
| Hero slot ratio (1.3333)                                                                                                                                                      | **UNCHANGED, IN FORCE**                                                         |
| Hero-chair-empty reference fallback ("largest decoded subject")                                                                                                               | **PRE-EXISTING, UNDESIGNED.** Bounded by the cap; still arbitrary. §16.4        |
| Lightning leave authority                                                                                                                                                     | **IMPLEMENTED.** Placement and label only; the leave mechanism itself untouched |
| Raise-mode reporting (`onRaiseModeChange`)                                                                                                                                    | **IMPLEMENTED**                                                                 |
| Tournament closeout announcement                                                                                                                                              | **IMPLEMENTED** for won / cashed / unpaid-loser / spectator / qualifier         |
| Horses treated as players (10.5)                                                                                                                                              | **PRESERVED.** No `is_horse` branch added anywhere by this task                 |
| Animations always play (10.6)                                                                                                                                                 | **PRESERVED.** No animation gated, skipped or muted                             |
| Engine, maintenance window, migrations, money paths, monitoring, workflows                                                                                                    | **NOT TOUCHED.** Client-only delivery                                           |
| Wallets, rake, BBJ, VPIP, straddles, Bomb Pot, Run It Twice, Insurance, Spins, rakeback, agent hierarchy, permissions, club/union scoping, hand histories, replays, reporting | **NOT TOUCHED, NOT SPECIFIED by this task**                                     |

---

## 10. EXACT CURRENT STATE (all CONFIRMED at ~15:40 UTC 2026-11-09)

### 10.1 Git

```
cwd / worktree root : /home/claude/ca-work
git dir             : /home/claude/smarter-poker-club-arena/.git/worktrees/ca-work
branch              : docs/six-fix-checkpoint-final-2026-11-09
HEAD                : b753cdeebfdcf8905bd6c7e879953352f58efdd7
git status           : CLEAN (nothing staged, unstaged or untracked)
origin/main...HEAD   : 0 behind, 2 ahead  (the two commits of PR #10185)
worktrees            : /home/claude/smarter-poker-club-arena  f05296451 [main]
                       /home/claude/ca-work                   b753cdeeb [docs/six-fix-checkpoint-final-2026-11-09]
stash stack          : EMPTY
```

Branch commits (PR #10185): `1f4674313` (checkpoint record) and `b753cdeeb` (the comment correction, §7.7).

### 10.2 Pull requests

| PR     | Head branch                                  | State                                                                   | Merge commit                               |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| #10151 | `fix/table-chrome-and-loser-card-2026-11-09` | **merged**                                                              | `490c72a315a000f66575edb6cd53b96e5635da41` |
| #10172 | `fix/hero-avatar-never-smallest-2026-11-09`  | **merged**                                                              | `6a91dbe1cde711d021452e799bb0e4968fabb465` |
| #10185 | `docs/six-fix-checkpoint-final-2026-11-09`   | **OPEN**, mergeable=true, state=blocked (checks running on `b753cdeeb`) | —                                          |

### 10.3 Deployment — READ THIS CAREFULLY

- Publisher run `42630046134` — **success**, head `490c72a31` (the five fixes).
- Publisher run `42642327309` — **success**, head `6a91dbe1c` (the hero fix).
- Both endpoints at the time of writing report `ca_sha` **`e366fab1398cd9d10f0b11228d41329c7a54b1ea`**, built `2026-11-09T15:21:57Z` by run `42643234411`. **That is another lane's later merge, and it is correct.** Verified by ancestry: `490c72a31` **and** `6a91dbe1c` are both ancestors of `e366fab13`. Per `CLAUDE.md` 1.1, confirm the live revision **contains** your change — never force an older revision back to "prove" delivery.
- **All six fixes confirmed present in the CURRENT live bundle** (`index-Bhkw4kcJ-v6.js` → `TablePage-B_clHWWo-v6.js`, `TablePage-B0Di7btR-v6.css`, `ActionPanel-CkGUqL_y-v6.css`): `Leave Next Hand` ×1, `hud-ul-column--stack` ×1, `onRaiseModeChange` ×1, `Math.min(v/dy(e,n,!1).height,i)` (the cap), `--sp-table-tool-frame: var(--sp-tabbar-control, 52px)`, and `--sp-action-btn-h` at 96px / 52px / 48px.
- The `TablePage-*.css` chunk is **byte-identical** (same md5 `1d23946a…`) across the pre- and post-hero releases, which proves the hero fix is JavaScript only and no approved geometry moved.

### 10.4 Processes

No dev server, no preview, no build running. Three background monitors were used
and are finished or stopped; one is still watching PR #10185's checks
(`bjjoc1i2y`). **UNKNOWN to the next agent in a new chat — these do not survive.**

### 10.5 Database / migrations

**No database work. No migration added, applied or rolled back. No SQL touched.** CONFIRMED.

---

## 11. CHANGED-FILE LEDGER

`490c72a31` — items 1, 2, 3, 5, 6 (20 files, +1135 / −317):

| File                                                        | Status   | Purpose                                                        | What changed                                                                                                                                        | Verified             | Committed                                       |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| `src/pages/TablePage.tsx`                                   | modified | items 1, 5, 6                                                  | `centerTop` removed; leave control into the `upperLeft` stack; `raisePanelOpen` state; `bottomLeft` unmounts; `announceSpectatorChampion` rewritten | tests + live bytes   | yes, live                                       |
| `src/pages/TablePage.css`                                   | modified | item 1                                                         | pointer-events on the new stack                                                                                                                     | tests                | yes, live                                       |
| `src/components/lightning/LightningLeaveControl.tsx`        | modified | item 1                                                         | label → `Leave Next Hand`                                                                                                                           | test + live bytes    | yes, live                                       |
| `src/components/table/ActionPanel.tsx`                      | modified | item 5                                                         | `onRaiseModeChange` prop, reported and cleared on unmount                                                                                           | tests + live bytes   | yes, live                                       |
| `src/components/table/ActionPanel.css`                      | modified | item 2                                                         | 96px at ≤480px + the two exceptions + label/amount font sizes                                                                                       | CSS Beat + live CSS  | yes, live                                       |
| `src/components/table/TableToolIconSizing.css`              | modified | item 3                                                         | painted frame → `--sp-tabbar-control`                                                                                                               | CSS Beat + live page | yes, live                                       |
| `src/styles/design-tokens.css`                              | modified | **comment only — AND IT WAS WRONG**                            | §7.7; corrected in #10185                                                                                                                           | —                    | yes, live (**wrong text on main until #10185**) |
| `tests/a-loser-is-never-told-they-won.law.test.tsx`         | **new**  | item 6 law                                                     | —                                                                                                                                                   | passes               | yes                                             |
| `tests/nothing-floats-over-the-open-bet-slider.law.test.ts` | **new**  | items 1+5 law                                                  | —                                                                                                                                                   | passes               | yes                                             |
| `tests/the-felt-controls-are-the-size-dan-set.law.test.ts`  | **new**  | items 2+3 law                                                  | —                                                                                                                                                   | passes               | yes                                             |
| `tests/lightning/lightning-leave-control.test.tsx`          | modified | new button name                                                | —                                                                                                                                                   | passes               | yes                                             |
| `tests/unit/tournamentChampionCloseout.law.test.ts`         | modified | item 6, 3 cases                                                | —                                                                                                                                                   | passes               | yes                                             |
| `tests/unit/tournamentAllFormatsCloseout.law.test.ts`       | modified | item 6 runner-up                                               | —                                                                                                                                                   | passes               | yes                                             |
| `tests/e2e/table-proportions.spec.ts`                       | modified | 2 beats: tool size 52/44; action row reads the declared height | 99/99 pass                                                                                                                                          | yes                  |
| `tests/e2e/support/geometry-baseline.json`                  | modified | `btnH` 52→96, `feltH` −44 on 4 phones                          | CSS Beat                                                                                                                                            | yes                  |
| `tests/e2e/support/feltHarness.mjs`                         | modified | formatting only (prettier)                                     | —                                                                                                                                                   | yes                  |
| `docs/changelog/2026-11-09-six-live-table-fixes.md`         | **new**  | the record                                                     | —                                                                                                                                                   | yes                  |
| `docs/laws.d/a-loser-is-never-told-they-won.md`             | **new**  | registry                                                       | law-registry passes                                                                                                                                 | yes                  |
| `docs/laws.d/nothing-floats-over-the-open-bet-slider.md`    | **new**  | registry                                                       | law-registry passes                                                                                                                                 | yes                  |
| `docs/laws.d/the-felt-controls-are-the-size-dan-set.md`     | **new**  | registry                                                       | law-registry passes                                                                                                                                 | yes                  |

`6a91dbe1c` — item 4 (8 files, +708 / −2):

| File                                                                 | Status   | Purpose                        | What changed                                                                   | Verified                                   | Committed |
| -------------------------------------------------------------------- | -------- | ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------ | --------- |
| `src/components/table/opponentAvatarLayout.ts`                       | modified | **the fix**                    | `slotHeight`, `heroSlot`, `ceiling`, `Math.min(...)` + the measurement comment | law + 99 CSS Beat + live bytes + live page | yes, live |
| `tests/the-hero-avatar-is-never-the-smallest.law.test.ts`            | **new**  | item 4 law, 2 cases            | —                                                                              | passes                                     | yes       |
| `docs/laws.d/the-hero-avatar-is-never-the-smallest.md`               | **new**  | registry                       | law-registry passes                                                            | yes                                        |
| `tests/e2e/support/portraitRailScene.tsx`                            | modified | opt-in `data-hero-avatar` knob | default-off                                                                    | 99 CSS Beat pass                           | yes       |
| `scripts/dev/measure-seat-avatar-art.mjs`                            | **new**  | measurement harness            | read-only                                                                      | ran clean                                  | yes       |
| `docs/changelog/2026-11-09-the-hero-avatar-is-never-the-smallest.md` | **new**  | the record                     | —                                                                              | yes                                        |
| `docs/changelog/2026-11-09-six-live-table-fixes.md`                  | modified | + "Verified live" section      | —                                                                              | yes                                        |
| `CHECKPOINT-six-live-table-fixes.md`                                 | **new**  | the single record              | —                                                                              | yes                                        |

PR #10185 — **OPEN**:

| File                                 | Status                  | Purpose                                                    | Verified                          | Committed         | On main |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------- | --------------------------------- | ----------------- | ------- |
| `CHECKPOINT-six-live-table-fixes.md` | modified (+148/−6)      | final status, live evidence, measurements, acceptance gaps | —                                 | yes (`1f4674313`) | **NO**  |
| `src/styles/design-tokens.css`       | modified (comment only) | §7.7 correction                                            | hero law + topRailCapCascade pass | yes (`b753cdeeb`) | **NO**  |

**No user-owned or unrelated changes are present in the worktree** — status is clean. CONFIRMED.

---

## 12. ASSET LEDGER

| Asset                                                                                                                             | Path                                                                                            | Purpose                                                                                                          | Approved            | Implemented           | Tracked                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------- | ------------------------------------------------------------ |
| Dan's 3 screenshots (PLO4 Lightning ×2, heads-up result ×1)                                                                       | **chat only**                                                                                   | the authority for all six items                                                                                  | yes (Dan sent them) | read and acted on     | **NO — NOT RECOVERABLE. Ask Dan if needed.**                 |
| `vip_wolf@2x.webp`                                                                                                                | `tests/e2e/fixtures/table-art/`                                                                 | opponent character art in every measurement                                                                      | pre-existing        | used                  | yes                                                          |
| `vip_aztec_warrior@2x.webp`                                                                                                       | `tests/e2e/fixtures/table-art/`                                                                 | the wide-art case                                                                                                | pre-existing        | used                  | yes                                                          |
| `icon-chat.webp`, `icon-timebank.webp`, `icon-rabbit.webp`                                                                        | `tests/e2e/fixtures/table-art/`                                                                 | painted-frame alpha measurement for item 3                                                                       | pre-existing        | used                  | yes                                                          |
| Production tool art                                                                                                               | Supabase `assets/buttons/black/icon-*.webp`                                                     | the live tool glyphs                                                                                             | pre-existing        | unchanged             | n/a (remote)                                                 |
| Synthetic "photograph" hero                                                                                                       | generated inline as an SVG data URI inside `measure-seat-avatar-art.mjs` and the overlap script | stands in for a player's uploaded portrait: opaque edge to edge, square so `cover` neither crops nor letterboxes | n/a (test fixture)  | used                  | the measure script is tracked; **the overlap script is NOT** |
| `verify-hero-overlap.mjs`                                                                                                         | `/tmp/claude-0/.../scratchpad/`                                                                 | the 12-layout clearance measurement                                                                              | n/a                 | ran                   | **NO — EPHEMERAL. See risk below**                           |
| Screenshots taken during exploration (`hero.png`, `villain.png`, `cmp.png`, `tiles.png`, `ham.png`, `chat*.png`, `s1_*/s2_*.png`) | `/tmp/claude-0/.../scratchpad/`                                                                 | intermediate evidence                                                                                            | n/a                 | superseded by numbers | **NO — EPHEMERAL**                                           |

**RISK:** `verify-hero-overlap.mjs` produced the clearance numbers in §6.4 and
lives only in this container's scratchpad, which does **not** survive the session.
Its **results** are recorded in `CHECKPOINT-six-live-table-fixes.md` (PR #10185),
so the evidence persists — but the script itself does not. If the clearance check
should be repeatable, the next agent should promote it to
`scripts/dev/verify-hero-avatar-clearance.mjs`. It is a near-copy of
`scripts/dev/measure-seat-avatar-art.mjs` (which **is** tracked) with: `data-action="active"`
added to the fixture HTML so `ActionPanel` mounts, and a cross-seat-vs-own-seat
rectangle-intersection report over `.seat__card,.card-image__img`, `.seat__info`
and `.action-panel`. Reconstructible in ~20 minutes from the tracked script.

---

## 13. COMMANDS AND TOOLS USED

All from `/home/claude/ca-work` unless noted. Nothing below prints a secret.

| Command                                                                                                                                           | Purpose                                             | Result                                                                         | Changes files    | Rerun?                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- | --------------------------------------- |
| `git remote set-url origin https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena`                                                      | fix the lowercase remote that breaks the push guard | fixed                                                                          | no               | **yes, right after attaching the repo** |
| `git checkout -b <branch> origin/main`                                                                                                            | start each delivery from protected main             | ok                                                                             | working tree     | as needed                               |
| `npx tsc --noEmit`                                                                                                                                | type check                                          | clean, no output                                                               | no               | before any commit                       |
| `npx vitest run tests/<file> …`                                                                                                                   | unit + law tests                                    | see §14                                                                        | no               | yes                                     |
| `CI=1 npx playwright test tests/e2e/table-proportions.spec.ts --project=chromium --reporter=line`                                                 | the felt geometry suite                             | **99 passed (10.2 min)**                                                       | no               | before any avatar/bar change            |
| `CI=1 npx playwright test tests/e2e/top-rail-seat.spec.ts tests/e2e/css/the-chairs-never-change-order.spec.ts --project=chromium --reporter=line` | top rail + seat order                               | **17 passed (13.1 s)**                                                         | no               | yes                                     |
| `node scripts/dev/measure-seat-avatar-art.mjs` (`WIDTHS=`, `RINGS=`, `HERO_KINDS=`, `--json`)                                                     | the item-4 measurement                              | produced §6.4                                                                  | no               | yes, read-only                          |
| `bash scripts/agent-push.sh`                                                                                                                      | **the only** push route                             | VERIFIED each time                                                             | pushes refs      | yes                                     |
| `gh api -X POST repos/{o}/{r}/pulls --input body.json`                                                                                            | open a PR (GraphQL is refused)                      | #10172, #10185                                                                 | no               | as needed                               |
| `gh api -X PUT repos/{o}/{r}/pulls/{n}/merge -f merge_method=squash -f sha=<head>`                                                                | protected squash merge                              | both merged                                                                    | no               | as needed                               |
| `gh api repos/{o}/{r}/commits/<sha>/check-runs?per_page=100`                                                                                      | read check state                                    | used throughout                                                                | no               | yes                                     |
| `gh api -X POST repos/{o}/{r}/actions/runs/<id>/rerun-failed-jobs`                                                                                | the one allowed re-run                              | refused with `403 This workflow is already running` while other jobs were live | no               | only once, after the run completes      |
| `curl -s https://ca-static.smarter.poker/build-info.json` and `…/hub/club-arena/build-info.json`                                                  | live revision proof                                 | see §10.3                                                                      | no               | yes                                     |
| `git merge-base --is-ancestor <mine> <live>`                                                                                                      | prove the live revision contains the change         | YES for both                                                                   | no               | yes, on concurrent merges               |
| `md5sum` on two published CSS chunks                                                                                                              | prove the stylesheet did not change                 | identical                                                                      | no               | useful every release                    |
| `mcp__remote-devices__Control_Chrome__*`                                                                                                          | read the running page in Dan's signed-in Chrome     | see §14                                                                        | no               | see §15.6                               |
| `git worktree remove /home/claude/ca-base` then `git worktree prune`                                                                              | release the scratch worktree                        | removed                                                                        | deletes that dir | n/a                                     |

---

## 14. VERIFICATION AND TEST RESULTS

| Verification                                            | Command or method                                                        | Result                                                                                                                                                                                                                                                  | Phase                        | Follow-up                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| TypeScript                                              | `npx tsc --noEmit`                                                       | **PASS** (no output)                                                                                                                                                                                                                                    | both releases                | —                                          |
| New hero law                                            | `npx vitest run tests/the-hero-avatar-is-never-the-smallest.law.test.ts` | **PASS**                                                                                                                                                                                                                                                | item 4                       | —                                          |
| Opponent layout unit suite                              | `npx vitest run tests/unit/opponentAvatarLayout.test.ts`                 | **PASS**                                                                                                                                                                                                                                                | item 4                       | —                                          |
| Law registry                                            | `npx vitest run tests/law-registry.law.test.ts`                          | **PASS**                                                                                                                                                                                                                                                | both                         | —                                          |
| Chairs-never-change-order law                           | `npx vitest run tests/the-chairs-never-change-order.law.test.ts`         | **PASS**                                                                                                                                                                                                                                                | item 4                       | —                                          |
| Protected card layout revision                          | `npx vitest run tests/unit/protectedCardLayoutRevision.test.tsx`         | **PASS**                                                                                                                                                                                                                                                | item 4                       | —                                          |
| Top rail cap cascade                                    | `npx vitest run tests/unit/topRailCapCascade.test.ts`                    | **PASS**                                                                                                                                                                                                                                                | §7.7                         | —                                          |
| Combined local run (4 files)                            | vitest                                                                   | **1515 passed / 1515**                                                                                                                                                                                                                                  | item 4                       | —                                          |
| Felt geometry e2e                                       | `CI=1 npx playwright test tests/e2e/table-proportions.spec.ts`           | **99 passed, 10.2 min**                                                                                                                                                                                                                                 | item 4, on the merged branch | the suite that caught the reverted attempt |
| Top rail + chair order e2e                              | Playwright                                                               | **17 passed, 13.1 s**                                                                                                                                                                                                                                   | item 4                       | —                                          |
| Avatar sizing, 8 widths × 3 rings × 2 hero kinds        | `measure-seat-avatar-art.mjs`                                            | §6.4                                                                                                                                                                                                                                                    | item 4                       | reproducible                               |
| Avatar clearance, 12 layouts                            | `verify-hero-overlap.mjs` (ephemeral)                                    | **0 px² cross-seat cards / labels / action controls**                                                                                                                                                                                                   | item 4                       | script not tracked — §12                   |
| Required checks, PR #10151                              | GitHub                                                                   | **green**, merged                                                                                                                                                                                                                                       | —                            | —                                          |
| Required checks, PR #10172 head `d43009169`             | GitHub                                                                   | **ALL GREEN** incl. Client Unit Tests shards 1–8, CSS Beat 20 shards, TypeScript, Server Engine, Production Build, Money trigger declaration authority                                                                                                  | —                            | —                                          |
| Required checks, PR #10185 head `b753cdeeb`             | GitHub                                                                   | **RUNNING at the time of writing**                                                                                                                                                                                                                      | —                            | **next agent must confirm**                |
| Publisher run `42630046134`                             | GitHub                                                                   | **success**                                                                                                                                                                                                                                             | five fixes                   | —                                          |
| Publisher run `42642327309`                             | GitHub                                                                   | **success**                                                                                                                                                                                                                                             | hero fix                     | —                                          |
| Live `build-info.json`, both endpoints                  | curl                                                                     | both report `e366fab13`, which **contains** both releases                                                                                                                                                                                               | —                            | —                                          |
| Live bundle content, all six fixes                      | grep of the published chunks                                             | **all present**                                                                                                                                                                                                                                         | —                            | —                                          |
| Published CSS unchanged by the hero release             | md5 of `TablePage-*.css`                                                 | **identical**                                                                                                                                                                                                                                           | —                            | —                                          |
| Signed-in desktop, real 6-handed Lightning table, 775px | Dan's Chrome, read-only JS                                               | tool frame **52px** on both mounted tools = hamburger's 52×52; upper-left stack present with `pointer-events: none`; **zero** `centerTop` nodes; six opponent circles 84.92 / 84.65px (factors 1 / 0.9968); **0 px²** cross-seat card and label overlap | —                            | —                                          |

### 14.1 WHAT WAS NOT TESTED — state this plainly to Dan, do not paper over it

- **The signed-in PHONE view was never observed.** The desktop browser's layout viewport cannot be resized from this session, no phone device is linked, and a seated photograph hero cannot be produced without playing for money. Every phone number in this handoff comes from the repo's own fixture at the merged revision. What makes that defensible: the stylesheet that decides those numbers is **byte-identical** before and after the hero release.
- **Item 1 was never observed in a live Lightning pool session** (needs a paid seat). Covered by `tests/lightning/lightning-leave-control.test.tsx` + `nothing-floats-over-the-open-bet-slider.law.test.ts` + the published label and the absent `centerTop` slot read off the running page.
- **Item 5 was never observed with the slider open on the player's own turn** (needs a live turn). Covered by `nothing-floats-over-the-open-bet-slider.law.test.ts` + `onRaiseModeChange` in the published chunk.
- **Item 6 was never observed at a real finished heads-up match** (needs a played-out tournament). Covered by `a-loser-is-never-told-they-won.law.test.tsx`, `tournamentChampionCloseout.law.test.ts`, `tournamentAllFormatsCloseout.law.test.ts`, and the published closeout read verbatim.
- **The hero avatar was never observed with Dan seated**, on any device. He was not seated during the live check, so the live page had no hero circle.
- **Accessibility and performance testing: NOT RUN.** No axe pass, no Lighthouse, no profiling.
- **Visual regression screenshots of the final state: NOT CAPTURED.** The verification was numeric.
- **No database, migration, seed, engine, or monitoring test was run** — none applied.

### 14.2 The one test failure that occurred, stated honestly

`Client Unit Tests shard 1` failed **once**, on the earlier PR #10172 head
`17ca27c40`, in **another lane's** `tests/a-refund-never-reads-horse-identity.law.test.ts`

> `Test timed out in 30000ms` — "no migration since the incident uses horse status to take money back or close what is owed"

`fail-fast` then cancelled shards 2, 5 and 7, so one slow test reported as four red
checks. It **passed** on the next head (`d43009169`), all eight shards green.

**A later pass does not establish that the first failure was harmless, and no cause
for that specific run was independently established.** What _was_ established, by
measurement on a branch touching no migration: the file takes **13.3 s** on an idle
machine and **39.1 s** when the machine is also running a Playwright suite, against
a **30 s** vitest default; its cost scales with the whole of `supabase/migrations/**`,
which every lane grows; and a bare timeout cannot distinguish "no violation found"
from "the scan ran out of clock" (`CLAUDE.md` 10.86 rule 1). That is **unresolved
timing fragility**, not a flake. Also established: this task's diff touches no
migration and no SQL, and the one test file it adds is **not in shard 1** (verified
from that job's own log). Handed to its owner: issue **#10176**, notice on **#10141**.

Five further red checks appeared on the **first** PR #10172 head `a9b5c0d32`
(TypeScript Check, Client Unit Tests, CSS Beat E2E, Server Engine, What this run
verified). Those were a **superseded** run cancelled by concurrency. The repo's own
gate says so in its log, verbatim:

> `FIXTURE_GATE_NO_VERDICT_CANCELLED: compilation=cancelled native=skipped. This run was cancelled before it could verify the commit, so it is not a verdict either way. The run that superseded it carries the required check.`

Not a verdict, no action taken. **Do not read a cancelled-run failure as a real one.**

---

## 15. SETBACKS, FAILED APPROACHES, AND LESSONS

### 15.1 THE BIG ONE — the obvious fix for item 4 was wrong, and the cascade is documented

Setting `--seat-avatar-hero-ratio: 1` (plus the hero-slot edits that followed from
it) turned **four separately measured constants** red, each fix moving the next:

1. `--sp-hero-clear` (the strip between the felt and the bar) went **15.2 / 14.8 / 12.0px slack** once the hero block shrank; the beat's own message says to lower the reserve in the same commit.
2. The short-ring `--sp-hero-clear` is a **literal `64px` that must stay exactly base + 4**, or `6-max stays shorter and centered` reads the six-max ring as giving up height nobody asked it to.
3. `.seat__cards--hero`, the band the hero's own hole cards are centred in, is half the hero block tall: shrink the block and at **375×667 in the embedded shell** the band becomes shorter than a two-card row and **6.8px of the player's own cards** go under the decision row. `top: calc(var(--seat-avatar-size) * -0.1667)` reduced it to 2.65px; `-0.3333` cleared it (**the row is centred, so lifting the top by X moves the cards by X/2** — a trap worth remembering).
4. The threshold at which the adaptive pass starts resizing a villain's revealed cards mid-runout.
5. Separately, "card layout and every ancestor translation remain exact" at 375px 9-seat bisected to **the bar height** (64 passes, 80 fails), not the hero ratio — easy to misattribute.

**Proof it was the common cause, by controlled experiment:** reverting **only** the
hero resize, with everything else in place, turned **every one** of those beats
green; with it in, they failed. So item 4 was **split out of PR #10151**, every
hero-related source and test edit reverted, and the changelog, law and PR body
rewritten. **LESSON: on this felt, the hero slot is not a leaf. Measure first,
and expect any change to it to move four other hand-tuned constants.**

### 15.2 A CSS rule could not fix item 5

`.ca-raising` already hid the chat bubble and the previous-hand card. The time-bank
tile has `position: relative` + `backdrop-filter`, so it is its own stacking
context and a compositor need not honour an inherited `visibility`. **A structural
React unmount was the answer.** Do not reach for another CSS rule here.

### 15.3 Item 2's ceiling had to be discovered by bisection

96px does not hold everywhere. `Player On Painted Felt: seat__info` at 375px 6-max
was binary-searched: **98px clears, 100px fails**. 375×667 and ≤340px kept their
own heights for their own measured reasons. **These two exceptions are Dan-recorded
and must not be "tidied up" into one rule.**

### 15.4 A real mistake of mine: a comment that outlived its revert

§7.7. The revert of the hero-ratio attempt restored the value and left the prose
asserting the opposite, and that prose **shipped**. **LESSON: when you revert a
change, revert its comments and its changelog claims too, and re-read the file you
touched as the next agent would read it.** This was found only because this handoff
required reading the actual diff rather than trusting memory.

### 15.5 Failed commands and environment friction

- `git commit` refused by `scripts/guard-shared-clone.sh` → created the `/home/claude/ca-work` worktree.
- `git commit` refused by the agent-identity guard → set the `Smarter-Poker` author identity (§3.1 item 6).
- `bash scripts/agent-push.sh` refused twice with `[merged-branch guard] BLOCKED: GitHub did not identify the trusted destination repository` → the lowercase remote (§3.1 item 1).
- `gh pr create` and `gh pr merge` → GraphQL 403 (§3.1 item 2).
- `env -u GH_TOKEN gh …` → `gh auth login` (§3.1 item 3).
- `gh api … rerun-failed-jobs` → `403 This workflow is already running`; a re-run can only be requested after the run completes.
- A first TS1005 syntax error after the first `upperLeft` edit: the edit had landed on the **`upperRight` block's** closing `</div>}`. In a 32k-line file, locate the true closing boundary (for `upperLeft` it is after the `add-chips-icon-btn__img` block, `</div>\n)\n}`) before inserting.
- `ENOSPC: System limit for number of file watchers reached` in this container on `hero-cards-no-glitch.spec.ts` during a full local sweep — **a container limit, not a product defect; zero assertion failures.**
- A background shard-membership probe (`ui-test-selection.mjs` across 8 shards) was killed at its time limit; shard 1's contents were read from the CI job log instead.
- A merge attempt was twice refused by the session's own auto-mode classifier before Dan authorized it. Dan has since standing-authorized the agent to merge its own PRs.

### 15.6 Working in Dan's browser — what to know

The remote-devices bridge reaches his Mac. `Control Chrome` lists tabs across
**multiple Chrome profiles**, and **they do not share localStorage**. A table URL
opened by `open_url` landed in a profile with **no** Club Arena session and
redirected to sign-in, which looked exactly like a revoked-session defect and was
not. The signed-in profile was the one already showing `KINGS CLUB`.
`window.open(...)` from page context is **popup-blocked**, so the only way into the
signed-in profile was to navigate one of its existing tabs — which was done,
read-only, and **the tab was returned to the page it was on**. Signed in as
`KingFish`. **Never click anything that acts** (fold, leave, sit) and never seat or
buy in: `CLAUDE.md` 11.5 forbids spending real chips to test, and 10.84 forbids
using Dan's personal account for a probe.

### 15.7 Scope discipline

Dan reset the chat's scope mid-task and asked for adopted work to be handed back.
The one adopted item was the horse-refund test timeout (§7.9). **No repair, retry
loop, watcher or detector was built for it** (`CLAUDE.md` 10.11, 10.12), and
nothing of that lane's was edited. A second observation — that Dan's Chrome has a
profile without a Club Arena session — was recorded and **deliberately not
pursued**: it is not a defect and Dan did not report it.

---

## 16. KNOWN DEFECTS AND ARCHITECTURAL HOLES

| Priority | Defect or hole                                                                        | Evidence                                                                                   | Impact                                                                                                                                                           | Recommended fix                                                                                                                                                                                                     | Status                                                                                |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **P1**   | `tests/a-refund-never-reads-horse-identity.law.test.ts` times out on a busy runner    | 13.3 s idle vs 39.1 s loaded vs a 30 s budget; measured on a branch touching no migration  | one slow test reddens four shards via `fail-fast` and blocks **any** unrelated publish; a bare timeout cannot distinguish "no violation" from "ran out of clock" | explicit timeout derived from the measured scan cost **in the owning file**; a distinct outcome when the scan cannot finish; cache the parsed migration corpus. **Never weaken, skip or quarantine the law itself** | **HANDED OVER, issue #10176, 0 comments, UNACKNOWLEDGED. Not this task's to fix.**    |
| **P1**   | A comment in `design-tokens.css` asserted the opposite of its own value               | §7.7                                                                                       | the next agent sets the ratio to 1 and re-breaks four measured constants — the 10.7 revert-war mechanism                                                         | corrected                                                                                                                                                                                                           | **FIXED in `b753cdeeb`, in OPEN PR #10185. STILL WRONG ON `main` UNTIL THAT MERGES.** |
| **P2**   | `fail-fast` on the client unit shards converts one failure into four red checks       | the §14.2 incident                                                                         | triage becomes guesswork; "which shard is real" is unanswerable from the check list                                                                              | let the shards finish independently                                                                                                                                                                                 | **NOT STARTED. Not authorized.**                                                      |
| **P2**   | No test scene renders a human player                                                  | every scene gives all nine seats character art; this is why a 12% error reached production | the entire photograph-hero class of defect is untested                                                                                                           | make the photograph-hero case a standard scene in the felt suite (the `data-hero-avatar` knob already exists)                                                                                                       | **NOT STARTED. Not authorized. HIGHEST VALUE of the unauthorized items.**             |
| **P2**   | With no hero seated, the size reference is "whichever portrait happens to be biggest" | observed live: 6 circles at 84.92 / 84.65, factors 1 / 0.9968                              | two spectators at two tables can see the same horse at different sizes; nobody designed this                                                                     | decide a deterministic reference for the unseated case                                                                                                                                                              | **PRE-EXISTING, now bounded by the cap. NOT STARTED.**                                |
| **P3**   | Two of Dan's six bugs were earlier changes that half-landed                           | item 3 (tile size moved, painted frame not); item 6 (one function, two callers)            | the same class recurs                                                                                                                                            | a guard that refuses a replaced literal still being referenced                                                                                                                                                      | **NOT STARTED. Not authorized.**                                                      |
| **P3**   | The phone action bar needs three rules where one should do                            | 96 / 52 / 48, found by bisection                                                           | the bar's height and the hero's card band are hand-tuned against each other                                                                                      | derive the bar from the room actually left below the felt                                                                                                                                                           | **NOT STARTED. Not authorized.**                                                      |
| **P3**   | `opponentAvatarLayout.prepare()` bails entirely if the hero's alpha is unavailable    | `if (!heroAlpha) return false;`                                                            | a cross-origin photograph that taints the canvas would leave **every** opponent unscaled                                                                         | confirm whether production photographs are CORS-readable                                                                                                                                                            | **UNVERIFIED — NEXT AGENT MUST INSPECT**                                              |
| **P3**   | Three of the six behaviours are certified from shipped code, not observation          | §14.1                                                                                      | a defect reachable only in live play could survive all of this                                                                                                   | a play-money verification table with a service identity (needs Dan's authorization)                                                                                                                                 | **OPEN ACCEPTANCE GAP. Dan's call.**                                                  |
| **P4**   | The clearance-measurement script is ephemeral                                         | §12                                                                                        | the 12-layout clearance check is not repeatable as written                                                                                                       | promote it to `scripts/dev/verify-hero-avatar-clearance.mjs`                                                                                                                                                        | **NOT STARTED**                                                                       |
| **P4**   | No accessibility or performance verification                                          | §14.1                                                                                      | unknown                                                                                                                                                          | —                                                                                                                                                                                                                   | **NOT RUN**                                                                           |

---

## 17. SECURITY, SECRETS, AND CREDENTIALS

**No secret value appears in this document, and none was printed during the work.**

| Name                                                 | Where configured                | Used by                                                           | Available here                                                                                                   |
| ---------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GH_TOKEN` / `GITHUB_TOKEN`                          | session environment             | `gh`, `scripts/agent-push.sh`                                     | **yes** — the only GitHub identity in this container. Can read, push and **merge over REST**; GraphQL is refused |
| `SUPABASE_SERVICE_ROLE_KEY`                          | engine host / repository secret | the Hetzner engine (bypasses RLS)                                 | **not used by this task**                                                                                        |
| `SP_EMAIL` / `TEST_USER_EMAIL` / `PROBE_LOGIN_EMAIL` | `.env.local` and Vercel         | the platform service identity `daniel@smarter.poker` (role `god`) | **names only. NOT read, NOT used**                                                                               |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`       | build env                       | the client                                                        | the test fixture supplies a literal `local-fixture` anon value; **no real key touched**                          |

**Rules that were followed and must keep being followed:**

- Never print a secret, never read a value out of a `.env` file, never scrape another task's credentials, never write a key to a new file. An agent did all three on 2026-11-08 and it is recorded as a security incident (`.agent/audits/2026-11-08-SECURITY-INCIDENT-prescreen-credential-copy.md`).
- Never use Dan's personal account for a probe (`CLAUDE.md` 10.84, 10.10). This task **read** his signed-in browser at his explicit request and **took no action in it**.
- A synthetic probe signs out with `{ scope: 'local' }`, never a bare `signOut()`.
- Never add a `VITE_`-prefixed secret.
- **No secret is believed exposed by this work.** CONFIRMED.

---

## 18. DATABASE, MIGRATION, AND SEED STATUS

**None. Explicitly.** This task added, applied and rolled back **zero** migrations,
touched **zero** SQL, wrote **zero** rows, and ran **zero** database probes. No
schema, constraint, index, RLS policy or seed changed. Nothing in this task went
near a money path.

For a future agent who _does_ need the database, the rules that apply are
`CLAUDE.md` §2 (the production DDL policy: one transaction per migration, no DDL
probes, the `:50–:03 UTC` DDL refusal window, `-- @install-window: daily-maintenance`
for hot-table locks, migrations reach production **only from protected main**),
§4.5 (**never hand-pick a migration version** — run `node scripts/new-migration.mjs "what it does"`),
and §11.5 (**never spend real chips to test a rule**; over the Supabase MCP a
transaction does **not** span two calls, so use one call with one self-aborting
`DO` block and treat an error as the success case).

---

## 19. CURRENT BLOCKERS AND DECISION POINTS

| #   | What is blocked                      | Why                                                                                       | Technical or Dan's authority | Options                                                                                                                                                                                               | Recommended                                        |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | PR #10185 merging                    | its required checks were still running at the time of writing                             | technical, resolves itself   | (a) wait, confirm green, merge; (b) if the §16.1 timeout recurs, re-run the failed job **once** and, if it fails again, say plainly that an unrelated lane's fragility is blocking the closing record | **(a)**                                            |
| 2   | Issue #10176 being acted on          | it belongs to another lane and has 0 comments                                             | neither — another lane's     | leave it; Dan has ruled it **not** a gate                                                                                                                                                             | **leave it**                                       |
| 3   | Observing items 1, 5, 6 live         | needs live states only reachable by playing for money; no approved non-money route exists | **Dan's authority**          | (a) leave them test-covered and say so; (b) Dan authorizes a play-money verification table with a service identity and horses                                                                         | **(a) now; (b) is the real fix and is Dan's call** |
| 4   | The seven improvement ideas in §20.5 | Dan said "No additional improvements are needed"                                          | **Dan's authority**          | leave recorded                                                                                                                                                                                        | **leave recorded**                                 |

**Nothing here is a business-critical decision being made silently.**

---

## 20. REMAINING WORK

### 20.1 CRITICAL

1. Merge PR **#10185** so the closing record **and the `design-tokens.css` comment correction** reach `main`. Until then the repo asserts, in writing, that Dan's hero ratio was superseded.

### 20.2 HIGH

2. After that merge: confirm the publisher run is terminal-success and that both endpoints serve a revision **containing** `b753cdeeb`.
3. Release the owned work tree `/home/claude/ca-work` (and the branch, once merged).

### 20.3 MEDIUM

4. Promote the clearance script to `scripts/dev/verify-hero-avatar-clearance.mjs` (§12) so the 12-layout check is repeatable.
5. Inspect whether a production player photograph is CORS-readable for the canvas alpha decode (§16, P3) — if not, `prepare()` silently leaves every opponent unscaled.

### 20.4 LOW

6. Chase an acknowledgment on issue #10176 if Dan later wants it owned.

### 20.5 OPTIONAL ENHANCEMENTS — RECORDED, **NOT AUTHORIZED** ("No additional improvements are needed")

7. Make the photograph-hero case a standard scene in the felt suite. **Highest value: it closes the whole class that produced item 4.**
8. Hash the published chunks before and after every release as a standard step — it proved in one command that no approved geometry moved.
9. A guard that refuses a replaced literal still being referenced anywhere (would have caught items 3 and 6 at the time).
10. Drop `fail-fast` on the client unit shards.
11. Derive the phone action-bar height from the room left below the felt instead of three per-breakpoint literals.
12. Point the measurement harness at the other things Dan judges by eye (card sizes, name plates, badges).
13. A play-money verification table with a service identity so an agent can actually watch seated-player behaviour.

---

## 21. PRIORITIZED NEXT-PHASE EXECUTION PLAN

### Phase 0 — Recover and verify current state

**Objective:** know the truth before touching anything. **Prerequisites:** none.

1. Attach the repository. **Immediately** run
   `git remote set-url origin https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena`.
2. Read `CLAUDE.md`, `AGENTS.md`, `AGENT-PLAYBOOK.md`, `PUBLISHING.md`, `docs/agent-policy/REFERENCE-INDEX.md`.
3. Read `CHECKPOINT-six-live-table-fixes.md` on the PR branch (it is more complete there than on `main`).
4. `git status`, `git worktree list`, `git rev-list --left-right --count origin/main...HEAD`, `git stash list`.
5. `gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/10185 --jq '.state, .mergeable, .mergeable_state'` and the check-runs for its head.
6. `curl` both `build-info.json` endpoints; if the revision is not one of ours, prove ours is contained with `git merge-base --is-ancestor`.
   **Completion:** you can state the branch, the PR state, the live revision, and whether the comment correction is on `main`. **Risk:** believing a cancelled run is a real failure.

### Phase 1 — Protect completed work

**Objective:** change nothing that is already live and correct.

- **Do not** set `--seat-avatar-hero-ratio` to anything but `1.3333`.
- **Do not** edit `tests/a-refund-never-reads-horse-identity.law.test.ts` or anything else of PR #10141's lane.
- **Do not** weaken, skip or quarantine any `*.law.test.*`.
- **Do not** regenerate `tests/e2e/support/geometry-baseline.json` unless a geometry change legitimately requires it, and then only with `node scripts/dev/update-geometry-baseline.mjs`.
- **Do not** prune the origin's `pool/` or re-create `public/hub/club-arena/` in the World Hub.
  **Completion:** nothing above has been touched.

### Phase 2 — Land the closing record (**THE ONLY OPEN WORK**)

**Objective:** PR #10185 on `main`, published, verified.
**Prerequisites:** Phase 0.

1. Confirm every required check on head `b753cdeeb` is green.
2. If `Client Unit Tests shard 1` is red on the horse-refund timeout: it is **not** this PR's (this PR touches one CSS comment and one markdown file). Re-run the failed jobs **once**, after the run completes:
   `gh api -X POST repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/<id>/rerun-failed-jobs`.
   If it fails a second time, comment once on #10185 with the evidence, reference #10176, and tell Dan plainly that an unrelated lane's fragility is blocking the closing record. **Do not** edit that test.
3. Merge: `gh api -X PUT repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/10185/merge -f merge_method=squash -f sha=b753cdeebfdcf8905bd6c7e879953352f58efdd7`
   (re-read the head first — if someone pushed, use the current head).
4. Find the `publish-club-arena.yml` run for the merge commit; wait for terminal-success.
5. `curl` both endpoints. Accept a **newer** revision that contains the merge; prove it with `git merge-base --is-ancestor`.
6. Confirm on `main`: `git show origin/main:src/styles/design-tokens.css | grep -A3 "STILL IN FORCE"`.
   **Completion:** #10185 merged, publisher green, both endpoints serving a revision containing it, the corrected comment on `main`. **Risk:** forcing an older revision to "prove" delivery — forbidden by `CLAUDE.md` 1.1.

### Phase 3 — Release owned resources

1. `git worktree remove /home/claude/ca-work` then `git worktree prune` from the parent clone (`/home/claude/smarter-poker-club-arena`) — **only after** Phase 2, and only after `git status` in it is clean and `bash scripts/check-unpushed-work.sh` reports nothing unpushed.
2. Delete the merged remote branches if that is the repo's habit (**UNKNOWN — inspect whether other merged branches are deleted**).
3. Confirm the stash stack is empty.
   **Completion:** no owned resource left behind.

### Phase 4 — Report and stop

Report to Dan, in plain English: all six delivered and live; the comment defect found and fixed; the two acceptance gaps (three behaviours test-covered not observed; #10176 unacknowledged); and that the chat is ready to archive. **Do not start §20.5. Dan has said no additional improvements are needed.**

### Phases 5–8 — Only if Dan authorizes more

Phase 5: the photograph-hero scene in the felt suite (§20.5 item 7).
Phase 6: published-chunk hashing as a standard release step (item 8).
Phase 7: the replaced-literal guard (item 9) and `fail-fast` (item 10).
Phase 8: the play-money verification table (item 13) — this is the only one that closes the observation gap.
Each needs its own branch, its own PR, its own changelog, and a law test where it pins a Dan ruling.

---

## 22. EXACT FIRST ACTIONS FOR THE NEXT AGENT

```bash
# 1. Attach the repo, then FIX THE REMOTE CASING (this breaks the push guard otherwise)
cd /home/claude/ca-work          # or wherever the worktree is attached in your session
git remote set-url origin https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena

# 2. Read the governing instructions, in this order
#    CLAUDE.md  AGENTS.md  AGENT-PLAYBOOK.md  PUBLISHING.md
#    docs/agent-policy/REFERENCE-INDEX.md
#    CHECKPOINT-six-live-table-fixes.md       <-- this task's single record

# 3. Safe status
git status && git worktree list && git stash list
git fetch -q origin main && git rev-list --left-right --count origin/main...HEAD
git log --oneline -5

# 4. The one open item
GH_PAGER=cat gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/10185 \
  --jq '"state=\(.state) mergeable=\(.mergeable) mergeable_state=\(.mergeable_state) head=\(.head.sha)"'
GH_PAGER=cat gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/commits/b753cdeebfdcf8905bd6c7e879953352f58efdd7/check-runs?per_page=100" \
  --jq '.check_runs[]|select((.conclusion!="success" and .conclusion!="skipped" and .conclusion!="neutral") or .status!="completed")|"\(.status)/\(.conclusion // "-")  \(.name)"'

# 5. Live truth
curl -s https://ca-static.smarter.poker/build-info.json
curl -s https://smarter.poker/hub/club-arena/build-info.json
# if the revision is not 6a91dbe1c, prove ours is contained:
git merge-base --is-ancestor 6a91dbe1cde711d021452e799bb0e4968fabb465 <live_sha> && echo CONTAINED

# 6. DO NOT MODIFY
#    - src/styles/design-tokens.css  --seat-avatar-hero-ratio  (1.3333, keep it)
#    - tests/a-refund-never-reads-horse-identity.law.test.ts   (another lane's)
#    - any *.law.test.* weakening, any skipped test, any geometry baseline by hand

# 7. RESUME AT: Phase 2 of the plan - merge PR #10185, publish, verify both endpoints.
```

---

## 23. ACCEPTANCE CRITERIA

### For this task (the six items) — all met except where noted

- [x] Lightning leave control in the upper-left HUD, label exactly "Leave Next Hand", no `centerTop` node over the top villain, felt still tappable around it. _(live; behaviour test-covered, not observed in a pool session)_
- [x] Phone action buttons at 96px ≤480px, with the 52px (375×667 portrait) and 48px (≤340px portrait) exceptions explicitly recorded and kept.
- [x] The four felt tools paint at the hamburger's frame (52px, 44px at 320px). _(measured on the running page)_
- [x] The hero's rendered circle is never smaller than any opponent's, at 375 / 393 / 1024 / 1440 px across 2/6/9 rings, with a photograph hero **and** a character-art hero.
- [x] Zero overlap between any avatar and **another** seat's hole cards, another seat's name label, or the action controls, at all twelve layouts. The own-seat tuck is Dan's design and is preserved.
- [x] The bottom-left HUD row unmounts while the bet slider is open. _(live; not observed on a live turn)_
- [x] A heads-up/cashing loser sees their own finish and own prize, an unpaid loser sees no celebration, spectator and qualifier paths unchanged. _(live; not observed at a real finished match)_
- [x] Required checks green and protected squash merge for both releases.
- [x] Owning publisher terminal-success for both releases.
- [x] The exact merged revision — or a later revision proved to contain it — visible at **both** public endpoints.
- [x] All six fixes grep-confirmed in the **current** live bundle.
- [x] Every behaviour change pinned by a test, with a `docs/laws.d/` entry where it pins a Dan ruling.
- [x] A changelog per change, in its own file, never appended to `MIGRATION-CHANGELOG.md`.
- [x] One checkpoint for the task.
- [x] No migration, SQL, money path, engine, monitoring rule or workflow touched.
- [x] No `is_horse` branch added; no animation gated; no auto table switch added.
- [x] Adopted work handed back without editing the owner's files.
- [ ] **PR #10185 merged** so the closing record and the comment correction are on `main`. **← THE ONLY UNMET ITEM**
- [ ] Items 1, 5, 6 **observed live**. **Cannot be met without a non-money verification route. Dan's decision.**
- [ ] Issue #10176 acknowledged by its owner. **Not this task's gate, per Dan.**

### Permanent invariants any future change must not break

- `--seat-avatar-hero-ratio` stays `1.3333`.
- An opponent's rendered avatar circle may equal the hero's or be smaller, **never larger**.
- The three `--sp-action-btn-h` declarations keep their values **and their order**.
- The four felt tools read `--sp-tabbar-control`, not `--sp-game-tool-size`.
- `tests/e2e/table-proportions.spec.ts` passes **99/99**.
- `npx tsc --noEmit` is clean; no red test is ever pushed.
- Working tree clean, no stray stash entry, no abandoned worktree.

---

## 24. RECOMMENDED COMMIT STRATEGY

The six items are already committed and live. For the remaining work:

| #   | Commit message                                                  | Files / workstream                                                               | Tests required first             |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| 1   | _(no new commit — merge PR #10185 as it stands)_                | `CHECKPOINT-six-live-table-fixes.md`, `src/styles/design-tokens.css`             | its required checks              |
| 2   | `test(felt): a photograph hero is a standard scene`             | `tests/e2e/table-proportions.spec.ts`, `tests/e2e/support/portraitRailScene.tsx` | the full 99-beat suite           |
| 3   | `chore(dev): make the avatar clearance check repeatable`        | `scripts/dev/verify-hero-avatar-clearance.mjs`                                   | run it                           |
| 4   | `fix(ci): give the migration scan a budget matched to its cost` | **the owning lane's file — only with Dan's or that lane's say-so**               | that file, timed idle and loaded |
| 5   | `chore(release): hash the published chunks before and after`    | release tooling                                                                  | a dry run on a known release     |

**Never mix these.** One concern per commit; a test that pins replaced behaviour is
updated **in the same commit** as the behaviour.

---

## 25. FINAL CONTINUATION SUMMARY

**Exact stopping point.** All six of Dan's 2026-11-09 live-table bugs are fixed,
merged, published and confirmed present in the **current** live bundle. Two
releases carried them: `490c72a31` (items 1, 2, 3, 5, 6) and `6a91dbe1c`
(item 4, the hero avatar). The work tree `/home/claude/ca-work` is **clean**, on
branch `docs/six-fix-checkpoint-final-2026-11-09` at `b753cdeeb`, two commits ahead
of `origin/main`, both of them in **open PR #10185** whose required checks were
running when this was written.

**What the next agent works on first.** Confirm #10185's checks, merge it, confirm
the publisher, confirm both endpoints serve a revision containing it, then release
the work tree. That is Phase 2 and Phase 3 of §21. Nothing else is open.

**Most important locked requirements.** `--seat-avatar-hero-ratio` is `1.3333` and
stays there. An opponent's circle may equal the hero's, never exceed it. The three
phone action-bar heights keep their values **and their order**. The four felt tools
read `--sp-tabbar-control`. A horse is a player in everything (10.5). Animations
always play (10.6). "em bars" means em dashes only (10.7). Never push a red test.
Never claim deployed without the live revision in hand (1.4).

**Greatest technical risk.** The felt's geometry is a lattice of hand-measured
constants in which the hero slot is **not** a leaf. One token change turned four
separate measured beats red, each fix moving the next, and the only way out was a
controlled experiment proving the common cause. Measure before changing, and run
the full 99-beat suite before believing anything.

**Greatest visual risk.** `src/styles/design-tokens.css` on `main` **right now**
carries a comment asserting that Dan's "hero 33% bigger" ruling was superseded and
that "at 1 the frame and the bust agree", directly above a value of `1.3333`. It is
corrected in PR #10185 and wrong on `main` until that merges. This is the precise
mechanism by which the hamburger revert war ran for two days: a written claim in
the repo contradicting the code, re-enforced by every agent who reads the repo.
**If you read that file before #10185 lands, the value is right and the comment is
wrong.**

**Greatest data-integrity risk.** None from this task — it touched no migration, no
SQL, no money path and no engine. The nearest adjacent risk is `CLAUDE.md` 11.5:
never spend real chips to test a rule, and over the Supabase MCP a transaction does
not span two calls.

**Decisions that still require Dan.** Whether to authorize a non-money verification
route so items 1, 5 and 6 can actually be watched rather than certified from shipped
code; and whether any of the seven recorded improvements in §20.5 should be built —
he has said no additional improvements are needed.

**How to continue without restarting discovery.** Everything measured in this task
is written down in three places inside the repository: `CHECKPOINT-six-live-table-fixes.md`
(the single task record, richest on the PR branch), `docs/changelog/2026-11-09-six-live-table-fixes.md`
and `docs/changelog/2026-11-09-the-hero-avatar-is-never-the-smallest.md`. Every
behaviour change is pinned by a named test with a `docs/laws.d/` entry, and the
item-4 numbers are reproducible at any time with
`node scripts/dev/measure-seat-avatar-art.mjs`. Read §22, run those six commands,
and you will know the branch, the PR, the live revision and the one open item inside
five minutes — then resume at Phase 2. Do not re-derive the avatar lattice; §6.2 and
§15.1 already cost a day and the answers are there.
