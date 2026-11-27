# Unused Client Code Leaves src/, And The Root Checkpoints Move To The Archive

Date: 2026-11-27 (Chicago). Lane: club-arena-client. Code review finding 12 (repository weight).

## What Was Wrong

- Nine files under `src/` (1,440 lines) were imported by nothing: not by the app's entries (`index.html` -> `src/main.tsx`, `diamond-test.html`, the prerender entry, the Rabbit Hunt harness), not by any test, script or server file, and named by path by nothing but docs. Three of them were the index barrels of `src/lib`, `src/stores` and `src/types`; `src/lib/api.ts` and `src/lib/validation.ts` were reachable only through the dead `src/lib` barrel; `src/core/AntiGravityBoot.tsx` was shadowed by `src/core/AntiGravityBoot.ts`, which every `./core/AntiGravityBoot` import resolves to first (Vite and TypeScript both try `.ts` before `.tsx`); `src/components/feedback/` held only a barrel and the `RatingModal` it re-exported.
- `tests/every-file-under-src-is-reachable.law.test.ts` did not see the barrels. It took every `src/...` string in `vite.config.ts` as an entry, including the alias targets `./src/lib`, `./src/stores`, `./src/types`, `./src/services` and `./src/hooks`, and resolved each directory to its index barrel. That rooted the barrels and everything they re-exported.
- 84 `CHECKPOINT*.md` lane checkpoints sat at the repository root. No test, script or workflow read any of them.

## The Fix

- The nine files are deleted (list and line counts in the pull request).
- The reachability law treats a path named in `vite.config.ts` as an entry only when it is a file, and a new case fails if a directory alias roots its barrel. With the hole closed, `src/services/index.ts` and four services that only their own unit tests import (`POYService`, `PermissionService`, `PresenceService`, `PushNotificationService`) are listed in RETAINED with those readers, so a later change can delete each together with its tests.
- The 84 checkpoints moved with `git mv` to `docs/archive/checkpoints/`, history intact. Changelogs and handoffs that say a result is "recorded in CHECKPOINT-<lane>.md" now mean `docs/archive/checkpoints/CHECKPOINT-<lane>.md`.

## What Stops It Returning

- `tests/no-checkpoint-file-sits-at-the-repository-root.law.test.ts` refuses any tracked root file named `CHECKPOINT*` and checks the archive still holds the moved set.
- `tests/every-file-under-src-is-reachable.law.test.ts` (existing) fails on any new unreachable file under `src/`; its new alias-directory case keeps barrels from hiding dead code again.

## Not Changed Here

`docs/evidence/` (33,289 files, 278 MB) stays where it is: Horse server code, Horse strength-league workflows, CI classification and several client and server law tests read paths under it, some by enumerating directories.
