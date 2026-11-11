import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** Structural fixtures only; never warm histories, consume seeds, execute
 * deals or dispatch any workflow. The provider inventory is an in-memory
 * table: no GitHub read leaves this process. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  runQualificationPreflight,
  type QualificationPreflightDeps,
} from './featureAblationQualify.js';
import {
  FEATURE_ABLATION_REQUIRED_RUNTIME_FILES,
  featureQualificationCanonical,
  validateLockedFeatureAblationPlan,
} from '../benchmark/FeatureAblationQualification.js';
import {
  INCREMENTAL_FAMILY_PATH,
  INCREMENTAL_PLAN_PATH,
  incrementalComponentCoverage,
  incrementalQualificationRules,
} from '../benchmark/IncrementalPressureQualification.js';
import { incrementalDevelopmentProfiles } from '../benchmark/IncrementalPressureDevelopment.js';
import { PLO4_STRENGTH_CONTRACT } from '../benchmark/Plo4StrengthContract.js';

const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const hash = (x: unknown) => sha(featureQualificationCanonical(x));
const H = 'a'.repeat(64);
const TARGET = 'combo_draw_pressure' as const;
const SOURCE = 'b'.repeat(40);
const PLAN_COMMIT = 'c'.repeat(40);
const FAMILY_COMMIT = 'd'.repeat(40);
const PROVIDER_REPO = {
  id: 1132369872,
  full_name: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
};
// Mirrors the provider's control-path list (authenticateIncrementalPlan).
const CONTROL_PATHS = [
  '.github/workflows/horse-feature-ablation-qualification.yml',
  'server/scripts/feature-ablation-assemble.mjs',
  'server/scripts/feature-ablation-artifact-custody.mjs',
  'server/src/benchmark/IncrementalPressureQualification.ts',
];

