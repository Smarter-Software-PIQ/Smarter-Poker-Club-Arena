/**
 * A LOWERCASE CLONE URL IS THE SAME REPOSITORY (2026-11-21).
 *
 * GitHub repository names are case-insensitive. A cloud session cloned
 * https://github.com/Smarter-Software-PIQ/smarter-poker-club-arena, and every
 * push from it was refused by scripts/guard-merged-branch.sh with "GitHub did
 * not identify the trusted destination repository": the trust check compares
 * exact approved names. The guard now canonicalizes the one known name before
 * asking GitHub; the immutable repository ID is still required.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARD = resolve(__dirname, '../../scripts/guard-merged-branch.sh');

function runGuard(url: string, nameWithOwner: string, id: number) {
  const box = mkdtempSync(join(tmpdir(), 'guard-case-'));
  try {
    const doc = JSON.stringify({
      data: {
        repository: {
          databaseId: id,
          nameWithOwner,
          owner: { login: nameWithOwner.split('/')[0] },
          pullRequests: { nodes: [] },
        },
      },
    });
    writeFileSync(
      join(box, 'gh'),
      `#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in repo=*) echo "$a" >> "${box}/asked";; esac; done\necho '${doc}'\n`
    );
    chmodSync(join(box, 'gh'), 0o755);
    const run = spawnSync('bash', [GUARD, 'fix/some-branch', 'origin', url], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${box}:${process.env.PATH}` },
    });
    let asked = '';
    try {
      asked = readFileSync(join(box, 'asked'), 'utf8');
    } catch {
      asked = '';
    }
    return { ...run, asked };
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
}

describe('the merged-branch guard reads the repository name case-insensitively', () => {
  it('admits a push from a lowercase clone URL of the right repository', () => {
    const r = runGuard(
      'https://github.com/Smarter-Software-PIQ/smarter-poker-club-arena',
      'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
      1132369872
    );
    expect(r.stderr).not.toContain('did not identify the trusted destination');
    expect(r.status, r.stderr).toBe(0);
    expect(r.asked).toContain('repo=Smarter-Poker-Club-Arena');
  });

  it('still refuses a repository whose immutable ID is not Club Arena', () => {
    const r = runGuard(
      'https://github.com/Smarter-Software-PIQ/smarter-poker-club-arena',
      'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
      42
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('did not identify the trusted destination');
  });
});
