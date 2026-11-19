import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildReleaseFailureAlert } from '../scripts/ci/record-engine-release-alert.mjs';

/**
 * Incident 075013fd (Lane 1 — Engine Release Pipeline Hardening):
 *   - Candidate container exit is detected immediately inside the local-health
 *     wait loop with its last log lines instead of spinning until timeout.
 *   - Single-use owner window claim belonging to another run is refused
 *     immediately instead of looping `unavailable` until floor expiry.
 *   - Every failed engine release raises a durable `EngineReleaseFailed` alert.
 *   - Unrelated pushes never cancel a pending Backup Engine certification.
 */
const ROOT = process.cwd();
const TRANSACTION = readFileSync(
  join(ROOT, 'server/scripts/engine-release-transaction.sh'),
  'utf8'
);
const SEAL = readFileSync(join(ROOT, 'server/scripts/engine-release-seal.py'), 'utf8');
const DEPLOY_WF = readFileSync(join(ROOT, '.github/workflows/auto-deploy-hetzner.yml'), 'utf8');
const BACKUP_WF_TEXT = readFileSync(join(ROOT, '.github/workflows/backup-engine.yml'), 'utf8');
const BACKUP_WF = parse(BACKUP_WF_TEXT);

describe('incident 075013fd lane 1 — engine release pipeline hardening', () => {
  it('detects an exited candidate container immediately in the local-health loop and emits tail logs', () => {
    const fnStart = TRANSACTION.indexOf('assert_candidate_container_alive() {');
    const loopStart = TRANSACTION.indexOf('for attempt in $(seq 1 180); do', fnStart);
    const loopEnd = TRANSACTION.indexOf('\ndone', loopStart);
    expect(fnStart).toBeGreaterThan(0);
    expect(loopStart).toBeGreaterThan(fnStart);
    const loopBody = TRANSACTION.slice(loopStart, loopEnd);
    expect(loopBody).toContain('assert_candidate_container_alive');

    // Execute assert_candidate_container_alive in a real bash subshell with a mocked exited container.
    const fnBody = TRANSACTION.slice(fnStart, loopStart);
    const script = `set -euo pipefail
CONTAINER=club-arena-engine
CANDIDATE_CID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
CANDIDATE_STARTED_AT=2026-11-19T12:00:00Z
die() { echo "DIE:$*" >&2; exit 42; }
bounded_break_command() { shift; "$@"; }
docker() {
  if [ "$1" = container ] && [ "$2" = inspect ]; then
    echo "exited 1 false 0 $CANDIDATE_CID $CANDIDATE_STARTED_AT"
    return 0
  fi
  if [ "$1" = logs ]; then
    printf 'boot line 1\\nSyntaxError: bad config on boot\\n'
    return 0
  fi
  return 1
}
${fnBody}
assert_candidate_container_alive
`;
    const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(res.status).toBe(42);
    expect(res.stderr).toContain(
      'candidate container last logs (status=exited exit=1 oom=false restarts=0)'
    );
    expect(res.stderr).toContain('SyntaxError: bad config on boot');
    expect(res.stderr).toContain(
      'DIE:candidate container exited before serving local release health (status=exited exit_code=1 oom=false restarts=0; last_log=SyntaxError: bad config on boot)'
    );
  });

  it('refuses immediately when a single-use owner window claim belongs to another run', () => {
    expect(SEAL).toContain("print(f'owner-claim-consumed:{owner_run}')");
    expect(TRANSACTION).toContain('if [[ "$stamp" == owner-claim-consumed:* ]]; then');
    expect(TRANSACTION).toContain(
      'die "single-use owner window claim already belongs to run ${stamp#owner-claim-consumed:}; refusing duplicate attempt $RUN_ID"'
    );
  });

  it('raises a durable EngineReleaseFailed alert for every failed release and skips clean shipped/superseded runs', () => {
    expect(DEPLOY_WF).toContain('name: Raise durable alert on failed release');
    expect(DEPLOY_WF).toContain('node scripts/ci/record-engine-release-alert.mjs');
    expect(DEPLOY_WF).toContain(
      "if: always() && needs.deploy.outputs.shipped != 'true' && needs.deploy.outputs.release_result != 'superseded'"
    );

    expect(
      buildReleaseFailureAlert({ SHIPPED: 'true', RELEASE_RESULT: 'sealed', RUN_ID: '1-1' })
    ).toBeNull();
    expect(
      buildReleaseFailureAlert({ SHIPPED: 'false', RELEASE_RESULT: 'superseded', RUN_ID: '1-2' })
    ).toBeNull();

    const failed = buildReleaseFailureAlert({
      SHIPPED: 'false',
      RELEASE_RESULT: 'not completed',
      VERIFIED: 'false',
      TARGET_SHA: 'abcdef0123456789abcdef0123456789abcdef01',
      RUN_ID: '999-1',
      EXIT_STAGE: 'release',
      EXIT_OUTCOME: 'failure',
      EXIT_ERROR: 'candidate container exited before serving local release health',
      REASON: 'the durable Hetzner release step failed at stage release',
    });
    expect(failed).not.toBeNull();
    expect(failed!.status).toBe('firing');
    expect(failed!.fingerprint).toBe('engine-release-failed:999-1');
    expect(failed!.labels.alertname).toBe('EngineReleaseFailed');
    expect(failed!.labels.severity).toBe('critical');
    expect(failed!.annotations.description).toContain('candidate container exited');
  });

  it('hardens backup-engine.yml so unrelated pushes never cancel a pending certification', () => {
    expect(BACKUP_WF.concurrency['cancel-in-progress']).toBe(false);
    expect(BACKUP_WF.concurrency).not.toHaveProperty('queue');
    expect(BACKUP_WF.concurrency.group).toContain('github.run_id');
    expect(BACKUP_WF.concurrency.group).not.toContain("|| 'backup-engine'");
    expect(
      BACKUP_WF.jobs.refresh.steps.some((s: any) => s.name === 'Acquire exclusive Backup host turn')
    ).toBe(true);
    expect(
      BACKUP_WF.jobs.certify.steps.some(
        (s: any) => s.name === 'Release exclusive Backup host turn' && s.if === 'always()'
      )
    ).toBe(true);
  });
});
