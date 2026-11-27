import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LAW: THE OPPONENT-MEMORY REGRESSION TYPE-CHECKS ITS OWN TEST, NEVER ALL OF SERVER/SRC (2026-11-27).
 *
 * All of server/src is about 4.4 GB of type program (4,697 files, tsc --extendedDiagnostics, 2026-11-27), past Node's
 * default heap on the CI runner. The opponent-memory regression (Accounting shard 2/7) type-checked it through
 * tsconfig.opponent-memory.json (`include: src/**`) and aborted "JavaScript heap out of memory" on every pull request
 * on 2026-11-27, blocking every merge. It now includes only its regression test, so tsc checks that test and what it
 * imports (1,280 files, about 1.2 GB); the whole program is checked once, by the Server Engine type check. The
 * accounting step text itself is pinned by scripts/qualification/ci-accounting-inputs.json and is unchanged.
 */
const root = resolve(__dirname, '../..');
const cfg = JSON.parse(
  readFileSync(resolve(root, 'server/tsconfig.opponent-memory.json'), 'utf8')
) as {
  include?: string[];
};

describe('LAW: the opponent-memory regression type-checks its own test, never all of server/src', () => {
  it('includes its regression test', () => {
    expect(cfg.include ?? []).toContain('tests/HorseOpponentMemory.postgres.test.ts');
  });
  it('includes no src glob (the whole program is the Server Engine type check)', () => {
    expect((cfg.include ?? []).filter((g) => /^src\b|\*\*/.test(g))).toEqual([]);
  });
});