function world() {
  const rules = incrementalQualificationRules(TARGET);
  const profiles = (['nlh', 'plo4', 'plo5', 'plo6'] as const).flatMap((v) =>
    incrementalDevelopmentProfiles(TARGET, v)
      .filter((p) => rules.shapes.includes(`${p.seats}:${p.stackBB}`))
      .map((p) => ({ id: p.id, variant: v, seats: p.seats, stackBB: p.stackBB, weight: 1 }))
  );
  const closureKeys = [
    ...new Set([
      ...FEATURE_ABLATION_REQUIRED_RUNTIME_FILES,
      'src/benchmark/IncrementalPressureQualification.ts',
      'src/benchmark/IncrementalPressureDevelopment.ts',
      'src/benchmark/FeatureAblationHistory.ts',
      'src/benchmark/FeatureAblationWorker.ts',
    ]),
  ].sort();
  const closureBytes = new Map(closureKeys.map((k) => [k, `fixture source of ${k}\n`]));
  const runtimeSourceFiles = Object.fromEntries(
    closureKeys.map((k) => [k, sha(closureBytes.get(k)!)])
  );
  const plan: any = {
    schema: 'horse-incremental-ablation-plan-v2',
    version: 'structural-fixture-never-protected',
    state: 'heldout_locked',
    target: TARGET,
    dealSampler: 'sha256-profile-seed-index-v1',
    baselineReferenceRevision: 'b'.repeat(40),
    sourceBinding: 'horse-decision-closure-v1',
    runtimeSourceFiles,
    runtimeSourceDigest: hash(runtimeSourceFiles),
    policyDigests: { fixture: H },
    policyDigestsDigest: hash({ fixture: H }),
    dependencyDigest: H,
    storeInputsDigest: H,
    admissionDigest: H,
    historyDigest: H,
    maxAttempts: 1,
    pooledPublicProfiles: { kind: 'empty_for_local_simulation', bootstrap: null, profiles: 0 },
    flags: rules.flags,
    population: rules.population.id,
    clock: {
      policyDateMs: Date.UTC(2026, 9, 26),
      publicHistoryAvailableAtMs: Date.UTC(2026, 9, 25, 23),
      warmSeed: rules.warmSeed,
    },
    profiles,
    heldoutSeeds: rules.seeds,
    matrix: profiles.flatMap((p) =>
      rules.seeds.map((seed) => ({
        key: `${p.id}-${seed}`,
        profileId: p.id,
        variant: p.variant,
        seed,
        shard: 0,
        firstPair: 0,
        pairs: 576,
      }))
    ),
    interval: PLO4_STRENGTH_CONTRACT.interval,
    thresholds: {
      primaryLowerBoundAboveBb100: 0,
      eachSeedPointEstimateAboveBb100: 0,
      everyCriticalCellLowerBoundAtLeastBb100: -10,
    },
    criticalCells: ['profile', 'relative_position', 'depth'],
    coverage: {
      opportunityDenominator: 'not_measured',
      byProfile: Object.fromEntries(
        profiles.map((p) => [
          p.id,
          {
            candidateHeroDecisionsMinimum: 1,
            referenceHeroDecisionsMinimum: 1,
            acceptedHeroContrastsMinimum: 1,
            evaluationCounterMinimums: Object.fromEntries(
              incrementalComponentCoverage(TARGET, p.seats)
                .filter((c) => c.applicable)
                .map((c) => [c.counter, 1])
            ),
          },
        ])
      ),
    },
  };
  const family = {
    schema: 'horse-incremental-crn-family-v1',
    providerAnchor: { workflowId: 70, baselineRunId: 90, baselineRunNumber: 17 },
    runtimeSourceDigest: plan.runtimeSourceDigest,
    members: [{ target: TARGET, planDigest: hash(plan) }],
  };
  const registryBytes = JSON.stringify({ [TARGET]: plan }, null, 2) + '\n';
  const familyBytes = JSON.stringify({ '283': family }, null, 2) + '\n';
  const gitTable: Record<string, string> = {
    'rev-parse --is-shallow-repository': 'false',
    'rev-parse HEAD': SOURCE,
    'rev-parse origin/main': SOURCE,
    'status --porcelain --untracked-files=no': '',
    [`merge-base --is-ancestor ${SOURCE} origin/main`]: '',
    [`log -1 --format=%H -- ${INCREMENTAL_PLAN_PATH}`]: PLAN_COMMIT,
    [`log -1 --format=%H -- ${INCREMENTAL_FAMILY_PATH}`]: FAMILY_COMMIT,
    [`log --first-parent --format=%H -1001 -- ${INCREMENTAL_FAMILY_PATH}`]: FAMILY_COMMIT,
    [`show ${PLAN_COMMIT}:${INCREMENTAL_PLAN_PATH}`]: registryBytes.trim(),
    [`show ${FAMILY_COMMIT}:${INCREMENTAL_FAMILY_PATH}`]: familyBytes.trim(),
    'ls-files --others server/src server/scripts .github/workflows': '',
    'ls-files server': closureKeys.map((k) => 'server/' + k).join('\n'),
  };
  for (const path of CONTROL_PATHS) gitTable[`show ${SOURCE}:${path}`] = `control ${path}`;
  const mergedPulls = (commit: string) => [
    {
      merged_at: '2026-10-27T17:00:00Z',
      merge_commit_sha: commit,
      base: { ref: 'main', repo: PROVIDER_REPO },
    },
  ];
  const baselineRun = {
    id: 90,
    workflow_id: 70,
    run_number: 17,
    created_at: '2026-10-27T15:00:00Z',
  };
  const provider: Record<string, unknown> = {
    [`/commits/${PLAN_COMMIT}/pulls`]: mergedPulls(PLAN_COMMIT),
    [`/commits/${FAMILY_COMMIT}/pulls`]: mergedPulls(FAMILY_COMMIT),
    '/actions/runs/90': baselineRun,
    '/actions/workflows/70/runs?per_page=100&page=1': {
      total_count: 1,
      workflow_runs: [baselineRun],
    },
  };
  const deps: QualificationPreflightDeps = {
    env: { GITHUB_TOKEN: 'structural-fixture-not-a-credential' },
    git: (...args: string[]) => {
      const key = args.join(' ');
      if (key in gitTable) return gitTable[key];
      throw Error('unexpected git ' + key);
    },
    readRepoFile: (path: string) => {
      if (path === INCREMENTAL_PLAN_PATH) return registryBytes;
      if (path === INCREMENTAL_FAMILY_PATH) return familyBytes;
      throw Error('unexpected repo read ' + path);
    },
    readServerFile: (relative: string) => {
      const bytes = closureBytes.get(relative);
      if (bytes === undefined) throw Error('unexpected server read ' + relative);
      return Buffer.from(bytes);
    },
    readProviderJson: async (suffix: string) => {
      if (suffix in provider) return structuredClone(provider[suffix]);
      throw Error('unexpected provider read ' + suffix);
    },
    loadPlan: () => plan,
    assertSource: () => ({}),
    verifyLocalIdentity: async () => {},
    computeClosure: (read) => {
      for (const key of closureKeys) read(key);
      return [...closureKeys];
    },
  };
  return { plan, closureBytes, baselineRun, provider, deps };
}

test('preflight admits a checkout whose closure, family and inventory match the registered plan', async () => {
  const { plan, deps } = world();
  assert.deepEqual(validateLockedFeatureAblationPlan(plan), []);
  const verdict = await runQualificationPreflight({ target: TARGET, sourceSha: SOURCE }, deps);
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.heldoutHandsDealt, 0);
  assert.equal(verdict.planDigest, hash(plan));
  assert.deepEqual(verdict.checks, [
    'registered_plan',
    'protected_source',
    'provider_reservation_state',
    'local_identity',
  ]);
});

