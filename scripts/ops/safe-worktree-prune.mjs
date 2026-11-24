#!/usr/bin/env node
// SAFE WORKTREE PRUNE: `git worktree prune` that never deletes the registration of a tree on an unmounted drive.
//
//   node scripts/ops/safe-worktree-prune.mjs [--repo <clone or worktree>] [--dry-run]
//
// A bare `git worktree prune` deletes the registration of every worktree whose folder is absent. A worktree
// on an unmounted drive is absent in exactly that way, so one prune during a drive drop strands every tree
// on that drive (2026-11-22: hs-river, hs-onepair and hs-relguard on SSD1). git never prunes a locked
// worktree, so this takes a git worktree lock on each registration whose drive is not mounted, prunes, and
// unlocks exactly the ones it locked. If any of those locks cannot be taken, nothing is pruned.
// Exit 0: pruned (or dry run). Exit 1: git could not be run, or a protecting lock was refused.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseWorktreePorcelain, worktreePruneDecision } from './drive-loss-lib.mjs';
import { fsDriveProbe } from './fs-drive-probe.mjs';

export const PROTECT_REASON = 'drive not mounted (held by safe-worktree-prune for one prune)';

export function runSafePrune(argv, deps) {
  let repo = process.cwd();
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') repo = argv[(i += 1)];
    else if (argv[i] === '--dry-run') dryRun = true;
    else throw new Error(`unknown argument "${argv[i]}"`);
  }
  const say = (s) => deps.stdout(`[safe-worktree-prune] ${s}`);
  const listed = deps.git(repo, ['worktree', 'list', '--porcelain']);
  if (listed.status !== 0) {
    deps.stderr(`[safe-worktree-prune] git worktree list failed in ${repo}: ${listed.stderr}`);
    return 1;
  }
  const decision = worktreePruneDecision(parseWorktreePorcelain(listed.stdout), deps.probe);
  for (const p of decision.missingDrive) say(`KEPT (drive not mounted)  ${p}`);
  if (dryRun) {
    say(
      `dry run: would prune ${decision.gone.length} registration(s), keep ${decision.missingDrive.length} on unmounted drives`
    );
    return 0;
  }
  const held = [];
  let rc = 0;
  try {
    for (const p of decision.protect) {
      const locked = deps.git(repo, ['worktree', 'lock', '--reason', PROTECT_REASON, p]);
      if (locked.status !== 0) {
        deps.stderr(
          `[safe-worktree-prune] REFUSED: could not protect ${p} (${String(locked.stderr).trim()}). Nothing was pruned.`
        );
        return 1;
      }
      held.push(p);
    }
    const pruned = deps.git(repo, ['worktree', 'prune']);
    if (pruned.status !== 0) {
      deps.stderr(`[safe-worktree-prune] git worktree prune failed: ${pruned.stderr}`);
      rc = 1;
    } else {
      say(
        `pruned ${decision.gone.length} registration(s) whose folder is gone; kept ${decision.missingDrive.length} on unmounted drives`
      );
    }
  } finally {
    for (const p of held) {
      const unlocked = deps.git(repo, ['worktree', 'unlock', p]);
      if (unlocked.status !== 0) {
        deps.stderr(
          `[safe-worktree-prune] could not unlock ${p}; run: git -C ${repo} worktree unlock "${p}"`
        );
        rc = 1;
      }
    }
  }
  return rc;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    process.exitCode = runSafePrune(process.argv.slice(2), {
      git: (repo, args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }),
      probe: fsDriveProbe(),
      stdout: (s) => console.log(s),
      stderr: (s) => console.error(s),
    });
  } catch (err) {
    console.error(`[safe-worktree-prune] ${err.message}`);
    process.exitCode = 1;
  }
}
