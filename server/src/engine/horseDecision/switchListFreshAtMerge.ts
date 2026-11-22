/**
 * THE SWITCH LIST AT MERGE TIME (EMERG lane RULES-FIX-1 2026-11-21, AUDIT-B item 8).
 *
 * aSwitchListIsNeverStale.law.test.ts refuses, in pull request CI, a branch whose switch list migration is older than
 * or lacks origin/main's newest. That CI ran against the origin/main of its own run: the ruleset's required checks are
 * not strict and no merge queue is required, so a branch whose CI went green before another list migration merged can
 * still be merged stale. This is the same check against the origin/main of the moment of the merge: the merger runs
 * `npx tsx scripts/switch-list-fresh-at-merge.ts <head sha>` immediately before every squash merge, and merges only on
 * exit 0. Nothing here writes; it reads two trees.
 */
import {
  OPTION_SWITCH_LIST_MARKER,
  OPTION_SWITCH_MIGRATIONS_DIR,
  optionSwitchStaleAgainstMain,
} from '../HorseOptionSwitchMigrationLists.js';

/** Runs git with these arguments and returns stdout; throws when git fails. */
export type GitRun = (args: readonly string[]) => string;

/** The switch list migrations (file names) the tree at `ref` holds. */
export function switchListsAt(git: GitRun, ref: string): string[] {
  let out = '';
  try {
    out = git([
      'grep',
      '-l',
      '-F',
      '-e',
      OPTION_SWITCH_LIST_MARKER,
      ref,
      '--',
      `${OPTION_SWITCH_MIGRATIONS_DIR}/`,
    ]);
  } catch (error) {
    // git grep exits 1 when nothing matches; every tree holds the base list migration, so that is not an answer
    throw new Error(`could not read the switch list migrations of ${ref}: ${String(error)}`);
  }
  return out
    .split('\n')
    .filter((l) => l.endsWith('.sql'))
    .map((l) => l.replace(/^.*\//, ''));
}

/** Null when `head` may merge onto `main` as far as the switch list goes; otherwise what is wrong and the remedy. */
export function switchListStaleAtMerge(
  git: GitRun,
  head: string,
  main = 'origin/main'
): string | null {
  const mainLists = switchListsAt(git, main);
  if (mainLists.length === 0)
    return `UNKNOWN: ${main} holds no switch list migration; refusing to judge`;
  return optionSwitchStaleAgainstMain(switchListsAt(git, head), mainLists);
}
