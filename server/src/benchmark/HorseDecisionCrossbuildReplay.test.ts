/**
 * The cross-build Horse decision replay, end to end on THIS build (scripts/ops/horse-decision-crossbuild-replay.mjs;
 * method and limits in docs/ops/horse-flag-off-check.md). It runs the command line the way a lane does, each engine
 * step in its own `node --import tsx` process, on a tiny state set:
 *
 *   - a build replayed against itself gives 0 differences (the tool adds no noise of its own: seeds, clocks and
 *     opponent memory are pinned);
 *   - a deliberately changed option shows up as a difference, grouped by receipt;
 *   - the synthetic opponent history really reaches the decision (without it the same states decide differently),
 *     and replays with different history settings are refused as not comparable.
 *
 * The comparison and grouping logic is tested on fixtures in tests/unit/horseDecisionCrossbuildReplay.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SERVER = process.cwd();
const REPO = resolve(SERVER, '..');
const TOOL = join(REPO, 'scripts', 'ops', 'horse-decision-crossbuild-replay.mjs');
const LONG = 600_000;

let dir = '';
function tool(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [TOOL, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: LONG - 30_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const header = (name: string) =>
  JSON.parse(readFileSync(join(dir, name, 'replay-header.json'), 'utf8'));

describe('cross-build Horse decision replay on this build', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'horse-xbuild-'));
    // heads-up and short-handed PLO cash deal the 3-bet pots the seeded option acts in
    const cap = tool(
      'capture',
      '--build',
      REPO,
      '--out',
      join(dir, 'states'),
      '--scale',
      '0.1',
      '--groups',
      'plo4_cash_hu,plo5_cash_hu,plo5_cash_345,nlh_cash',
      '--jobs',
      '2'
    );
    expect(cap.out).toMatch(/captured \d+ states/);
    expect(cap.status).toBe(0);
    for (const [name, extra] of [
      ['a', []],
      ['b', []],
      ['nomem', ['--memory', 'off']],
      [
        'flipped',
        [
          '--variant',
          '+omahaPreflopReraiseDefencePricedInPosition=off',
          '--variant',
          '+omahaFacingBetEv=off',
          '--variant',
          '+omahaFlopFacingBetEv=off',
        ],
      ],
    ] as const) {
      const rep = tool(
        'replay',
        '--build',
        REPO,
        '--states',
        join(dir, 'states'),
        '--out',
        join(dir, name),
        '--jobs',
        '2',
        ...extra
      );
      expect(rep.out).toMatch(/replayed \d+ decisions/);
      expect(rep.status).toBe(0);
    }
  }, LONG);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('records the Node version, the commit and the options each replay ran', () => {
    const h = header('a');
    expect(h.schema).toBe('horse-crossbuild-replay/v1');
    expect(h.node).toBe(process.version);
    expect(h.build.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(h.options.source.schema).toBe('horse-option-switch-state/v1');
    expect(h.options.received.omahaPreflopReraiseDefencePricedInPosition).toBe(true);
    expect(h.errors).toBe(0);
    expect(h.decisions).toBe(h.stateSet.states * 2);
    expect(h.decisions).toBeGreaterThan(500);
    // one state in four carried a synthetic opponent history, and this build could seed every one
    expect(h.memoryStatus.seeded).toBeGreaterThan(h.decisions / 5);
    expect(h.memoryStatus.error + h.memoryStatus.unavailable).toBe(0);
    expect(h.missingParts).toEqual([]);
  });

  it('gives 0 differences when a build is replayed against itself', () => {
    const d = tool('diff', '--head', join(dir, 'a'), '--base', join(dir, 'b'));
    expect(d.out.split('\n')[0]).toMatch(/^0 differences \(\d+ decisions compared/);
    expect(d.status).toBe(0);
  });

  it('shows a deliberately changed option as differences grouped by receipt, exit 1', () => {
    const d = tool(
      'diff',
      '--head',
      join(dir, 'a'),
      '--base',
      join(dir, 'flipped'),
      '--json',
      join(dir, 'diff.json')
    );
    expect(d.status).toBe(1);
    expect(d.out.split('\n')[0]).toMatch(/^[1-9]\d* differences in \d+ decisions compared/);
    expect(d.out).toContain('NOTE: the two replays were given different option rows');
    expect(d.out).toContain('Differing decisions grouped by receipt');
    const json = JSON.parse(readFileSync(join(dir, 'diff.json'), 'utf8'));
    expect(json.differences).toBeGreaterThan(0);
    expect(json.byReceipt.length).toBeGreaterThan(0);
    expect(json.byReceipt[0].decisions).toBeGreaterThanOrEqual(
      json.byReceipt[json.byReceipt.length - 1].decisions
    );
    expect(header('flipped').options.received.omahaFacingBetEv).toBe(false);
  });

  it('refuses to compare replays whose opponent-history setting differs, and the history does reach the decision', () => {
    const d = tool(
      'diff',
      '--head',
      join(dir, 'a'),
      '--base',
      join(dir, 'nomem'),
      '--json',
      join(dir, 'mem.json')
    );
    expect(d.status).toBe(2);
    expect(d.out).toContain('NOT COMPARABLE');
    const json = JSON.parse(readFileSync(join(dir, 'mem.json'), 'utf8'));
    expect(json.refused).toBe(true);
    // every difference sits on a state that carried the history; states without it are identical
    expect(json.differences).toBeGreaterThan(0);
    for (const e of json.examples) expect(e.tags).toContain('opponent_memory');
  });

  it('refuses a row variant the build does not turn into the asked value', () => {
    const r = tool(
      'replay',
      '--build',
      REPO,
      '--states',
      join(dir, 'states'),
      '--out',
      join(dir, 'unknown'),
      '--variant',
      '+noSuchHorseOptionForThisTest=on'
    );
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/does not apply the asked variant|INVALID on this build/);
  });
});
