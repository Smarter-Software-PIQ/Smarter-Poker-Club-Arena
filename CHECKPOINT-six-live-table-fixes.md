# CHECKPOINT — Dan's six live-table bugs, 2026-11-09

**The single record for this task.** Scope is the six bugs Dan reported on
2026-11-09 from three screenshots of a live PLO4 Lightning table and a finished
heads-up match, and nothing else. Per-change history stays in its own
changelog, as law 10.9 rule 9 requires:
[`docs/changelog/2026-11-09-six-live-table-fixes.md`](docs/changelog/2026-11-09-six-live-table-fixes.md)
(items 1, 2, 3, 5, 6, plus the live-verification record) and
[`docs/changelog/2026-11-09-the-hero-avatar-is-never-the-smallest.md`](docs/changelog/2026-11-09-the-hero-avatar-is-never-the-smallest.md)
(item 4).

## The assignment, verbatim

> 1, the stand up and leave button for lightning games needs to move to the left side, not in the middle of the table covering the top villain. And it should just say, "Leave Next Hand"
> 2, the fold check bet buttons are too small on movile, they should be double the current size. we have alot of room on the bottom to increase the sizes.
> 3, the message button, previous hand, time bank and rabbit hunt buttons should all be the same size as the hamburger menu button.
> 4, the "hero" avatar is smaller then all the other avatars at the table, it should always be the same size.
> 5, the action slider menu that pops up when click raise, allows the time bank to appear and bleed through.
> 6, in heads up, the loser received a Champion and prize 38 even though they lost.

## Deliverables, acceptance criteria, state

Acceptance for every item: required checks green, protected squash merge, the
owning publisher terminal-success, and the exact merged revision independently
visible at both `https://ca-static.smarter.poker/build-info.json` and
`https://smarter.poker/hub/club-arena/build-info.json` (CLAUDE.md 1.4), with
the behaviour itself read off the published bytes or the running page.

| #   | Deliverable                                                                     | Acceptance                                                                                                                            | State                                                                                           |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Lightning leave control moves to the upper-left HUD and reads "Leave Next Hand" | no centre-top node over the top villain; the label is the control's only name; the felt stays tappable around it                      | **DONE, live** in `490c72a31`                                                                   |
| 2   | Phone action buttons at double height                                           | `--sp-action-btn-h: 96px` at <=480px, with the two measured exceptions recorded and kept                                              | **DONE, live** in `490c72a31`                                                                   |
| 3   | Felt tool buttons match the hamburger                                           | painted frame of chat / previous hand / time bank / rabbit hunt equals `--sp-tabbar-control` (52px, 44px at 320px)                    | **DONE, live** in `490c72a31`                                                                   |
| 4   | The hero avatar is never smaller than an opponent's                             | measured hero and opponent circles across 320-1024px and 2/6/9-handed rings, with a photograph hero and a character-art hero          | **PR #10172**, awaiting one re-run of an unrelated red shard, then merge / publish / live proof |
| 5   | The raise slider is never bled through by the time bank                         | the bottom-left HUD row unmounts while the slider is open                                                                             | **DONE, live** in `490c72a31`                                                                   |
| 6   | The heads-up loser sees their own finish, not a Champion card                   | a cashing non-winner gets their own place and prize; an unpaid loser gets no celebration; the spectator and qualifier paths unchanged | **DONE, live** in `490c72a31`                                                                   |

Live proof for 1, 2, 3, 5, 6 — publisher run `42630046134` terminal-success,
both endpoints reporting `490c72a315a000f66575edb6cd53b96e5635da41`, what was
read off each published chunk and off the running page in the signed-in
browser — is recorded in the five-fix changelog's "Verified live" section. The
two action-button size exceptions (52px at 375x667 portrait, 48px at <=340px
portrait) are recorded there and in `ActionPanel.css` beside the measurement
that set them.

## What remains

Nothing. All six items are delivered and live. The two genuine acceptance gaps
are named at the end of this file; neither is work this task can close.

## Adopted work handed back

