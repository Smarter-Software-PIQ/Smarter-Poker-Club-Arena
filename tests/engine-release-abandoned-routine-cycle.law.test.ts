/**
 * LAW: AN ABANDONED ROUTINE CYCLE IS RETIRED ONLY UNDER THE FULL CUSTODY
 * PROOFS (2026-11-02). A receiver that recorded a terminal failure while
 * owning a routine cycle left it 'reserved' forever, and check-routine-owner
 * then refused every later receiver ("foreign pending or unknown routine
 * cycle owner remains authoritative") - run 41349091113-1 bricked the hourly
 * release lane this way. Retirement is admitted only when ALL proofs hold:
 * the recorded failure, the canonical durable terminal result matching the
 * cycle's exact identity, an expired window, no live transaction, and no
 * enabled native unit of the dead owner (systemctl failing closed).
 */
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(import.meta.dirname, '..');
const sealScript = resolve(ROOT, 'server/scripts/engine-release-seal.py');

const A_SHA = 'a'.repeat(40);
const B_SHA = 'b'.repeat(40);
const A_IMAGE = `sha256:${'a'.repeat(64)}`;
const DEAD_RUN = '555000111-1';
const LIVE_RUN = '666000222-1';

describe('an abandoned routine cycle is retired only under the full custody proofs', () => {
  let sandbox: string;
  let baseEnv: NodeJS.ProcessEnv;

  const statePath = () => join(sandbox, 'state', 'seal.json');
  const auditPath = () => join(sandbox, 'state', 'audit.jsonl');
  const state = () => JSON.parse(readFileSync(statePath(), 'utf8'));

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'abandoned-cycle-'));
    mkdirSync(join(sandbox, 'state'), { recursive: true });
    mkdirSync(join(sandbox, 'results'), { recursive: true });
    const bin = join(sandbox, 'bin');
    mkdirSync(bin);
    // systemctl: is-enabled answers per SYSTEMCTL_ENABLED_UNITS (space list);
    // everything else is not enabled (exit 1), like a cleaned host.
    writeFileSync(
      join(bin, 'systemctl'),
      `#!/usr/bin/env bash
if [ "$1" = is-enabled ]; then
  case " \${SYSTEMCTL_ENABLED_UNITS:-} " in *" $2 "*) exit 0 ;; *) exit 1 ;; esac
fi
exit 1
`
    );
    chmodSync(join(bin, 'systemctl'), 0o755);
    baseEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      ENGINE_RELEASE_STATE_DIR: join(sandbox, 'state'),
      ENGINE_RELEASE_STATE_FILE: statePath(),
      ENGINE_RELEASE_AUDIT_FILE: auditPath(),
      ENGINE_RELEASE_RESULT_DIR: join(sandbox, 'results'),
      ENGINE_RELEASE_LOCK_FILE: join(sandbox, 'seal.lock'),
    };
  });

  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

  const runSeal = (args: string[], overrides: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync('python3', [sealScript, ...args], {
      encoding: 'utf8',
      env: { ...baseEnv, ...overrides },
    });
    return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  };

  /** A valid seal state holding one reserved cycle owned by the dead run. */
  const writeFixture = (
    cycleOverrides: Record<string, unknown> = {},
    top: Record<string, unknown> = {}
  ) => {
    const startsAt = Math.floor(Date.now() / 1000 / 3600) * 3600 - 7200; // two hours ago, on the hour
    const failure = {
      schema: 1,
      runId: DEAD_RUN,
      result: 'failed',
      sha: B_SHA,
      controlSha: B_SHA,
      invocationId: 'f'.repeat(32),
      transactionExitStatus: 70,
      recoveredDesiredSha: A_SHA,
      recoveredDesiredImageId: A_IMAGE,
      completedAt: startsAt - 60,
    };
    writeFileSync(join(sandbox, 'results', `${DEAD_RUN}.json`), JSON.stringify(failure));
    const cycle = {
      kind: 'hourly-reset',
      policyId: 'phase1-hourly-01a1944f',
      policyDigest: 'd'.repeat(64),
      startsAt,
      endsAt: startsAt + 300,
      runId: DEAD_RUN,
      sha: B_SHA,
      controlSha: B_SHA,
      status: 'reserved',
      failure,
      ...cycleOverrides,
    };
    const base = {
      schema: 1,
      desired: { sha: A_SHA, imageId: A_IMAGE, legacyUnlabelled: false },
      highWaterSha: A_SHA,
      committedRuns: {},
      pending: null,
      finalization: null,
      generation: 1,
      updatedAt: startsAt,
      routineMaintenanceCycles: { [String(startsAt)]: cycle },
      ...top,
    };
    writeFileSync(statePath(), JSON.stringify(base));
    return { startsAt };
  };

  it('retires the dead owner under the full proofs, audits it, and frees the lane', () => {
    const { startsAt } = writeFixture();
    const check = runSeal(['check-routine-owner', '--run-id', LIVE_RUN]);
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
    expect(check.stdout).toBe('none');
    const s = state();
    expect(s.routineMaintenanceCycles).toEqual({});
    expect(s.retiredRoutineCycles[String(startsAt)]).toMatchObject({
      runId: DEAD_RUN,
      status: 'reserved',
      retiredBy: 'expired-terminal-failure',
    });
    const events = readFileSync(auditPath(), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).event);
    expect(events).toContain('routine_cycle_retired');
  });

  it('an unexpired window keeps the owner authoritative', () => {
    const startsAt = Math.floor(Date.now() / 1000 / 3600) * 3600 + 3600; // next hour
    writeFixture({ startsAt, endsAt: startsAt + 300 }, {});
    // rewrite with corrected key
    const s0 = state();
    const c = Object.values(s0.routineMaintenanceCycles)[0];
    s0.routineMaintenanceCycles = { [String(startsAt)]: c };
    writeFileSync(statePath(), JSON.stringify(s0));
    const check = runSeal(['check-routine-owner', '--run-id', LIVE_RUN]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('foreign pending or unknown routine cycle owner');
    expect(state().routineMaintenanceCycles).not.toEqual({});
  });

  it('a missing durable terminal result refuses retirement, fail closed', () => {
    writeFixture();
    rmSync(join(sandbox, 'results', `${DEAD_RUN}.json`));
    const check = runSeal(['check-routine-owner', '--run-id', LIVE_RUN]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('durable release failure is missing');
    expect(Object.keys(state().routineMaintenanceCycles)).toHaveLength(1);
  });

  it('a durable result for a different identity refuses retirement', () => {
    writeFixture({ sha: A_SHA, controlSha: A_SHA, failure: undefined });
    // cycle identity A, durable failure identity B
    const s0 = state();
    const key = Object.keys(s0.routineMaintenanceCycles)[0];
    s0.routineMaintenanceCycles[key].failure = JSON.parse(
      readFileSync(join(sandbox, 'results', `${DEAD_RUN}.json`), 'utf8')
    );
    writeFileSync(statePath(), JSON.stringify(s0));
    const check = runSeal(['check-routine-owner', '--run-id', LIVE_RUN]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('abandoned routine cycle failure does not match its owner');
  });

  it('an enabled native unit of the dead owner refuses retirement', () => {
    writeFixture();
    const check = runSeal(['check-routine-owner', '--run-id', LIVE_RUN], {
      SYSTEMCTL_ENABLED_UNITS: `club-arena-engine-intake-v1@${DEAD_RUN}.service`,
    });
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('still has an enabled native unit');
    expect(Object.keys(state().routineMaintenanceCycles)).toHaveLength(1);
  });

  it('a live transaction (durable result finalization) defers retirement entirely', () => {
    writeFixture(
      {},
      {
        finalization: { runId: LIVE_RUN, sha: A_SHA, imageId: A_IMAGE },
        committedRuns: { [LIVE_RUN]: { sha: A_SHA, imageId: A_IMAGE } },
      }
    );
    const check = runSeal(['check-routine-owner', '--run-id', LIVE_RUN]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('foreign pending or unknown routine cycle owner');
    expect(Object.keys(state().routineMaintenanceCycles)).toHaveLength(1);
  });

  it('a cycle without a recorded failure is never retired', () => {
    writeFixture({ failure: undefined });
    const s0 = state();
    const key = Object.keys(s0.routineMaintenanceCycles)[0];
    delete s0.routineMaintenanceCycles[key].failure;
    writeFileSync(statePath(), JSON.stringify(s0));
    const check = runSeal(['check-routine-owner', '--run-id', LIVE_RUN]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('foreign pending or unknown routine cycle owner');
  });
});
