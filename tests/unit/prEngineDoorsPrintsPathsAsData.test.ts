/**
 * pr-engine-doors runs main's script under pull_request_target with a database
 * credential and prints the pull request's function names and file paths into
 * workflow command lines. A path is attacker-chosen, so it must never carry a
 * newline, '::' or a '%' escape onto the runner's command parser.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import { show } from '../../scripts/ci/check-pr-engine-doors.mjs';

describe('pr-engine-doors prints pull-request paths as data', () => {
  it('reduces any value to a plain identifier and path alphabet', () => {
    expect(show('server/src/a.ts')).toBe('server/src/a.ts');
    expect(show('a\n::error title=x::y%0A')).toBe('a???error?title?x??y?0A');
    expect(show('x'.repeat(500)).length).toBe(200);
  });

  it('a hostile file name cannot start a workflow command', () => {
    const root = mkdtempSync(join(tmpdir(), 'pr-doors-'));
    const dir = join(root, 'server', 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'evil\n::error title=forged::pwned%0A::add-mask::x.ts'),
      "export const f = (c: any) => c.rpc('fn_pr_doors_hostile_path_probe');\n"
    );
    mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
    const live = join(root, 'live.json');
    writeFileSync(live, '[]');
    const result = spawnSync(process.execPath, ['scripts/ci/check-pr-engine-doors.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PR_DOORS_ROOT: root,
        PR_DOORS_BASE_ROOT: root,
        PR_DOORS_LIVE_FIXTURE: live,
        GITHUB_OUTPUT: '',
      },
      encoding: 'utf8',
    });
    const lines = result.stdout.split('\n');
    expect(lines.some((l) => l.includes('fn_pr_doors_hostile_path_probe'))).toBe(true);
    for (const line of lines) {
      expect(line).not.toMatch(
        /^::(?!error title=MISSING DATABASE DOOR::|warning title=|notice title=)/
      );
      expect(line).not.toContain('pwned%0A');
      expect(line.startsWith('::error title=forged')).toBe(false);
    }
  });
});
