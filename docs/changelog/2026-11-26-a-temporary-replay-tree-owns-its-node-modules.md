# A Temporary Replay Tree Owns Its node_modules (2026-11-26)

Reported by the Horse SWITCH lane's sweep (inbox 2026-11-26 3:59 PM CST), which found and fixed the same defect in its own records tool.

## What Was Wrong

`scripts/ops/horse-decision-crossbuild-replay.mjs` (bisect) and `scripts/ops/horse-flag-off-check.sh` linked an installed `server/node_modules` into each throwaway worktree with a symlink.

## Why It Broke

npm writes through a symlink. One `npm ci` inside a throwaway tree deletes the linked folder's contents, which empties the installed source for every tree sharing it. That is how a shared `node_modules` was emptied on the Mac earlier this week, and `scripts/agent-workspace.sh` forbids linked `node_modules` for that reason.

## The Change

Each throwaway tree gets its own `server/node_modules`: a copy-on-write clone (`cp -Rc`, no extra disk on APFS), else a plain copy. The help text and the "no tsx" message now say to clone, not link.

## Hardening

`tests/unit/horseDecisionCrossbuildReplay.test.ts`: neither tool may contain `symlinkSync` or a `ln -s` line, and both must clone with `cp -Rc`. Fails on the old code.
