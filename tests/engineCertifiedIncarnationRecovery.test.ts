import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const supervisor = readFileSync('server/scripts/engine-supervisor.sh', 'utf8');
const recovery = readFileSync('server/scripts/engine-release-recover.sh', 'utf8');
const up = readFileSync('server/scripts/engine-up.sh', 'utf8');

describe('certified original incarnation recovery', () => {
  it('threads the exact owning run into recovery and rechecks at the canonical stop', () => {
    expect(recovery).toContain('ENGINE_CHECKPOINT_RECOVERY_RUN_ID="$RUN_ID"');
    expect(supervisor).toContain('ENGINE_UP_CERTIFIED_RETIREMENT="${CERTIFIED_RETIREMENT_JSON:-}"');
    expect(up).toContain('docker stop -t 45 "$CERTIFIED_OUTGOING_ID"');
  });

  it('reconstructs only proven retired custody and preserves unknown or newer incarnations', () => {
    const result = spawnSync('python3', ['tests/operations/certified-incarnation-recovery.py'], {
      encoding: 'utf8',
      timeout: 115_000,
    });
    expect(result.error, result.stdout + result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 17 tests');
  }, 120_000);
});
