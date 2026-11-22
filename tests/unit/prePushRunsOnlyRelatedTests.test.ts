import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Owner order (Dan, 2026-11-19 12:54 Chicago), verbatim:
// "WHAT CAN WE DO TO CHANGE THE 7 LAYER VERIFICATIONS BEFORE EVERYTHING IS
// PUSHED AND PUBLISHED?! THAT SEEMS HIGHLY EXCESSIVE AND CAN BE OPTIMIZED AND
// ENHANCED BETTER. EVEN SIMPLE CHANGES LIKE UI ARE GOING THROUGH A 7 LAYER
// VERIFICATIONS"
//
// The local pre-push gate keeps its static guards and runs only tests directly
// related to the changed files. Suites the required hosted checks run on the
// same commit are not repeated locally unless the push changes an engine,
// database or dependency-manifest path, or cannot be classified.
vi.setConfig({ testTimeout: 120_000 });

const hook = readFileSync('.husky/pre-push', 'utf8');
const helper = readFileSync('scripts/agent-push.sh', 'utf8');
const ORDER_TAIL = 'EVEN SIMPLE CHANGES LIKE UI ARE GOING THROUGH A 7 LAYER VERIFICATIONS';
const HEAVY = "CA_HEAVY_PATHS='^(server/|supabase/|package(-lock)?\\.json$)'";

