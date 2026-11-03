import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const workflow = parse(
  readFileSync(join(root, '.github/workflows/publish-club-arena-client.yml'), 'utf8')
);

it('admits with only its executable module closure and preserves the immutable qualification receipt', () => {
  const job = workflow.jobs.admit;
  const checkout = job.steps.find((step: any) => step.uses === 'actions/checkout@v4');
  expect(job['timeout-minutes']).toBe(5);
  expect(checkout.with.ref).toBe('${{ inputs.target_sha }}');
  expect(checkout.with['fetch-depth']).toBe(0);
  expect(checkout.with.filter).toBe('blob:none');
  expect(checkout.with['persist-credentials']).toBe(false);
  expect(checkout.with['sparse-checkout-cone-mode']).toBe(false);
  const files = checkout.with['sparse-checkout'].trim().split('\n');
  expect(files).toEqual([
    '/scripts/ci/publisher-client-singleflight.mjs',
    '/scripts/ci/production-e2e-provenance.mjs',
    '/scripts/ci/publisher-verdict-receipt.mjs',
    '/scripts/ci/publisher-job-identity.mjs',
    '/scripts/ci/publisher-client-shards.mjs',
    '/scripts/ci/classify-ci-changes.mjs',
    '/scripts/ci/repository-identity.mjs',
  ]);
  const upload = job.steps.find((step: any) => step.uses === 'actions/upload-artifact@v4');
  expect(upload.with.name).toBe('club-arena-client-inputs-attempt-${{ github.run_attempt }}');
  expect(upload.with.path).toBe('client-inputs.json');
  expect(upload.with['if-no-files-found']).toBe('error');
  const directory = mkdtempSync(join(tmpdir(), 'admit-'));
  try {
    for (const file of files) {
      const path = join(directory, file.slice(1));
      mkdirSync(dirname(path), { recursive: true });
      copyFileSync(join(root, file.slice(1)), path);
    }
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    // Only the external HTTP response is substituted. The maintained CLI,
    // transitive imports, identity checks and exclusive receipt write execute.
    writeFileSync(
      join(bin, 'curl'),
      '#!/bin/sh\nprintf \'{"ca_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\\n\'\n',
      { mode: 0o755 }
    );
    const target = 'a'.repeat(40);
    const output = join(directory, 'output');
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
      GITHUB_REPOSITORY_ID: '1132369872',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_WORKFLOW_REF:
        'Smarter-Software-PIQ/Smarter-Poker-Club-Arena/.github/workflows/publish-club-arena.yml@refs/heads/main',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_RUN_ID: '41682004783',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_WORKFLOW_SHA: target,
      GITHUB_OUTPUT: output,
    };
    const args = ['scripts/ci/publisher-client-singleflight.mjs', target, ''];
    const result = execFileSync(process.execPath, args, {
      cwd: directory,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(JSON.parse(result).published).toBe(false);
    expect(readFileSync(output, 'utf8')).toBe('published=false\n');
    const receipt = readFileSync(join(directory, 'client-inputs.json'), 'utf8');
    expect(JSON.parse(receipt)).toEqual({
      schema: 1,
      targetSha: target,
      selectionBase: '',
      repositoryId: '1132369872',
      runId: '41682004783',
      runAttempt: '1',
      workflowSha: target,
    });
    expect(() =>
      execFileSync(process.execPath, args, { cwd: directory, env, stdio: 'pipe', timeout: 10000 })
    ).toThrow();
    expect(readFileSync(join(directory, 'client-inputs.json'), 'utf8')).toBe(receipt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
