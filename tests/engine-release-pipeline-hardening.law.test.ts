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
  buildReleaseResolvedAlerts,
  shippedSibling,
} from '../scripts/ci/record-engine-release-alert.mjs';
import { engineAlertEpisodeId } from '../scripts/ci/engine-alert-episode.mjs';

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

  it('incident 484c4cee: a failed redelivery of a SHA another run already shipped raises nothing', () => {
    const sha = 'e2140d2d1581daaf84857d98e671f2be832162c6';
    const alert = buildReleaseFailureAlert({
      SHIPPED: 'false',
      RELEASE_RESULT: 'not completed',
      TARGET_SHA: sha,
      RUN_ID: '44841264851-1',
      EXIT_STAGE: 'prepare',
    });
    const receipts = [
      { run_id: '44841245126-1', target_sha: sha, shipped: true },
      { run_id: '44841264851-1', target_sha: sha, shipped: false },
    ];
    expect(shippedSibling(alert, receipts)).toBe('44841245126-1');
    expect(
      shippedSibling(alert, [{ run_id: '1-1', target_sha: 'f'.repeat(40), shipped: true }])
    ).toBeNull();
    expect(
      shippedSibling(alert, [{ run_id: '44841264851-1', target_sha: sha, shipped: true }])
    ).toBeNull();
    expect(shippedSibling(null, receipts)).toBeNull();
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
if [ "$3" = merge-base ] && [ "$4" = --is-ancestor ]; then exit 1; fi
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

  it('wave 2: prepare step stands down as superseded when a strictly newer SHA already sealed on the host (and stays fail-closed otherwise)', () => {
    const stepStart = DEPLOY_WF.indexOf(
      '- name: Prepare the scheduled immutable image without entering release intake'
    );
    const remoteStart = DEPLOY_WF.indexOf("<<'REMOTE'", stepStart);
    const remoteBodyStart = DEPLOY_WF.indexOf('\n', remoteStart) + 1;
    const remoteEnd = DEPLOY_WF.indexOf('\n          REMOTE\n', remoteBodyStart);
    const rawRemote = DEPLOY_WF.slice(remoteBodyStart, remoteEnd)
      .split('\n')
      .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
      .join('\n');

    const targetSha = 'e2140d2d1581daaf84857d98e671f2be832162c6';
    const newerSha = 'bb21dc82673117a937f67c9498dec46b8c27522e';
    const controlSha = '56317ec1db39393d6b80fdf57e3e4a3597c84d26';
    const preparedImage = 'sha256:4124ddaeb254bb944e718a9b3c06f2d56de31be126d813eceabf6139e8c4df27';
    const rollbackImage = 'sha256:102a8c4fcb245dc33260e4c63e0e12bf332f1e3f17866a71384aed9b9690532b';

    const runSuperseded = (isAncestor: boolean) => {
      const dir = mkdtempSync(join(tmpdir(), 'ca-prepare-superseded-'));
      try {
        const bin = join(dir, 'bin');
        const stageRoot = join(dir, 'control-staging');
        const runKey = '555-1';
        const stage = join(stageRoot, runKey);
        mkdirSync(bin, { recursive: true });
        mkdirSync(join(stage, 'server/scripts'), { recursive: true });
        const prewarmMarker = join(dir, 'prewarm-called');

        const sealStub = join(bin, 'engine-release-seal.py');
        writeFileSync(
          sealStub,
          `#!/usr/bin/env bash
if [ "$1" = get ] && [ "$2" = desired-sha ]; then echo '${newerSha}'; exit 0; fi
if [ "$1" = get ] && [ "$2" = desired-image-id ]; then echo 'sha256:${'9'.repeat(64)}'; exit 0; fi
exit 1
`
        );
        chmodSync(sealStub, 0o755);

        const dockerStub = join(bin, 'docker');
        writeFileSync(
          dockerStub,
          `#!/usr/bin/env bash
if [ "$1" = container ] && [ "$2" = inspect ]; then echo 'sha256:${'9'.repeat(64)}'; exit 0; fi
if [ "$1" = image ] && [ "$2" = inspect ] && [ "$5" = "club-arena-engine:${targetSha}" ]; then echo '${preparedImage}'; exit 0; fi
echo "Error response from daemon: No such image: $5" >&2
exit 1
`
        );
        chmodSync(dockerStub, 0o755);

        writeFileSync(
          join(bin, 'git'),
          `#!/usr/bin/env bash
if [ "$3" = merge-base ] && [ "$4" = --is-ancestor ]; then exit ${isAncestor ? 0 : 1}; fi
exit 0
`
        );
        chmodSync(join(bin, 'git'), 0o755);
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
            PREPARED_IMAGE: preparedImage,
            ROLLBACK_IMAGE: rollbackImage,
            TARGET_SHA: targetSha,
            CONTROL_SHA: controlSha,
            RUN_KEY: runKey,
            NOT_AFTER_EPOCH: '1795231658',
            REPO_DIR: dir,
          },
        });
        return {
          status: res.status,
          stdout: res.stdout,
          stderr: res.stderr,
          prewarmCalled: existsSync(prewarmMarker),
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    const superseded = runSuperseded(true);
    expect(superseded.status, superseded.stderr).toBe(0);
    expect(superseded.stdout).toContain(`ENGINE_PREPARE_SUPERSEDED=${newerSha}`);
    expect(superseded.prewarmCalled).toBe(false);

    const notAncestor = runSuperseded(false);
    expect(notAncestor.status).not.toBe(0);
    expect(notAncestor.stderr).toContain('No such image');
  });

  it('wave 2: deploy exit_path surfaces the concrete prepare error line in EXIT_ERROR', () => {
    const wf = parse(DEPLOY_WF);
    const exitStep = wf.jobs.deploy.steps.find((s: any) => s.id === 'exit_path');
    expect(exitStep).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'ca-exit-path-prepare-'));
    try {
      const ghOut = join(dir, 'github-output');
      writeFileSync(ghOut, '');
      writeFileSync(
        join(dir, 'engine-prepared-image-777-1.log'),
        '{"schema":"engine-release-activation-floor/v2-owner-window"}\nError response from daemon: No such image: sha256:102a8c4\n'
      );
      const res = spawnSync('bash', ['-c', exitStep.run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: ghOut,
          RUNNER_TEMP: dir,
          RUN_KEY: '777-1',
          STEP_OUTCOMES:
            'deadline=success checkout=success freshness=success admit=success ssh=success stage=success prepare=failure floor=skipped release=skipped verify=skipped',
          RELEASE_RESULT: '',
          RELEASE_FAILED_STAGE: '',
          VERIFIED: 'false',
        },
      });
      expect(res.status, res.stderr).toBe(0);
      const out = readFileSync(ghOut, 'utf8');
      expect(out).toContain('stage=prepare\n');
      expect(out).toContain('outcome=failure\n');
      expect(out).toContain(
        'error=step prepare ended failure: Error response from daemon: No such image: sha256:102a8c4\n'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wave 2: cutover-spectator evaluates pure-Node admission before npm ci and Playwright install', () => {
    const wf = parse(DEPLOY_WF);
    const steps: any[] = wf.jobs['cutover-spectator'].steps;
    const predecessorIdx = steps.findIndex((s) => s.id === 'predecessor');
    const npmCiIdx = steps.findIndex(
      (s) => typeof s.run === 'string' && s.run.includes('npm ci --ignore-scripts')
    );
    const playwrightIdx = steps.findIndex(
      (s) => s.name === 'Install browser dependencies from the primary mirror'
    );
    expect(predecessorIdx).toBeGreaterThan(-1);
    expect(npmCiIdx).toBeGreaterThan(predecessorIdx);
    expect(playwrightIdx).toBeGreaterThan(npmCiIdx);
    expect(steps[npmCiIdx].if).toBe("steps.predecessor.outputs.admitted == 'true'");
    expect(steps[playwrightIdx].if).toBe("steps.predecessor.outputs.admitted == 'true'");
  });

  it('wave 2: verified green releases auto-resolve open EngineReleaseFailed alerts', () => {
    expect(DEPLOY_WF).toContain('name: Resolve prior release failure alerts after verified ship');
    expect(DEPLOY_WF).toContain(
      "if: always() && needs.deploy.outputs.shipped == 'true' && needs.deploy.outputs.verified == 'true'"
    );

    expect(
      buildReleaseResolvedAlerts({ SHIPPED: 'false', VERIFIED: 'true' }, [
        { fingerprint: 'engine-release-failed:1-1' },
      ])
    ).toEqual([]);
    expect(
      buildReleaseResolvedAlerts({ SHIPPED: 'true', VERIFIED: 'false' }, [
        { fingerprint: 'engine-release-failed:1-1' },
      ])
    ).toEqual([]);

    const resolved = buildReleaseResolvedAlerts(
      {
        SHIPPED: 'true',
        VERIFIED: 'true',
        RUN_ID: '888-1',
        TARGET_SHA: 'bb21dc82673117a937f67c9498dec46b8c27522e',
        RELEASE_RESULT: 'sealed',
      },
      [
        {
          fingerprint: 'engine-release-failed:44841264851-1',
          labels: {
            alertname: 'EngineReleaseFailed',
            severity: 'critical',
            component: 'engine-release',
            run_id: '44841264851-1',
            // A resolve must carry its firing row's episode or intake cannot
            // pair them (tests/an-engine-alert-resolves-its-own-episode.law.test.ts).
            engine_alert_episode_id: engineAlertEpisodeId('engine-release-failed:44841264851-1'),
          },
          starts_at: '2026-11-21T00:19:02.000Z',
        },
        {
          fingerprint: 'engine-release-failed:44841264851-1',
          labels: {
            alertname: 'EngineReleaseFailed',
            component: 'engine-release',
            engine_alert_episode_id: engineAlertEpisodeId('engine-release-failed:44841264851-1'),
          },
          starts_at: '2026-11-21T00:19:02.000Z',
        },
      ]
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].status).toBe('resolved');
    expect(resolved[0].fingerprint).toBe('engine-release-failed:44841264851-1');
    expect(resolved[0].startsAt).toBe('2026-11-21T00:19:02.000Z');
    expect(resolved[0].endsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(resolved[0].labels.alertname).toBe('EngineReleaseFailed');
    expect(resolved[0].labels.resolved_by_run_id).toBe('888-1');
    expect(resolved[0].labels.resolved_by_sha).toBe('bb21dc82673117a937f67c9498dec46b8c27522e');
    expect(resolved[0].labels.engine_alert_episode_id).toBe(
      engineAlertEpisodeId('engine-release-failed:44841264851-1')
    );
  });

  it('wave 3: firing and resolved EngineReleaseFailed payloads preserve exact fingerprint and label parity for fn_record_engine_alerts', () => {
    const firing = buildReleaseFailureAlert({
      SHIPPED: 'false',
      RELEASE_RESULT: 'failed',
      RUN_ID: '44841264851-1',
      TARGET_SHA: 'e2140d2d1581daaf84857d98e671f2be832162c6',
      EXIT_STAGE: 'prepare',
      EXIT_OUTCOME: 'failed',
      EXIT_ERROR: 'rollback image missing',
    });
    expect(firing).not.toBeNull();
    const resolved = buildReleaseResolvedAlerts(
      {
        SHIPPED: 'true',
        VERIFIED: 'true',
        RUN_ID: '44900000000-1',
        TARGET_SHA: 'bb21dc82673117a937f67c9498dec46b8c27522e',
        RELEASE_RESULT: 'sealed',
      },
      [
        {
          fingerprint: firing!.fingerprint,
          labels: firing!.labels,
          starts_at: firing!.startsAt,
        },
      ]
    );
    expect(resolved).toHaveLength(1);
    // Exact dedup/matching keys preserved so public.fn_record_engine_alerts + reliability controller close the matching row
    expect(resolved[0].fingerprint).toBe(firing!.fingerprint);
    expect(resolved[0].startsAt).toBe(firing!.startsAt);
    expect(resolved[0].labels.alertname).toBe(firing!.labels.alertname);
    expect(resolved[0].labels.severity).toBe(firing!.labels.severity);
    expect(resolved[0].labels.component).toBe(firing!.labels.component);
    expect(resolved[0].labels.run_id).toBe(firing!.labels.run_id);
    expect(resolved[0].labels.target_sha).toBe(firing!.labels.target_sha);
    expect(resolved[0].labels.engine_alert_episode_id).toBe(firing!.labels.engine_alert_episode_id);
    expect(['firing', 'resolved']).toContain(firing!.status);
    expect(['firing', 'resolved']).toContain(resolved[0].status);
  });
  it('wave 4: prepare serializes host prewarm under ENGINE_BUILD_LOCK_FILE and verified superseded stand-downs resolve stale EngineReleaseFailed alerts', () => {
    expect(DEPLOY_WF).toContain(
      'PREPARE_LOCK="${ENGINE_BUILD_LOCK_FILE:-/var/lock/club-arena-engine-build.lock}"'
    );
    expect(DEPLOY_WF).toContain('flock -w 30 8 || { echo "ENGINE_PREPARE_LOCK_BUSY=$PREPARE_LOCK"');
    expect(DEPLOY_WF.indexOf('flock -w 30 8')).toBeLessThan(
      DEPLOY_WF.indexOf('"$STAGE/server/scripts/prewarm-engine-image.sh" "$IMAGE_ID"')
    );
    expect(DEPLOY_WF).toContain(
      'name: Resolve prior release failure alerts after verified superseded stand-down'
    );
    expect(DEPLOY_WF).toContain(
      "if: always() && needs.deploy.outputs.release_result == 'superseded'"
    );
    expect(DEPLOY_WF).toContain(
      'VERIFIED=true timeout --signal=TERM --kill-after=5s 60s node scripts/ci/record-engine-release-alert.mjs'
    );

    // Behavioral proof: extract the exact Python health check from auto-deploy-hetzner.yml
    const pyMatch = DEPLOY_WF.match(
      /python3 -c '(import json,sys; h=json\.load\(sys\.stdin\);[^']+)'/
    );
    expect(pyMatch?.[1]).toBeTruthy();
    const evalHealth = (payload: string) => {
      const r = spawnSync('python3', ['-c', pyMatch![1]], {
        input: payload,
        encoding: 'utf8',
      });
      return r.status === 0 ? r.stdout.trim() : 'false';
    };
    expect(
      evalHealth(
        JSON.stringify({
          status: 'ok',
          liveness: 'ok',
          settlementStatus: 'ok',
          wholeFleetStalled: false,
        })
      )
    ).toBe('true');
    expect(
      evalHealth(
        JSON.stringify({
          status: 'ok',
          liveness: 'degraded',
          settlementStatus: 'ok',
          wholeFleetStalled: false,
        })
      )
    ).toBe('false');
    expect(
      evalHealth(
        JSON.stringify({
          status: 'ok',
          liveness: 'ok',
          settlementStatus: 'ok',
          wholeFleetStalled: true,
        })
      )
    ).toBe('false');
    expect(evalHealth('{malformed-json')).toBe('false');
  });

  it('wave 4: suppresses failure alerts for ancestor-superseded SHAs, widens auto-resolve lookback to 14 days, and supports verified superseded resolution', () => {
    const olderSha = 'e2140d2d1581daaf84857d98e671f2be832162c6';
    const newerSha = 'bb21dc82673117a937f67c9498dec46b8c27522e';
    const staleFailure = buildReleaseFailureAlert({
      SHIPPED: 'false',
      RELEASE_RESULT: 'failed',
      RUN_ID: '44900000001-1',
      TARGET_SHA: olderSha,
      EXIT_STAGE: 'prepare',
      EXIT_OUTCOME: 'failed',
    });
    expect(staleFailure).not.toBeNull();
    // Exact match still returns null when only a different SHA exists without ancestry proof
    expect(
      shippedSibling(staleFailure, [
        { run_id: '44900000002-1', target_sha: newerSha, shipped: true },
      ])
    ).toBeNull();
    // With ancestry proof (olderSha is ancestor of shipped newerSha), false alert is suppressed
    expect(
      shippedSibling(
        staleFailure,
        [{ run_id: '44900000002-1', target_sha: newerSha, shipped: true }],
        (ancestor: string, descendant: string) => ancestor === olderSha && descendant === newerSha
      )
    ).toBe('44900000002-1');
    // Fail-closed negative proofs: failed descendant, self run_id, or malformed SHA MUST NOT suppress
    expect(
      shippedSibling(
        staleFailure,
        [
          { run_id: '44900000002-1', target_sha: newerSha, shipped: false },
          { run_id: '44900000001-1', target_sha: newerSha, shipped: true },
          { run_id: '44900000009-1', target_sha: 'not-a-sha', shipped: true },
        ],
        () => true
      )
    ).toBeNull();

    // Verified superseded stand-down resolves stale open alerts; unverified does not
    expect(
      buildReleaseResolvedAlerts(
        {
          SHIPPED: 'false',
          RELEASE_RESULT: 'superseded',
          VERIFIED: 'false',
          RUN_ID: '44900000003-1',
          TARGET_SHA: newerSha,
        },
        [
          {
            fingerprint: 'engine-release-failed:old-1',
            labels: { alertname: 'EngineReleaseFailed' },
          },
        ]
      )
    ).toEqual([]);
    const resolvedOnSuperseded = buildReleaseResolvedAlerts(
      {
        SHIPPED: 'false',
        RELEASE_RESULT: 'superseded',
        VERIFIED: 'true',
        RUN_ID: '44900000003-1',
        TARGET_SHA: newerSha,
      },
      [
        {
          fingerprint: 'engine-release-failed:old-1',
          labels: {
            alertname: 'EngineReleaseFailed',
            component: 'engine-release',
            engine_alert_episode_id: engineAlertEpisodeId('engine-release-failed:old-1'),
          },
        },
      ]
    );
    expect(resolvedOnSuperseded).toHaveLength(1);
    expect(resolvedOnSuperseded[0].status).toBe('resolved');
    expect(resolvedOnSuperseded[0].fingerprint).toBe('engine-release-failed:old-1');

    const alertScript = readFileSync(
      join(ROOT, 'scripts/ci/record-engine-release-alert.mjs'),
      'utf8'
    );
    expect(alertScript).toContain("interval '14 days'");
    expect(alertScript).toContain('shippedSibling(alert, receipts.rows, gitIsAncestor)');
  });
});