`tests/a-refund-never-reads-horse-identity.law.test.ts` (another lane's law,
added in #10141) times out on a busy runner — 30 s budget against a measured
13.3 s idle / 39.1 s loaded — and `fail-fast` turns that one slow shard into
four red ones, which is what is holding PR #10172. This task diagnosed and
measured it and then handed it back rather than fixing it: the measurement, the
10.86 reading and a suggested shape for the fix are in **issue #10176**, with a
cross-lane notice on **#10141**. No file of that lane's was changed, and no
repair, retry loop or detector was built for it (10.11, 10.12). **Owning-lane
acknowledgment is pending and has not been obtained.**

## Out of scope, deliberately untouched

- The daily 04:00 America/Chicago engine maintenance and any engine release.
  This is a client-only delivery through `publish-club-arena.yml` and never
  waited on an engine window (CLAUDE.md, non-engine delivery).
- `--seat-avatar-hero-ratio` and the hero slot itself. The first attempt at
  item 4 changed it and destabilised four separately measured constants; the
  released fix caps the opponent normaliser instead and leaves every hero token
  as it was.
- Any migration, SQL, money path, monitoring rule or CI workflow.
- The observation that Dan's Chrome has a second profile without a Club Arena
  session, which is why a table URL opened there redirects to sign-in. Not a
  defect and not reported by Dan; recorded here and not pursued.

## Owned resources released

The scratch worktree `/home/claude/ca-base` is removed and pruned; the stash
stack is empty; the one tab navigated in Dan's browser for the signed-in check
was returned to the page it was on. `/home/claude/ca-work` is released now that item 4
is live.

---

## Item 4 verified live, 2026-11-09

Merged as squash `6a91dbe1cde711d021452e799bb0e4968fabb465`. `publish-club-arena.yml` run `42642327309`
terminal-success, and both public endpoints report that exact revision:

| endpoint                                               | `ca_sha`                                   |
| ------------------------------------------------------ | ------------------------------------------ |
| `https://ca-static.smarter.poker/build-info.json`      | `6a91dbe1cde711d021452e799bb0e4968fabb465` |
| `https://smarter.poker/hub/club-arena/build-info.json` | `6a91dbe1cde711d021452e799bb0e4968fabb465` |

### Avatar sizing, measured

A photograph hero beside character-art opponents, through the repo's own
isolated rail fixture with its real stylesheets and bundled artwork - the
combination a human player sees at a horse-heavy table, and the one no scene
had ever rendered. No test club and no funded account was created for this.

| viewport   | ring      | hero circle | opponent circles | hero never smaller |
| ---------- | --------- | ----------- | ---------------- | ------------------ |
| 375 x 667  | 2 / 6 / 9 | 66.66px     | 66.66px          | yes, exactly equal |
| 393 x 852  | 2 / 6 / 9 | 67.88px     | 67.88px          | yes, exactly equal |
| 1024 x 900 | 2 / 6     | 77.63px     | 60.07px          | yes                |
| 1024 x 900 | 9         | 76.81px     | 59.44 - 76.81px  | yes                |
| 1440 x 900 | 2 / 6     | 76.23px     | 59.00px          | yes                |
| 1440 x 900 | 9         | 75.48px     | 58.42 - 75.48px  | yes                |

Before the cap, the same measurement gave 74.80px opponents against a 66.66px
hero at every phone width, and 106.1px against 76.8px at desktop nine-max.

With character art on every seat (what every pre-existing scene renders) the
hero and all opponents measure the identical circle at every width and ring,
and the applied factor moves by 0.0006 from its previous value, so no render
anyone has reviewed changes.

### Clearance, measured

Same twelve layouts, photograph hero:

| what                                                         | overlap                                                |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| any avatar vs **another** seat's hole cards                  | **0 px^2**                                             |
| any avatar vs **another** seat's name label                  | **0 px^2**                                             |
| any avatar vs the action controls (`.action-panel`, mounted) | **0 px^2**                                             |
| any avatar vs **its own** seat's label and card row          | 232.7 - 319.8 px^2 (cards), 316.6 - 429.4 px^2 (label) |

The last row is Dan's 2026-08-20 ruling ("avatars must be CONNECTED to the name
box"), not an obstruction, and the cap can only ever shrink an opponent circle
and never touches the hero's, so it cannot have increased any of these.

The 99-beat `tests/e2e/table-proportions.spec.ts` suite - every felt scene at
every width and ring, the hero card lanes, the bottom reserve and the ancestor
translations, the suite that turned red on the first attempt at this item -
passes on the merged branch.

Reproduce with `node scripts/dev/measure-seat-avatar-art.mjs`.

### Read off the running page, signed in

In Dan's signed-in Chrome (`KingFish`), on the live 6-handed Lightning cash
table `0f84a1ab-5abb-41b4-a8bd-a33af58f73ea` mid-hand at 775px, on the
published revision:

| what                                          | measured                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| opponent circles                              | 84.92px (the reference portrait, factor 1) and five at 84.65px (factor 0.9968) - all six within 0.3px                               |
| hero seat                                     | **not present** - Dan was not seated, so there is no hero circle on that page to compare and the cap had no ceiling to bind against |
| any avatar vs **another** seat's hole cards   | **0 px^2**                                                                                                                          |
| any avatar vs **another** seat's name label   | **0 px^2**                                                                                                                          |
| any avatar vs its own seat's label / card row | 514.8 / 578.8 px^2, the connected-name-box design                                                                                   |
| action controls                               | not mounted (no seat), so nothing to overlap                                                                                        |

That is a live confirmation the cap does not distort a real table where nobody
is seated in the hero chair - the allocator falls back to the largest decoded
portrait as its reference and the ceiling never binds - and that no avatar
reaches into another chair on a real ring.

**The signed-in PHONE view was not reachable from this session.** There is no
way to resize the desktop browser's layout viewport from here and no phone
device is linked, and a seated photograph hero cannot be produced without
playing for money. The phone numbers in this file are therefore measured
through the repo's own isolated fixture at the merged revision, not read off a
phone. The stylesheet that decides every one of those numbers is **byte
identical before and after this release** (`assets/TablePage-*.css`, same md5
on both published revisions - the fix is JavaScript only), so no approved
geometry changed.

### What was read off the published bytes

`assets/TablePage-CRHhZxL1-v6.js` at the live revision carries the cap
verbatim - `Math.min(target / subject(...).height, ceiling)` guarding the write
to `--sp-opponent-art-scale` - with the slot reader that takes computed
`height`, checks it ends in `px`, and falls back to `offsetHeight`.

### Behaviour still only test-covered

Three of the six need a live state that cannot be reached without playing for
money, and no approved non-money route exists for them, so they remain
**test-covered, not observed live**, and are marked as such:

| #   | needs                                          | covered by                                                                                                                                          |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | a seated Lightning pool session                | `tests/lightning/lightning-leave-control.test.tsx`, plus the published label and the absent centre-top slot read off the running page               |
| 5   | the player's own turn with the bet slider open | `tests/nothing-floats-over-the-open-bet-slider.law.test.ts`, plus `onRaiseModeChange` in the published chunk                                        |
| 6   | a finished heads-up match                      | `tests/a-loser-is-never-told-they-won.law.test.tsx`, `tests/unit/tournamentChampionCloseout.law.test.ts`, plus the published closeout read verbatim |

Creating a test club or funding accounts to observe them is separate scope and
was not done.

### The earlier red check

`Client Unit Tests shard 1` failed once on an earlier head of PR #10172, in
another lane's `tests/a-refund-never-reads-horse-identity.law.test.ts`, with a
bare `Test timed out in 30000ms`. It passed on the next head. **That later pass
does not establish that the first failure was harmless, and no cause for that
specific run was independently established.** What was established is the
fragility itself: the file measures 13.3s on an idle machine and 39.1s on a
loaded one against a 30s budget, its cost scales with the whole of
`supabase/migrations/**`, and a bare timeout cannot distinguish "no violation
found" from "the scan ran out of clock". That is **unresolved timing
fragility**, owned by the lane that added the file, handed over in issue
**#10176** with a notice on **#10141**. It is not a completion gate for this
task, and nothing of that lane's was changed here.

## Final six-item status

| #   | Item                                                   | State                                                         |
| --- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 1   | Lightning leave control on the left, "Leave Next Hand" | delivered and live; behaviour test-covered, not observed live |
| 2   | Phone action buttons at double height                  | delivered, live and measured rendered                         |
| 3   | Felt tool buttons match the hamburger                  | delivered, live and measured on the running page              |
| 4   | The hero avatar is never the smaller one               | delivered, live and measured across twelve layouts            |
| 5   | The raise slider is not bled through by the time bank  | delivered and live; behaviour test-covered, not observed live |
| 6   | The heads-up loser sees their own finish               | delivered and live; behaviour test-covered, not observed live |

### Genuine acceptance gaps

1. Items 1, 5 and 6 are certified from the published bytes and their tests, not
   from observation, for the reason above. Closing that gap needs a non-money
   verification route, which is separate scope.
2. Issue #10176 is unacknowledged by its owning lane.

Nothing else in this task is open.
