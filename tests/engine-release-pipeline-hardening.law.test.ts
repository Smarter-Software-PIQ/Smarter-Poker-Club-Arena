import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  buildReleaseFailureAlert,
  buildReleaseResolutions,
} from '../scripts/ci/record-engine-release-alert.mjs';

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
      "if: always() && needs.deploy.outputs.release_result != 'superseded'"
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

  it('incident 484c4cee: a shipped SHA resolves every failure still firing for that exact SHA, and only that SHA', () => {
    const sha = 'e2140d2d1581daaf84857d98e671f2be832162c6';
    const firing = [
      {
        fingerprint: 'engine-release-failed:44841264851-1',
        labels: { alertname: 'EngineReleaseFailed', target_sha: sha, severity: 'critical' },
        starts_at: '2026-11-21T00:19:02.153Z',
      },
      {
        fingerprint: 'engine-release-failed:1-1',
        labels: { alertname: 'EngineReleaseFailed', target_sha: 'f'.repeat(40) },
      },
      {
        fingerprint: 'ClubArenaEngineKillStorm:x',
        labels: { alertname: 'ClubArenaEngineKillStorm', target_sha: sha },
      },
    ];
    expect(buildReleaseResolutions({ SHIPPED: 'false', TARGET_SHA: sha }, firing)).toEqual([]);
    expect(buildReleaseResolutions({ SHIPPED: 'true', TARGET_SHA: 'not-a-sha' }, firing)).toEqual(
      []
    );
    const resolved = buildReleaseResolutions(
      { SHIPPED: 'true', TARGET_SHA: sha, RUN_ID: '5-1' },
      firing
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].status).toBe('resolved');
    expect(resolved[0].fingerprint).toBe('engine-release-failed:44841264851-1');
    expect(resolved[0].labels.alertname).toBe('EngineReleaseFailed');
    expect(resolved[0].annotations.summary).toContain('run 5-1');
    // The step runs for a shipped run too, so the resolution has a writer.
    expect(DEPLOY_WF).not.toContain(
      "needs.deploy.outputs.shipped != 'true' && needs.deploy.outputs.release_result != 'superseded'"
    );
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

  it('incident 484c4cee: prepare step tolerates a pruned ROLLBACK_IMAGE only when exact TARGET_SHA/PREPARED_IMAGE is already the sealed running engine', () => {
    const stepStart = DEPLOY_WF.indexOf(
      '- name: Prepare the scheduled immutable image without entering release intake'
    );
    const remoteStart = DEPLOY_WF.indexOf("<<'REMOTE'", stepStart);
    const remoteBodyStart = DEPLOY_WF.indexOf('\n', remoteStart) + 1;
    const remoteEnd = DEPLOY_WF.indexOf('\n          REMOTE\n', remoteBodyStart);
    expect(stepStart).toBeGreaterThan(0);
    expect(remoteStart).toBeGreaterThan(stepStart);
    expect(remoteEnd).toBeGreaterThan(remoteBodyStart);
    const rawRemote = DEPLOY_WF.slice(remoteBodyStart, remoteEnd)
      .split('\n')
      .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
      .join('\n');

    const targetSha = 'e2140d2d1581daaf84857d98e671f2be832162c6';
    const controlSha = 'b8d0da5a8bed01ad9971d5665ca9619c923d0aa9';
    const preparedImage = 'sha256:4124ddaeb254bb944e718a9b3c06f2d56de31be126d813eceabf6139e8c4df27';
    const rollbackImage = 'sha256:102a8c4fcb245dc33260e4c63e0e12bf332f1e3f17866a71384aed9b9690532b';

    const runPrepare = (opts: {
      desiredSha: string;
      desiredImage: string;
      runningImage: string;
      rollbackPresent: boolean;
      prepared?: string;
      rollback?: string;
    }) => {
      const dir = mkdtempSync(join(tmpdir(), 'ca-prepare-484c4cee-'));
      try {
        const bin = join(dir, 'bin');
        const stageRoot = join(dir, 'control-staging');
        const runKey = '44841264851-1';
        const stage = join(stageRoot, runKey);
        mkdirSync(bin, { recursive: true });
        mkdirSync(join(stage, 'server/scripts'), { recursive: true });
        const prewarmMarker = join(dir, 'prewarm-called');

        const sealStub = join(bin, 'engine-release-seal.py');
        writeFileSync(
          sealStub,
          `#!/usr/bin/env bash
if [ "$1" = get ] && [ "$2" = desired-sha ]; then echo '${opts.desiredSha}'; exit 0; fi
if [ "$1" = get ] && [ "$2" = desired-image-id ]; then echo '${opts.desiredImage}'; exit 0; fi
exit 1
`
        );
        chmodSync(sealStub, 0o755);

        const dockerStub = join(bin, 'docker');
        const prep = opts.prepared ?? preparedImage;
        const roll = opts.rollback ?? rollbackImage;
        writeFileSync(
          dockerStub,
          `#!/usr/bin/env bash
if [ "$1" = image ] && [ "$2" = inspect ] && [ "$3" = -f ]; then
  if [ "$5" = "club-arena-engine:${targetSha}" ]; then echo '${prep}'; exit 0; fi
  if [ "$5" = "${roll}" ]; then
    if [ "${opts.rollbackPresent ? '1' : '0'}" = 1 ]; then echo '${roll}'; exit 0; fi
    echo "Error response from daemon: No such image: ${roll}" >&2
    exit 1
  fi
fi
if [ "$1" = container ] && [ "$2" = inspect ]; then
  echo '${opts.runningImage}'
  exit 0
fi
if [ "$1" = image ] && [ "$2" = inspect ] && [ "$3" = "club-arena-engine:${targetSha}" ]; then
  printf '[{"Id":"%s","Config":{"Labels":{"org.opencontainers.image.revision":"%s","com.smarterpoker.engine.source-tree":"%s","com.smarterpoker.engine.build-contract":"clean-server-archive-v1"}}}]\\n' '${prep}' '${targetSha}' 'tree-sha-1'
  exit 0
fi
exit 1
`
        );
        chmodSync(dockerStub, 0o755);

        writeFileSync(
          join(bin, 'git'),
          `#!/usr/bin/env bash
if [ "$3" = rev-parse ]; then echo 'tree-sha-1'; exit 0; fi
if [ "$3" = show ]; then echo 'asset-body'; exit 0; fi
exit 0
`
        );
        chmodSync(join(bin, 'git'), 0o755);

        writeFileSync(join(bin, 'cmp'), '#!/usr/bin/env bash\ncat >/dev/null\nexit 0\n');
        chmodSync(join(bin, 'cmp'), 0o755);

        writeFileSync(
          join(stage, 'server/scripts/engine-release-activation-floor.py'),
          'print("{}")\n'
        );
        writeFileSync(
          join(stage, 'server/scripts/prewarm-engine-image.sh'),
          `#!/usr/bin/env bash\ntouch '${prewarmMarker}'\n`
        );
        chmodSync(join(stage, 'server/scripts/prewarm-engine-image.sh'), 0o755);

        const rewritten = rawRemote
          .replaceAll('/var/lib/club-arena/control-staging', stageRoot)
          .replaceAll('/usr/local/lib/club-arena/engine-control/engine-release-seal.py', sealStub)
          .replaceAll('sync -f "$STAGE/prepared-image"', 'true');

        const res = spawnSync('bash', ['-se'], {
          input: rewritten,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            PREPARED_IMAGE: prep,
            ROLLBACK_IMAGE: roll,
            TARGET_SHA: targetSha,
            CONTROL_SHA: controlSha,
            RUN_KEY: runKey,
            NOT_AFTER_EPOCH: '1795231658',
            REPO_DIR: dir,
          },
        });
        const preparedFile = join(stage, 'prepared-image');
        return {
          status: res.status,
          stdout: res.stdout,
          stderr: res.stderr,
          preparedContent: existsSync(preparedFile) ? readFileSync(preparedFile, 'utf8') : null,
          prewarmCalled: existsSync(prewarmMarker),
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    // Regression: exact redelivery after first run already sealed TARGET_SHA and pruned ROLLBACK_IMAGE.
    const alreadySealed = runPrepare({
      desiredSha: targetSha,
      desiredImage: preparedImage,
      runningImage: preparedImage,
      rollbackPresent: false,
    });
    expect(alreadySealed.status, alreadySealed.stderr).toBe(0);
    expect(alreadySealed.stdout).toContain('is already the sealed running engine');
    expect(alreadySealed.preparedContent).toBe(
      `${targetSha}\n${controlSha}\n${preparedImage}\n${rollbackImage}\n`
    );
    expect(alreadySealed.prewarmCalled).toBe(false);

    // Fail-closed: pruned ROLLBACK_IMAGE while a different SHA is still serving MUST fail.
    const missingRollback = runPrepare({
      desiredSha: '0000000000000000000000000000000000000000',
      desiredImage: rollbackImage,
      runningImage: rollbackImage,
      rollbackPresent: false,
    });
    expect(missingRollback.status).not.toBe(0);
    expect(missingRollback.stderr).toContain('No such image');

    // Fail-closed: same-image reset (PREPARED_IMAGE == ROLLBACK_IMAGE) must still run prewarm.
    const sameImageReset = runPrepare({
      desiredSha: targetSha,
      desiredImage: preparedImage,
      runningImage: preparedImage,
      rollbackPresent: true,
      prepared: preparedImage,
      rollback: preparedImage,
    });
    expect(sameImageReset.status, sameImageReset.stderr).toBe(0);
    expect(sameImageReset.prewarmCalled).toBe(true);
  });

  it('incident 484c4cee: engine-release-transaction checks already-released before rejecting a post-seal rollback-image mismatch', () => {
    const readPrepared = TRANSACTION.indexOf('  read_prepared_image\n');
    const alreadyReleased = TRANSACTION.indexOf(
      'emit_already_released "$EXACT_INSTANCE"',
      readPrepared
    );
    const rollbackCheck = TRANSACTION.indexOf(
      `[ "$COMMITTED_IMAGE" = "$PREPARED_ROLLBACK_ID" ] || die 'sealed rollback image changed since daytime preparation'`,
      readPrepared
    );
    const validateCandidate = TRANSACTION.indexOf('validate_candidate_image', readPrepared);
    const releaseLock = TRANSACTION.indexOf('\nrelease_engine_lock\n', readPrepared);

    expect(readPrepared).toBeGreaterThan(0);
    expect(alreadyReleased).toBeGreaterThan(readPrepared);
    expect(rollbackCheck).toBeGreaterThan(alreadyReleased);
    expect(validateCandidate).toBeGreaterThan(rollbackCheck);
    expect(releaseLock).toBeGreaterThan(validateCandidate);
  });
});
