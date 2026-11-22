# 2026-11-21: one stash list is never shared, and the shared clone stays on main

## What happened

Measured 2026-11-21 02:28 Central: the owner's shared clone
`~/Documents/club-arena` was on a lane's branch (`fix-nlh-logic-integration`),
274 commits behind `origin/main`, with 71,915 tracked files deleted in the
working tree and a stranded `.git/index.lock` from November 20. Its reflog
shows a lane checking out its own branch there on November 18. Every Mac agent
that loaded `CLAUDE.md` and skills from it read a broken tree.

The same day, two agents stashed in two worktrees of one clone at once and each
popped the other's changes. `refs/stash` lives in the common git directory, so
all worktrees share one stash list.

## What changed

1. `.husky/reference-transaction` refuses any new value of `refs/stash` in the
   `prepared` state. `git stash push` stores `refs/stash` before it resets the
   working tree, so the refusal leaves the edits in place (measured on git 2.43
   in the cloud container and Apple git 2.50.1 on the Mac). Removing an entry
   (pop or drop) still works, so an existing list can be drained. The refusal
   applies in every tree of the repository, since the list is common to all of
   them. A `rebase --autostash` that cannot re-apply its autostash will now
   die naming the stash commit id instead of storing it; that id is enough to
   recover the changes.
2. `scripts/dev-freshness-check.mjs` no longer advises `git stash`.
3. CLAUDE.md 10.87 gains rule 5 (no stash) and rule 6 (the shared clone stays
   on `main`).
4. `tests/unit/oneStashListIsNeverShared.test.ts` drives a real repository with
   a linked worktree: the defect reproduces without the hook; with it a stash
   push is refused in the worktree and in the main checkout with the tree
   untouched; popping an existing entry, committing, fast-forwarding `main` and
   `git worktree add` all still work.

## Why no checkout guard

The requested guard was a `reference-transaction` hook refusing a HEAD move off
`main` in the shared clone. Measured on Apple git 2.50.1 (the Mac's git): the
hook does see the HEAD symref update, but `git checkout` rewrites the working
tree and index first and updates HEAD last. Refusing it leaves the tree and
index on the target branch with HEAD still on `main`: the half-switched,
"everything staged" state CLAUDE.md 10.87 rule 1 already describes, and worse
than the checkout itself. Git 2.43 does not pass symref updates to the hook at
all. Git has no pre-checkout hook, and a `post-checkout` that switched back
would be a repair (10.12) that also rewrites the whole tree twice; the
post-checkout hook is retired by `tests/unit/resetGuardCannotSaveTheWorktree.test.ts`.
So the rule is written (10.87 rule 6) rather than enforced by a hook that would
do harm, and `guard-shared-clone.sh` keeps refusing commits and pushes there.

## How it reaches the Mac

`core.hooksPath` is `.husky` (relative), so each tree runs the hooks in its own
checkout. Every agent worktree created from `origin/main` after this merges
gets the refusal immediately. The shared clone gets it when it is next
fast-forwarded to `main`; nothing on the Mac was edited by hand.
