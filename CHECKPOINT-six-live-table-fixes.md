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

1. One re-run of `Client Unit Tests shard 1` on PR #10172 (queued; it is red on
   another lane's test, see below), then protected squash merge, publisher
   terminal-success and the revision visible at both endpoints.

Nothing else in this task is open.

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
was returned to the page it was on. `/home/claude/ca-work` stays until item 4
is live.
