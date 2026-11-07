import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const wrapper = 'src/engine/RetainedHistoricalCheckpointQualification.test.ts';
const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const receiver = parse(readFileSync('.github/workflows/auto-deploy-hetzner.yml', 'utf8'));

const daytime = parse(
  readFileSync('.github/workflows/engine-release-prequalification.yml', 'utf8')
);

it('executes the declared CI and receiver commands with exact-once historical coverage', () => {
  expect(ci.jobs.server_shards['timeout-minutes']).toBe(80);
  expect(daytime.jobs.qualify['timeout-minutes']).toBe(80);
  const folder = mkdtempSync(join(tmpdir(), 'retained-owner-routing-'));
  const log = join(folder, 'commands.log');
  const npm = join(folder, 'npm');
  writeFileSync(
    npm,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n' +
      `if [ "\${FAIL_RETAINED:-0}" = 1 ] && [ "$*" = "test -- ${wrapper}" ]; then exit 73; fi\n`
  );
  chmodSync(npm, 0o700);
  const run = (command: string, shard: number, fail = false) =>
    spawnSync('/bin/bash', ['-e', '-c', command], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${folder}:${process.env.PATH}`,
        COMMAND_LOG: log,
        SERVER_TEST_SHARD: String(shard),
        RELEASE_TEST_SHARD: String(shard),
        FAIL_RETAINED: fail ? '1' : '0',
      },
    });
  try {
    const steps = ci.jobs.server_shards.steps;
    const index = steps.findIndex(
      (step: { name?: string }) =>
        step.name === 'Exact retained historical owners qualify before competing workloads'
    );
    const preparation = steps[index];
    const full = steps[index + 1];
    expect(preparation.if).toBe('matrix.shard == 1');
    expect(preparation['continue-on-error']).toBeUndefined();
    expect(full.name).toBe('Full server test suite');
    const release = daytime.jobs.qualify.steps.find(
      (step: { name?: string }) => step.name === 'Compile and test the exact server tree'
    );
    expect(release['continue-on-error']).toBeUndefined();
    for (const mode of ['ci', 'receiver']) {
      writeFileSync(log, '');
      for (const shard of [1, 2, 3, 4]) {
        if (mode === 'ci' && shard === 1) expect(run(preparation.run, shard).status).toBe(0);
        expect(run(mode === 'ci' ? full.run : release.run, shard).status).toBe(0);
      }
      const calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('test '));
      expect(calls).toEqual([
        `test -- ${wrapper}`,
        ...[1, 2, 3, 4].map((shard) => `test -- --exclude ${wrapper} --shard=${shard}/4`),
      ]);
    }
    writeFileSync(log, '');
    expect(run(release.run, 1, true).status).toBe(73);
    expect(readFileSync(log, 'utf8')).not.toContain('--exclude');
    expect(run(preparation.run, 1, true).status).toBe(73);
    expect(ci.jobs.server.needs).toContain('server_shards');
    expect(receiver.jobs['engine-doors'].needs).toBe('preflight');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
