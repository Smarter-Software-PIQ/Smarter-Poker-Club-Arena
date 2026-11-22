# 2026-11-21 — the Horse hole-card privacy law searches the repository once, from the index

`tests/horse-dealt-hole-cards-stay-private.law.test.ts` proves that only the
files that write, prove or declare the Horse dealt-hole-card table name it, and
that only one server file reads the payload key that carries the cards. It found
those files with one working-tree `git grep -l -F <name> -- .` per name. A
working-tree grep opens every one of the ~80,000 tracked files, so with the Mac
at load 25-40 a single pass took ~46 s and the law failed on vitest's 30 s
timeout, not on its content — in every release gate that ran it.

What changed (the law itself did not):

- One `git grep --cached -o -F -e <name> -e <name> -- .` pass finds both names
  at once and tells them apart by the match it prints. `--cached` reads the
  index's blobs from the object store instead of opening each working file.
- The files whose working copy differs from the index (`git diff --name-only`:
  edited but not staged, or deleted) are read from disk instead of the index,
  so an unstaged edit counts exactly as it did before.
- The scope is still the whole repository (docs, public assets, workflows,
  native shells included); no directory was excluded.

Measured on the Mac Studio in one heavy-queue slot, same load window: see the
lane report `hd-01Gw7aDs/priv-speed/REPORT.md`. A planted name in a tracked file
under each top-level root (unstaged and staged), a planted reader in `server/src`,
and a name removed from the allowed server file in the working tree each still
fail the law.
