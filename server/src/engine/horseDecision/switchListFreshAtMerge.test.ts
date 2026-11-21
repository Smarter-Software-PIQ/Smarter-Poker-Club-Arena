import { describe, expect, it } from 'vitest';
import { switchListStaleAtMerge, type GitRun } from './switchListFreshAtMerge.js';

const D = 'supabase/migrations';
const BASE = '20261121042010_horse_option_switch_plo_dark_train.sql';
const TRAIN = '20261121143225_horse_option_switch_plo_list_train.sql';
const LANE = '20261121070901_horse_option_switch_button_open_priced.sql';
/** A git that answers `git grep -l` per ref from these trees. */
const gitOf =
  (trees: Record<string, string[]>): GitRun =>
  (args) => {
    const ref = args[args.length - 3]!;
    const files = trees[ref];
    if (!files) throw new Error(`no ref ${ref}`);
    return files.map((f) => `${ref}:${D}/${f}`).join('\n') + '\n';
  };

describe('the switch list at merge time (AUDIT-B item 8: a branch green before main moved)', () => {
  it('a lane generated before the list train merged is refused against the main of the merge, though its own CI passed', () => {
    // its CI ran when main's newest was BASE: fresh then
    expect(
      switchListStaleAtMerge(gitOf({ lane: [BASE, LANE], 'origin/main': [BASE] }), 'lane')
    ).toBeNull();
    // the list train merged meanwhile: the same head is now stale and is refused
    const problem = switchListStaleAtMerge(
      gitOf({ lane: [BASE, LANE], 'origin/main': [BASE, TRAIN] }),
      'lane'
    );
    expect(problem).toMatch(/20261121143225_horse_option_switch_plo_list_train/);
  });
  it('a head regenerated after main newest, or adding no list, may merge', () => {
    const regenerated = '20261121190000_horse_option_switch_button_open_priced.sql';
    const main = [BASE, TRAIN];
    expect(
      switchListStaleAtMerge(gitOf({ lane: [...main, regenerated], 'origin/main': main }), 'lane')
    ).toBeNull();
    expect(switchListStaleAtMerge(gitOf({ lane: main, 'origin/main': main }), 'lane')).toBeNull();
  });
  it('a main with no list, or a git that fails, is never a pass', () => {
    expect(switchListStaleAtMerge(gitOf({ lane: [BASE], 'origin/main': [] }), 'lane')).toMatch(
      /UNKNOWN/
    );
    expect(() => switchListStaleAtMerge(gitOf({ lane: [BASE] }), 'lane')).toThrow();
  });
});