test('preflight refuses a tampered closure file with the digest refusal', async () => {
  const { closureBytes, deps } = world();
  closureBytes.set(
    'src/scripts/featureAblationQualify.ts',
    'tampered bytes the registered plan never hashed\n'
  );
  const verdict = await runQualificationPreflight({ target: TARGET, sourceSha: SOURCE }, deps);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reasons.length, 1);
  assert.match(verdict.reasons[0], /Incremental decision closure changed/);
});

test('preflight refuses a family anchor that does not match the real inventory', async () => {
  const { provider, baselineRun, deps } = world();
  provider['/actions/runs/90'] = { ...baselineRun, workflow_id: 71 };
  const verdict = await runQualificationPreflight({ target: TARGET, sourceSha: SOURCE }, deps);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /Incremental provider lineage unavailable/);
});

test('preflight reports an existing reservation of the target partition by run id', async () => {
  const { provider, baselineRun, deps } = world();
  const reserved = {
    id: 91,
    workflow_id: 70,
    run_number: 18,
    created_at: '2026-10-27T18:00:00Z',
    path: '.github/workflows/horse-feature-ablation-qualification.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: SOURCE,
    display_title: `Held-out ${TARGET} at ${SOURCE}`,
    status: 'completed',
  };
  provider['/actions/workflows/70/runs?per_page=100&page=1'] = {
    total_count: 2,
    workflow_runs: [baselineRun, reserved],
  };
  const verdict = await runQualificationPreflight({ target: TARGET, sourceSha: SOURCE }, deps);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /Incremental partition already reserved by original run 91/);
});

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const spawnCli = (cliArgs: string[]) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'qualification',
    VITEST: '',
    SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'qualification-offline-placeholder',
  };
  delete env.GITHUB_EVENT_NAME;
  delete env.GITHUB_REF;
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/scripts/featureAblationQualify.ts', ...cliArgs],
    { cwd: serverRoot, env, encoding: 'utf8', timeout: 110_000 }
  );
};

test('without the flag the contract path is unchanged and still refuses outside the provider', () => {
  // The non-preflight branch still runs the original sequence: the source pins
  // below fail if the provider admission call or its gating ever move.
  const cli = readFileSync(
    fileURLToPath(new URL('./featureAblationQualify.ts', import.meta.url)),
    'utf8'
  );
  assert.ok(cli.includes("await authenticateIncrementalPlan(plan, args.get('cell'));"));
  assert.ok(cli.includes('if (preflightOnly) {'));
  assert.ok(!cli.includes('runQualificationPreflight(') || cli.includes('preflightOnly'));
  const result = spawnCli([
    '--plan',
    '--target=pressure_package',
    '--source-sha=' + 'a'.repeat(40),
    '--output=' + serverRoot + 'never-written-unregistered-plan.json',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Feature-ablation plan refused/);
  assert.ok(!result.stdout.includes('"mode":"preflight"'));
}, 120_000);

test('the preflight CLI emits one JSON verdict line and exit code 1 on refusal', () => {
  const result = spawnCli([
    '--plan',
    '--preflight',
    '--target=pressure_package',
    '--source-sha=' + 'a'.repeat(40),
  ]);
  assert.equal(result.status, 1, result.stderr);
  const verdict = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  assert.equal(verdict.mode, 'preflight');
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /^registered_plan: /);
}, 120_000);

test('the preflight flag requires plan mode and writes nothing', () => {
  const result = spawnCli([
    '--preflight',
    '--target=pressure_package',
    '--source-sha=' + 'a'.repeat(40),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Preflight validates the plan boundary/);
  const output = spawnCli([
    '--plan',
    '--preflight',
    '--target=pressure_package',
    '--source-sha=' + 'a'.repeat(40),
    '--output=' + serverRoot + 'never-written-preflight.json',
  ]);
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /Preflight writes no output/);
}, 240_000);

test('the preflight workflow fails on a crash or refusal instead of passing an empty verdict', () => {
  // 2026-11-11 run 42995843618: the CLI threw, `| tee` exited 0 without
  // pipefail, and the step passed with a 0-byte verdict. The step must run
  // under bash -eo pipefail and require a written, passing verdict line.
  const workflow = readFileSync(
    fileURLToPath(
      new URL('../../../.github/workflows/horse-feature-ablation-preflight.yml', import.meta.url)
    ),
    'utf8'
  );
  const step = workflow.slice(
    workflow.indexOf("- name: Run the plan job's operations tests and the read-only preflight"),
    workflow.indexOf('- name: Retain the verdict')
  );
  assert.match(step, /\n\s+shell: bash\n/);
  assert.match(step, /\| tee "\$RUNNER_TEMP\/preflight-verdict\.json"/);
  assert.match(step, /v\.mode !== "preflight" \|\| v\.ok !== true/);
});