// The selection block of the real hook, run against a chosen file list.
function select(files: string) {
  const start = hook.indexOf('\nCA_HEAVY_PATHS=');
  const end = hook.indexOf('\n# CENSUSES OF THE TEST TREE');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const script = [
    'set -e',
    'CA_TREE_TOP=$PWD; CHANGED_TESTS=""; NODE_TESTS=""; CHANGED_SRC=""',
    `FILES="${files}"`,
    hook.slice(start, end),
    'echo "SCOPE=$CA_LOCAL_SCOPE HOSTED_SERVER=$CA_HOSTED_SERVER"',
    'echo "COUNT=$(printf "%s\\n" $CHANGED_TESTS $NODE_TESTS | grep -c . || true)"',
    'echo "SRC=[$CHANGED_SRC]"',
  ].join('\n');
  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

describe('the local pre-push gate runs only directly related tests', () => {
  it('uses one heavy-path expression in the hook and in the push helper', () => {
    expect(hook).toContain(HEAVY);
    expect(helper).toContain(HEAVY);
  });

  it('a tooling and workflow push selects direct readers and never the engine project', () => {
    const out = select('.github/workflows/ci.yml scripts/ci/execution-preview.mjs PUBLISHING.md');
    expect(out).toContain('SCOPE=related HOSTED_SERVER=yes');
    expect(out).toMatch(
      /\.github\/workflows\/ci\.yml is named by \d+ tests: left to the required hosted Client Unit Tests job\./
    );
    const count = Number(/COUNT=(\d+)/.exec(out)?.[1]);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(120);
    // With the hosted Server Engine check admitted, no workflow reader in
    // server/src is selected, so the server gate has nothing to run.
    expect(hook).toContain(
      'if [ "$CA_HOSTED_SERVER" = yes ]; then SERVER_WORKFLOW_BASENAMES=""; fi'
    );
  });

  it('a client-only push runs no import-graph sweep', () => {
    const out = select('src/App.tsx public/favicon.ico');
    expect(out).toContain('SCOPE=related HOSTED_SERVER=no');
    expect(out).toContain('SRC=[]');
  });

  it('an engine or database path keeps the full local selection', () => {
    expect(select('server/src/engine/HorseLogic.ts src/App.tsx')).toContain('SCOPE=full');
    expect(select('supabase/migrations/20260101000000_x.sql')).toContain('SCOPE=full');
    expect(select('package-lock.json')).toContain('SCOPE=full');
  });

  it('a push whose client suite hosted CI would not run keeps the full local selection', () => {
    expect(select('docs/some-note.md')).toContain('SCOPE=full');
  });

  it('the helper waits on machine load only for a heavy local stage', () => {
    expect(helper).toContain('if [ "$(uname -s)" = Darwin ] && ! heavy_local_stage; then');
    expect(helper).toMatch(
      /heavy_local_stage\(\) \{[\s\S]*?\|\| return 0[\s\S]*?grep -qE "\$CA_HEAVY_PATHS"\n\}/
    );
  });

  it('adding or editing any workflow YAML includes the directory-scanning workflow law censuses', () => {
    const start = hook.indexOf('\nCA_HEAVY_PATHS=');
    const end = hook.indexOf('\n# A changed test can also be found as a source contract');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const script = [
      'set -e',
      'CA_TREE_TOP=$PWD; CHANGED_TESTS=""; NODE_TESTS=""; CHANGED_SRC=""',
      'FILES=".github/workflows/triage-engine-release-incident.yml"',
      hook.slice(start, end),
      'echo "TESTS=$CHANGED_TESTS"',
    ].join('\n');
    const run = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('tests/unit/aJobTokenCannotStartTrustedWork.law.test.ts');
    expect(run.stdout).toContain('tests/unit/workflowJobsReadOnlyMainOnlyEnvironments.law.test.ts');
    expect(run.stdout).toContain('tests/unit/workflowConcurrencyGuard.test.ts');
    expect(run.stdout).toContain('tests/a-workflow-step-fits-what-github-will-run.law.test.ts');
    expect(run.stdout).toContain('tests/no-workflow-gains-a-new-timer.law.test.ts');
    expect(run.stdout).toContain('tests/superseded-ci-stops-at-the-push.law.test.ts');
  });

  it('adding a migration includes the directory-scanning migration law censuses', () => {
    const start = hook.indexOf('\nCA_HEAVY_PATHS=');
    const end = hook.indexOf('\n# A changed test can also be found as a source contract');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const run = (files: string) =>
      spawnSync(
        'bash',
        [
          '-c',
          [
            'set -e',
            'CA_TREE_TOP=$PWD; CHANGED_TESTS=""; NODE_TESTS=""; CHANGED_SRC=""',
            `FILES="${files}"`,
            hook.slice(start, end),
            'echo "TESTS=$CHANGED_TESTS"',
          ].join('\n'),
        ],
        { encoding: 'utf8' }
      );
    const added = run(
      'supabase/migrations/20261121182315_a_moved_seat_never_leaves_a_locked_promo_position.sql'
    );
    expect(added.status, added.stderr).toBe(0);
    for (const t of [
      'tests/unit/migrationVersionUniqueness.test.ts',
      'tests/a-migration-proves-its-functions-before-commit.law.test.ts',
      'tests/a-money-trigger-declares-itself.law.test.ts',
      'tests/a-window-migration-waits-for-the-daily-break.law.test.ts',
      'tests/postgrest-is-never-reloaded-on-a-timer.law.test.ts',
    ]) {
      expect(added.stdout).toContain(t);
    }
    const other = run('docs/changelog/2026-11-21-x.md');
    expect(other.status, other.stderr).toBe(0);
    expect(other.stdout).not.toContain(
      'tests/a-migration-proves-its-functions-before-commit.law.test.ts'
    );
  });

  it('the push helper resolves Darwin TMPDIR onto an external SmarterWork scratch root before mktemp', () => {
    expect(helper).toContain(
      '/Volumes/SmarterWork/agent-work/.t /Volumes/SmarterWork/agent-work/extreme-capacity/.t'
    );
    expect(helper.indexOf('export TMPDIR')).toBeLessThan(helper.indexOf('agent-push-step.XXXXXX'));
    expect(helper).toContain('for fetch_attempt in 1 2 3; do');
    expect(helper).toContain('for ref_attempt in 1 2 3; do');
  });

  it('the push helper fetch retry loop recovers transient exit 1, aborts immediately on signal >= 128, and fails cleanly after 3 attempts', () => {
    const start = helper.indexOf('for fetch_attempt in 1 2 3; do');
    const end = helper.indexOf('# A plain `git fetch <remote> main`', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const loop = helper.slice(start, end);

    const runLoop = (codes: number[]) => {
      const script = [
        'REMOTE=origin; REMOTE_GIT=(true); CALLS=0',
        `CODES=(${codes.join(' ')})`,
        'say() { :; }',
        'sleep() { :; }',
        'owned() { local c=${CODES[$CALLS]:-1}; CALLS=$((CALLS+1)); return "$c"; }',
        'rc=0',
        loop,
        'echo "OK CALLS=$CALLS RC=$rc"',
      ].join('\n');
      return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    };

    const recovered = runLoop([1, 0]);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain('OK CALLS=2 RC=0');

    const signalStop = runLoop([143, 0]);
    expect(signalStop.status).toBe(143);

    const exhausted = runLoop([1, 1, 1]);
    expect(exhausted.status).toBe(1);
  });

  it('the hook, the publishing guide and the owner policy record the order and keep the later gates', () => {
    const publishing = readFileSync('PUBLISHING.md', 'utf8');
    const policy = readFileSync('docs/agent-policy/OWNER-POLICY.md', 'utf8');
    expect(hook).toContain('# VERIFICATIONS"');
    expect(publishing).toContain(ORDER_TAIL);
    expect(policy).toContain(ORDER_TAIL);
    expect(publishing).toContain(
      'Hosted CI, protected merge, publisher admission and applicable live proof remain mandatory.'
    );
    expect(policy).toContain(
      'Hosted CI, protected merge, publication and live proof stay mandatory.'
    );
  });
});
