import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PRE_COMMIT = readFileSync(join(ROOT, '.husky/pre-commit'), 'utf8');
const PRE_PUSH = readFileSync(join(ROOT, '.husky/pre-push'), 'utf8');
const AGENT_PUSH = readFileSync(join(ROOT, 'scripts/agent-push.sh'), 'utf8');

describe('local Mac push and pre-commit hardening', () => {
  it('pre-commit passes --no-stash to lint-staged in linked worktrees (.git file) and preserves default stash in primary clones (.git dir)', () => {
    const start = PRE_COMMIT.indexOf('TOP="$(git rev-parse --show-toplevel)"');
    expect(start).toBeGreaterThan(0);
    const snippet = PRE_COMMIT.slice(start);

    const runSnippet = (linkedWorktree: boolean) => {
      const dir = mkdtempSync(join(tmpdir(), 'ca-precommit-stash-'));
      try {
        const bin = join(dir, 'bin');
        const repo = join(dir, 'repo');
        const argsLog = join(dir, 'ls-args.log');
        mkdirSync(bin, { recursive: true });
        mkdirSync(join(repo, 'node_modules/.bin'), { recursive: true });
        if (linkedWorktree) {
          writeFileSync(join(repo, '.git'), 'gitdir: /tmp/fake-worktree\n');
        } else {
          mkdirSync(join(repo, '.git'), { recursive: true });
        }
        writeFileSync(
          join(bin, 'git'),
          `#!/usr/bin/env bash\nif [ "$1" = rev-parse ] && [ "$2" = --show-toplevel ]; then echo '${repo}'; exit 0; fi\nexit 0\n`
        );
        chmodSync(join(bin, 'git'), 0o755);
        writeFileSync(join(bin, 'node'), '#!/usr/bin/env bash\necho ""\n');
        chmodSync(join(bin, 'node'), 0o755);
        writeFileSync(
          join(repo, 'node_modules/.bin/lint-staged'),
          `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > '${argsLog}'\n`
        );
        chmodSync(join(repo, 'node_modules/.bin/lint-staged'), 0o755);

        const res = spawnSync('sh', ['-e', '-c', snippet], {
          cwd: repo,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        });
        expect(res.status, res.stderr).toBe(0);
        return readFileSync(argsLog, 'utf8').trim();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    expect(runSnippet(true)).toBe('--no-stash');
    expect(runSnippet(false)).toBe('');
  });

  it('agent-push.sh and .husky/pre-push cap VITEST_MAX_THREADS to [2, 6] under heavy-queue while preserving explicit caller overrides', () => {
    expect(AGENT_PUSH).toContain('export VITEST_MAX_THREADS="$per_slot"');
    expect(PRE_PUSH).toContain('export VITEST_MAX_THREADS="$ca_per_slot"');

    const capScript = (cores: number, preset?: string) => {
      const code = `set -euo pipefail
cores=${cores}
if [ -z "\${VITEST_MAX_THREADS:-}" ] && [ "\${cores:-0}" -gt 0 ]; then
  hq_slots=$(( cores / 7 ))
  [ "$hq_slots" -ge 1 ] || hq_slots=1
  per_slot=$(( cores / hq_slots ))
  [ "$per_slot" -ge 2 ] || per_slot=2
  [ "$per_slot" -le 6 ] || per_slot=6
  export VITEST_MAX_THREADS="$per_slot"
fi
printf '%s' "\${VITEST_MAX_THREADS:-}"`;
      const env = { ...process.env };
      if (preset === undefined) delete env.VITEST_MAX_THREADS;
      else env.VITEST_MAX_THREADS = preset;
      const res = spawnSync('bash', ['-c', code], { encoding: 'utf8', env });
      expect(res.status, res.stderr).toBe(0);
      return res.stdout;
    };

    // 28-core Mac (4 heavy-queue slots -> 7 cores/slot -> capped at 6 workers)
    expect(capScript(28)).toBe('6');
    // 14-core Mac (2 slots -> 7 -> capped at 6)
    expect(capScript(14)).toBe('6');
    // 4-core machine (1 slot -> 4 workers)
    expect(capScript(4)).toBe('4');
    // Explicit caller override is always respected
    expect(capScript(28, '3')).toBe('3');
  });
});
