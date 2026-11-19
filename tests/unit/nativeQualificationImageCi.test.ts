import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  NATIVE_QUALIFICATION_IMAGE_INPUTS,
  classifyChangedPaths,
  nativeQualificationImageChanged,
} from '../../scripts/ci/classify-ci-changes.mjs';

// THE NATIVE QUALIFICATION IMAGE PROVES ITSELF WHEN ITS INPUTS CHANGE
// (2026-11-19). #11404 changed only the native qualification Dockerfile; no
// job built the image on its pull request, because the one job that did
// (accounting shard 4/7) is not admitted by that path.
const IMAGE_INPUTS = [
  'scripts/verification-harness/leaderboard-native-function-batch.Dockerfile',
  'scripts/verification-harness/leaderboard-native-function-batch.mjs',
  'scripts/verification-harness/leaderboard-native-function-batch.test.mjs',
  'scripts/verification-harness/leaderboard-native-function-batch-build.sh',
  'scripts/ci/ubuntu-apt.sh',
  'scripts/ci/ubuntu-apt-mirrors.txt',
];
const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));

describe('native qualification image routing', () => {
  it.each(IMAGE_INPUTS)('schedules the image build for %s alone', (path) => {
    expect(nativeQualificationImageChanged([path])).toBe(true);
    expect(nativeQualificationImageChanged(['README.md', path])).toBe(true);
  });

  it('does not build the image for unrelated or look-alike paths', () => {
    for (const path of [
      'README.md',
      'src/App.tsx',
      'scripts/verification-harness/leaderboard-native-function-batch.Dockerfile.bak',
      'scripts/verification-harness/leaderboard-schema-replica.mjs',
      'scripts/ci/ubuntu-apt-mirror.py',
      'other/scripts/ci/ubuntu-apt.sh',
    ]) {
      expect(nativeQualificationImageChanged([path]), path).toBe(false);
    }
    expect(nativeQualificationImageChanged([])).toBe(false);
  });

  it('builds the image when the changed paths are unknown', () => {
    expect(nativeQualificationImageChanged(null)).toBe(true);
    expect(nativeQualificationImageChanged(undefined)).toBe(true);
  });

  it('keeps the five pinned classifier suites unchanged', () => {
    // The qualification admission projection pins exactly these keys.
    expect(Object.keys(classifyChangedPaths(IMAGE_INPUTS.slice(0, 1))).sort()).toEqual([
      'fixture',
      'phase4',
      'server',
      'src',
      'tests',
    ]);
    expect(NATIVE_QUALIFICATION_IMAGE_INPUTS.test(IMAGE_INPUTS[0])).toBe(true);
  });

  it('publishes native_image from the exact git diff a Dockerfile-only change makes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'ca-native-image-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: repo,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@example.invalid',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@example.invalid',
        },
      }).trim();
    try {
      git('init', '-q');
      writeFileSync(join(repo, 'README.md'), 'base\n');
      git('add', '.');
      git('commit', '-qm', 'base');
      const base = git('rev-parse', 'HEAD');
      const dockerfile = join(repo, IMAGE_INPUTS[0]);
      mkdirSync(dirname(dockerfile), { recursive: true });
      writeFileSync(dockerfile, 'FROM scratch\n');
      git('add', '.');
      git('commit', '-qm', 'dockerfile only');
      const head = git('rev-parse', 'HEAD');
      const output = join(repo, 'github-output');
      writeFileSync(output, '');
      execFileSync('node', [join(process.cwd(), 'scripts/ci/classify-ci-changes.mjs')], {
        cwd: repo,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: repo,
          CI_BASE_SHA: base,
          CI_HEAD_SHA: head,
          GITHUB_OUTPUT: output,
        },
      });
      const outputs = Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=', 2))
      );
      expect(outputs.native_image).toBe('true');
      expect(outputs.server).toBe('false');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('runs exactly the image build in a dedicated job the Server Engine check requires', () => {
    expect(ci.jobs.changes.outputs.native_image).toBe('${{ steps.f.outputs.native_image }}');
    const job = ci.jobs.native_qualification_image;
    expect(job.needs).toBe('changes');
    expect(job.if).toContain("needs.changes.outputs.native_image != 'false'");
    expect(job.if).toContain("needs.changes.result != 'success'");
    expect(job.if).toContain("needs.changes.outputs.head_current != 'false'");
    expect(job['timeout-minutes']).toBeGreaterThan(8);
    const builds = job.steps.filter(
      (step: { run?: string }) =>
        step.run ===
        'bash scripts/verification-harness/leaderboard-native-function-batch-build.sh "${{ runner.temp }}"'
    );
    expect(builds).toHaveLength(1);
    expect(builds[0]['timeout-minutes']).toBe(8);
    expect(ci.jobs.server.needs).toContain('native_qualification_image');
    const gate = ci.jobs.server.steps.find(
      (step: { env?: Record<string, string> }) =>
        step.env?.IMAGE_RESULT === '${{ needs.native_qualification_image.result }}'
    );
    expect(gate.run).toContain('exit 1');
    expect(gate.env.IMAGE_CHANGED).toBe('${{ needs.changes.outputs.native_image }}');
  });
});
