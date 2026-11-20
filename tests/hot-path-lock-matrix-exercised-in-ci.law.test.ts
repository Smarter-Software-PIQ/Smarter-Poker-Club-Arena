import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCRIPT = readFileSync(
  resolve(ROOT, 'scripts/ci/test-rebuy-never-pauses-the-tournament.py'),
  'utf8'
);
const WORKFLOW = readFileSync(
  resolve(ROOT, '.github/workflows/tournament-event-lane.yml'),
  'utf8'
);

const REQUIRED_HOT_PATH_PAIRS = [
  'move',
  'break_park',
  'bounty_rebuy',
  'addon',
  'elimination',
  'bounty_sweep',
  'entry_close',
];

describe('unified concurrent hot-path lock matrix is exercised in CI', () => {
  it('exercises hand commit against every tournament hot-path writer in the E4 lock matrix', () => {
    for (const pair of REQUIRED_HOT_PATH_PAIRS) {
      expect(SCRIPT, `missing e4_untouched_check for ${pair}`).toMatch(
        new RegExp(`e4_untouched_check\\(\\s*'${pair}'`)
      );
    }
  });

  it('enforces strict sibling-table hand-commit latency bounds against a held lock', () => {
    expect(SCRIPT).toContain('E4_MAX_SQL_MS = 50.0');
    expect(SCRIPT).toContain('E4_MAX_WALL_S = 0.15');
    expect(SCRIPT).toContain('sql_ms < E4_MAX_SQL_MS and dt < E4_MAX_WALL_S');
    expect(SCRIPT).toContain('HAND_SQL_MS=');
  });

  it('runs the unified lock-matrix proof in tournament-event-lane.yml', () => {
    expect(WORKFLOW).toContain('scripts/ci/test-rebuy-never-pauses-the-tournament.py');
    expect(WORKFLOW).toContain('tests/hot-path-lock-matrix-exercised-in-ci.law.test.ts');
  });
});
