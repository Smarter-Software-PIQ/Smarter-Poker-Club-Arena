/**
 *  LAW: AN EMPTY STUDY IS STILL REPORTED
 *
 *  The self-tuner's study can legitimately come back empty. What it must never
 *  do is come back empty in silence.
 *
 *  WHAT THAT COST, measured 2026-09-29. runSelfTune ended a study of zero
 *  horses with a bare `return { studied: 0, tuned: 0 }`. That path writes no
 *  roster into horse_tuner_study_rosters, no receipts into
 *  horse_tuner_write_receipts, no row into horse_tuner_study_completions and
 *  no row into horse_self_tune_log - byte-for-byte indistinguishable from a
 *  run that never happened.
 *
 *  horse_job_runs shows the self_tuner job claiming itself on 2026-09-26,
 *  2026-09-27 and 2026-09-28. All four artifact tables are empty for all three
 *  dates. Nothing alerted, because returning early is not an error. The outage
 *  was found four days later, by hand, by noticing that horse_self_tune_log
 *  stopped after 2026-09-25 while the fleet was otherwise healthy - 682 horses
 *  and 2,321,214 hands went unstudied.
 *
 *  The cause then was offset paging over a study window whose hand volume had
 *  quadrupled, against a table that had never been analyzed. That is fixed and
 *  the tuner has since run 50 days out of 50 (2026-09-29..2026-11-17, zero
 *  dark days). This law does not guard that cause. It guards the reason three
 *  dark days took four days to notice: the branch had no voice.
 *
 *  THE RULE. The zero-horse branch of runSelfTune reports before it returns.
 *  The call costs nothing on the days the study is legitimately empty, and it
 *  is the only thing standing between a broken study stream and another four
 *  silent days.
 *
 *  The window is sliced structurally, from a needle inside the branch, so a
 *  refactor that moves the code keeps the law pointed at the right block
 *  instead of at a line number that has drifted - this branch has already
 *  moved from line 1066 to 1229 since the law was written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blankNonCode, sliceEnclosingBlock } from '../testHelpers/sourceWindow.js';

const SRC = readFileSync(join(__dirname, 'HorseSelfTuner.ts'), 'utf8');

describe('an empty study is still reported', () => {
  // Sliced from a needle INSIDE the branch, not from the `if` condition: the
  // condition sits outside the block's brace, so slicing from it returns the
  // whole enclosing function and the law would be reading its neighbours.
  const branch = sliceEnclosingBlock(SRC, 'HorseSelfTuner.noStats');

  it('the zero-horse branch reports before it returns', () => {
    expect(branch).toMatch(/reportError\(/);
    expect(branch).toMatch(/return\s*\{\s*studied:\s*0,\s*tuned:\s*0\s*\}/);
    // and the branch reached is genuinely the zero-horse one
    expect(blankNonCode(SRC)).toMatch(/if\s*\(stats\.size === 0\)\s*\{/);
  });

  it('it is a report, not a throw: an empty study must not abort the tick', () => {
    expect(branch).not.toMatch(/\bthrow\b/);
  });

  it('the report carries the date, so a silent day can be named afterwards', () => {
    expect(branch).toContain('date');
  });

  it('the context string is unique, so the report can be grepped for', () => {
    // Counted on the raw source: blankNonCode erases string literals along
    // with comments, and the context string is a literal.
    const hits = SRC.split('HorseSelfTuner.noStats').length - 1;
    expect(hits).toBe(1);
  });

  it('the negative control: a bare early return would leave no trace', () => {
    // If the branch is reduced back to `if (stats.size === 0) return ...;`
    // there is no block to report from. Pin that the guard is a block.
    expect(blankNonCode(SRC)).not.toMatch(/if\s*\(stats\.size === 0\)\s*return/);
  });
});
