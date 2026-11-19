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
