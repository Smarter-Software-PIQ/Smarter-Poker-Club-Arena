import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// 2026-11-06 04:02 Chicago, run 42190145714-1: a6a4dd17 sealed, a post-commit
// step failed, and exact desired recovery raised "retirement source file is
// unsafe" because <run>.request is published as a hard link of <run>.intent
// (nlink 2). The run parked failed while it owned finalization and its routine
// cycle, so every later release refused "a prior routine cycle owner remains
// unresolved".
const supervisor = readFileSync('server/scripts/engine-supervisor.sh', 'utf8');
const transaction = readFileSync('server/scripts/engine-release-transaction.sh', 'utf8');
const seal = readFileSync('server/scripts/engine-release-seal.py', 'utf8');

describe('a linked release request is its own witness', () => {
  it('accepts exactly the sibling intent link and nothing else', () => {
    expect(supervisor).toContain('def sibling_intent_link(path, s):');
    expect(supervisor).toContain('(i.st_dev, i.st_ino) == (s.st_dev, s.st_ino)');
    expect(supervisor).toContain('i.st_nlink == 2 and s.st_nlink == 2');
    expect(supervisor).not.toContain('s.st_nlink != 1 or s.st_size > 131072');
  });

  it('restarts a parked committed owner before any owner check, and never finalizes for it', () => {
    const restart = transaction.indexOf('restart-parked-committed-owner --engine-lock-fd 9');
    const resolveFailed = transaction.indexOf('resolve-failed-routine --engine-lock-fd 9');
    const ownerCheck = transaction.indexOf('check-routine-owner --run-id "$RUN_ID" >/dev/null');
    expect(restart).toBeGreaterThan(
      transaction.indexOf("acquire_engine_lock 'duplicate certification'")
    );
    expect(restart).toBeLessThan(resolveFailed);
    expect(resolveFailed).toBeLessThan(ownerCheck);
    const body = seal.slice(
      seal.indexOf('def cmd_restart_parked_committed_owner'),
      seal.indexOf('def cmd_check_routine_owner')
    );
    expect(body).not.toMatch(/write_state|record_result|state\[["']finalization["']\]\s*=/);
  });

  it('reads the production nlink 2 request and refuses foreign links', () => {
    const result = spawnSync(
      'python3',
      [
        'tests/operations/certified-incarnation-recovery.py',
        '-k',
        'its_intent_link',
        '-k',
        'linked_request',
        '-k',
        'foreign_or_extra_request_links',
      ],
      {
        encoding: 'utf8',
        timeout: 60_000,
      }
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 3 tests');
  }, 65_000);

  it('gives only a parked committed owner its identical request on its own inode', () => {
    const result = spawnSync('python3', ['tests/operations/parked-committed-owner.py'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 6 tests');
  }, 35_000);
});
