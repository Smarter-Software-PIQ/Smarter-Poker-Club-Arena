import type {
  FeatureAblationQualificationPlan,
  FeatureAblationTarget,
} from '../benchmark/FeatureAblationQualification.js';
import type { IncrementalTarget } from '../benchmark/IncrementalPressureDevelopment.js';
/** Manual, protected, contract-only provider runner. It never calls the DEV
 * export and has no production database credentials, writer or activation. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'feature-ablation-offline-placeholder';
/**
 * PREFLIGHT (dry run) for the held-out plan boundary (2026-11-10). Every run
 * of the real qualification workflow permanently reserves its target's
 * held-out partition under its family anchor, even when the plan job refuses,
 * so drift between protected main and a registered plan used to be checked by
 * hand before any dispatch. `--plan --preflight` executes the same validation
 * the real plan job executes - the registered plan, the protected source
 * closure, the provider inventory, reservation state and family history, and
 * the local frozen-identity digests - while reading the provider strictly
 * read-only and skipping only the assertions that the current process is
 * itself a run of the real workflow (GITHUB_RUN_ID identity, run-attempt
 * custody, operation-relative ordering). It dispatches nothing, writes
 * nothing and cannot reserve a partition: reservation accounting in
 * IncrementalPressureQualification.ts is scoped to the real workflow's id
 * (family.providerAnchor.workflowId) and to runs whose path is the real
 * workflow file, which a preflight run never is. The real --plan and cell
 * paths are unchanged; every preflight branch is gated on the explicit flag.
 */
export interface QualificationPreflightOptions {
  target: FeatureAblationTarget;
  sourceSha: string;
}
export interface QualificationPreflightVerdict {
  mode: 'preflight';
  target: FeatureAblationTarget;
  sourceSha: string;
  ok: boolean;
  reasons: string[];
  checks: string[];
  planDigest: string | null;
  heldoutHandsDealt: 0;
}
export interface QualificationPreflightDeps {
  env?: NodeJS.ProcessEnv;
  git?: (...args: string[]) => string;
  readRepoFile?: (repoRelative: string) => string;
  readServerFile?: (serverRelative: string) => Buffer | string;
  readProviderJson?: (suffix: string) => Promise<unknown>;
  loadPlan?: (target: FeatureAblationTarget) => FeatureAblationQualificationPlan;
  assertSource?: (plan: FeatureAblationQualificationPlan, sourceSha: string) => unknown;
  verifyLocalIdentity?: (
    plan: FeatureAblationQualificationPlan,
    target: FeatureAblationTarget
  ) => Promise<void>;
  computeClosure?: (read: (relative: string) => Buffer | string) => string[];
}
// The provider name changed in the repository transfer; the immutable identity
// did not. Same constants as IncrementalPressureQualification.ts, which does
// not export them; IncrementalPressureQualification.test.ts pins both.
const PREFLIGHT_PROVIDER_REPOSITORY = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
const PREFLIGHT_PROVIDER_REPOSITORY_ID = 1132369872;
const REAL_QUALIFICATION_WORKFLOW_PATH =
  '.github/workflows/horse-feature-ablation-qualification.yml';
// Mirrors the provider's control-path list in authenticateIncrementalPlan.
const PREFLIGHT_CONTROL_PATHS = [
  REAL_QUALIFICATION_WORKFLOW_PATH,
  'server/scripts/feature-ablation-assemble.mjs',
  'server/scripts/feature-ablation-artifact-custody.mjs',
  'server/src/benchmark/IncrementalPressureQualification.ts',
];
export async function runQualificationPreflight(
  options: QualificationPreflightOptions,
  deps: QualificationPreflightDeps = {}
): Promise<QualificationPreflightVerdict> {
  const { target, sourceSha } = options;
  const inc = await import('../benchmark/IncrementalPressureQualification.js');
  const fq = await import('../benchmark/FeatureAblationQualification.js');
  const dev = await import('../benchmark/IncrementalPressureDevelopment.js');
  const env = deps.env ?? process.env;
  const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
  let gitHolder = deps.git;
  const git = (...gitArgs: string[]): string => {
    if (!gitHolder) {
      const cleanEnv = Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
      );
      const probe = inc.qualificationGit(process.cwd(), cleanEnv);
      gitHolder = inc.qualificationGit(probe('rev-parse', '--show-toplevel'), cleanEnv);
    }
    return gitHolder(...gitArgs);
  };
  const readRepoFile =
    deps.readRepoFile ??
    ((repoRelative: string) =>
      readFileSync(resolve(git('rev-parse', '--show-toplevel'), repoRelative), 'utf8'));
  const readServerFile =
    deps.readServerFile ??
    ((serverRelative: string) =>
      readFileSync(resolve(git('rev-parse', '--show-toplevel'), 'server', serverRelative)));
  const deadline = inc.qualificationReadDeadline('plan');
  const readProviderJson =
    deps.readProviderJson ??
    (async (suffix: string) => {
      const token = env.GITHUB_TOKEN;
      if (!token) throw Error('Preflight provider reads require GITHUB_TOKEN');
      const { response, value } = await inc.readGithubJsonWithRetry(
        `https://api.github.com/repos/${PREFLIGHT_PROVIDER_REPOSITORY}${suffix}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
        deadline
      );
      if (!response.ok) throw Error('Incremental provider provenance unavailable');
      if (!value || typeof value !== 'object')
        throw Error('Incremental provider shape unavailable');
      return value;
    });
  const reasons: string[] = [];
  const checks: string[] = [];
  let planDigest: string | null = null;
  // The real plan job stops at its first refusal; so does the preflight.
  const stage = async <T>(name: string, fn: () => T | Promise<T>): Promise<T | undefined> => {
    if (reasons.length) return undefined;
    try {
      const value = await fn();
      checks.push(name);
      return value;
    } catch (error) {
      reasons.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  const plan = await stage('registered_plan', () => {
    const loaded = (deps.loadPlan ?? fq.qualificationPlan)(target);
    const refusals = fq.validateLockedFeatureAblationPlan(loaded);
    if (refusals.length) throw Error('Feature-ablation plan refused: ' + refusals.join(','));
    planDigest = fq.qualificationPlanDigest(loaded);
    return loaded;
  });
  if (plan) {
    await stage('protected_source', () =>
      (deps.assertSource ?? fq.assertProtectedFeatureAblationSource)(plan, sourceSha)
    );
    if (inc.isIncrementalQualificationTarget(target)) {
      await stage('provider_reservation_state', async () => {
        if (git('rev-parse', '--is-shallow-repository') !== 'false')
          throw Error('Incremental family history is shallow');
        const head = git('rev-parse', 'HEAD');
        if (sourceSha !== head) throw Error('Evaluated source changed');
        if (git('status', '--porcelain', '--untracked-files=no'))
          throw Error('Incremental source dirty');
        git('merge-base', '--is-ancestor', head, 'origin/main');
        const incrementalTarget = target as IncrementalTarget;
        const planPath = dev.isSeparateRiverTarget(incrementalTarget)
          ? 'server/src/benchmark/SeparateRiverQualificationPlans.json'
          : inc.INCREMENTAL_PLAN_PATH;
        const familyPath = dev.isSeparateRiverTarget(incrementalTarget)
          ? 'server/src/benchmark/SeparateRiverQualificationFamilies.json'
          : inc.INCREMENTAL_FAMILY_PATH;
        const planCommit = git('log', '-1', '--format=%H', '--', planPath);
        const bytes = readRepoFile(planPath);
        if (
          git('show', `${planCommit}:${planPath}`) !== bytes.trim() ||
          JSON.stringify(JSON.parse(bytes)[target]) !== JSON.stringify(plan)
        )
          throw Error('Incremental plan bytes changed');
        const registry = JSON.parse(bytes);
        const familyBytes = readRepoFile(familyPath);
        const family: any = inc.validateIncrementalFamily(plan, registry, JSON.parse(familyBytes));
        for (const member of family.members)
          if (fq.validateLockedFeatureAblationPlan(registry[member.target]).length)
            throw Error('Incremental family member plan invalid');
        const familyCommit = git('log', '-1', '--format=%H', '--', familyPath);
        if (git('show', `${familyCommit}:${familyPath}`) !== familyBytes.trim())
          throw Error('Incremental family bytes changed');
        const familyHistory = git(
          'log',
          '--first-parent',
          '--format=%H',
          '-1001',
          '--',
          familyPath
        ).split('\n');
        if (familyHistory.length > 1000) throw Error('Incremental family history bound');
        const firstFamilyCommit = inc.assertIncrementalFamilyHistory(
          familyHistory.map((revision) => ({
            commit: revision,
            family: JSON.parse(git('show', `${revision}:${familyPath}`))[
              inc.incrementalSeedFamily(incrementalTarget)
            ],
          })),
          family
        );
        // Read-only protected-merge provenance. The only part of the real
        // provenance assertion not applied here is its ordering against the
        // current operation's own created_at: a preflight has no operation.
        const mergedPullRequest = (prs: unknown, commit: string) => {
          if (!Array.isArray(prs)) throw Error('Incremental provider shape unavailable');
          const pr = prs.find(
            (p: any) =>
              p &&
              typeof p === 'object' &&
              p.merged_at &&
              Number.isFinite(Date.parse(p.merged_at)) &&
              p.merge_commit_sha === commit &&
              p.base?.ref === 'main' &&
              p.base?.repo?.id === PREFLIGHT_PROVIDER_REPOSITORY_ID &&
              p.base?.repo?.full_name === PREFLIGHT_PROVIDER_REPOSITORY
          );
          if (!pr) throw Error('Incremental plan was not independently protected: ' + commit);
          return pr as { merged_at: string };
        };
        const planPrs = await readProviderJson(`/commits/${planCommit}/pulls`);
        mergedPullRequest(planPrs, planCommit);
        const firstFamilyPrs = await readProviderJson(`/commits/${firstFamilyCommit}/pulls`);
        const firstMergedAt = mergedPullRequest(firstFamilyPrs, firstFamilyCommit).merged_at;
        const familyPrs = await readProviderJson(`/commits/${familyCommit}/pulls`);
        mergedPullRequest(familyPrs, familyCommit);
        // Anchor validity against the real provider inventory, read-only.
        const anchor = family.providerAnchor;
        const baseline: any = await readProviderJson(`/actions/runs/${anchor.baselineRunId}`);
        if (
          Array.isArray(baseline) ||
          baseline.id !== anchor.baselineRunId ||
          baseline.workflow_id !== anchor.workflowId ||
          baseline.run_number !== anchor.baselineRunNumber ||
          !Number.isFinite(Date.parse(String(baseline.created_at))) ||
          !(Date.parse(String(baseline.created_at)) < Date.parse(String(firstMergedAt)))
        )
          throw Error('Incremental provider lineage unavailable');
        const runs: any[] = [];
        let total: number | undefined;
        for (let page = 1; page <= 10; page++) {
          const result: any = await readProviderJson(
            `/actions/workflows/${anchor.workflowId}/runs?per_page=100&page=${page}`
          );
          if (
            Array.isArray(result) ||
            !Array.isArray(result.workflow_runs) ||
            !Number.isSafeInteger(result.total_count) ||
            result.total_count > 1000 ||
            (total !== undefined && total !== result.total_count)
          )
            throw Error('Incremental inventory unreadable or changed');
          total = result.total_count;
          runs.push(...result.workflow_runs);
          if (runs.length === total) break;
        }
        if (runs.length !== total) throw Error('Incremental inventory page bound');
        // Lineage contiguity without the current-operation containment the
        // real provider asserts about its own run.
        if (
          !runs.length ||
          new Set(runs.map((r) => r.id)).size !== runs.length ||
          runs.some(
            (r) =>
              r.workflow_id !== anchor.workflowId ||
              !Number.isSafeInteger(r.run_number) ||
              r.run_number <= 0
          ) ||
          !runs.some(
            (r) =>
              r.id === baseline.id &&
              r.run_number === baseline.run_number &&
              r.created_at === baseline.created_at
          )
        )
          throw Error('Incremental provider lineage unavailable');
        const numbered = runs
          .filter((r) => r.run_number >= anchor.baselineRunNumber)
          .map((r) => r.run_number)
          .sort((a, b) => a - b);
        if (numbered.some((n, i) => n !== anchor.baselineRunNumber + i))
          throw Error('Incremental provider lineage gap');
        // Reservation state: every run after the baseline is prior to any
        // dispatch a passing preflight would admit, so all are examined.
        for (const run of runs.filter((r) => r.run_number > anchor.baselineRunNumber)) {
          if (
            run.path !== REAL_QUALIFICATION_WORKFLOW_PATH ||
            run.event !== 'workflow_dispatch' ||
            run.head_branch !== 'main' ||
            !Number.isFinite(Date.parse(run.created_at)) ||
            !/^[0-9a-f]{40}$/.test(run.head_sha)
          )
            throw Error('Incremental prior operation unknown');
          const title = /^Held-out ([a-z0-9_]+) at ([0-9a-f]{40})$/.exec(run.display_title ?? '');
          if (
            !title ||
            (!inc.isIncrementalQualificationTarget(title[1]) &&
              !['plo6_v24', 'v53_pressure'].includes(title[1]))
          )
            throw Error('Incremental prior partition unknown');
          if (
            !inc.isIncrementalQualificationTarget(title[1]) ||
            inc.incrementalSeedFamily(title[1] as IncrementalTarget) !==
              inc.incrementalSeedFamily(incrementalTarget)
          )
            continue;
          if (title[1] === target)
            throw Error('Incremental partition already reserved by original run ' + run.id);
          if (title[2] !== head || !family.members.some((m: any) => m.target === title[1]))
            throw Error('Incremental exposed family source or membership changed');
          if (
            git('show', `${title[2]}:${familyPath}`) !== familyBytes.trim() ||
            git('show', `${title[2]}:${planPath}`) !== bytes.trim()
          )
            throw Error('Incremental original family binding changed');
          const original: any = await readProviderJson(`/actions/runs/${run.id}`);
          if (
            Array.isArray(original) ||
            original.id !== run.id ||
            original.head_sha !== run.head_sha ||
            original.display_title !== run.display_title ||
            original.status !== 'completed'
          )
            throw Error('Incremental prior outcome unavailable');
          // These two run against a real provider operation record, so the
          // full provenance assertion applies unchanged.
          inc.assertIncrementalPlanProvenance(original, planPrs, planCommit, String(original.id));
          inc.assertIncrementalPlanProvenance(
            original,
            familyPrs,
            familyCommit,
            String(original.id)
          );
          for (const path of PREFLIGHT_CONTROL_PATHS)
            if (git('show', `${original.head_sha}:${path}`) !== git('show', `${head}:${path}`))
              throw Error('Incremental original operation control changed');
        }
        // A dispatch admitted now would carry head_sha at the protected main
        // tip; the provider then requires its control files to equal the
        // evaluated source's.
        const mainTip = git('rev-parse', 'origin/main');
        for (const path of PREFLIGHT_CONTROL_PATHS)
          if (git('show', `${mainTip}:${path}`) !== git('show', `${head}:${path}`))
            throw Error('Incremental workflow control changed');
        if (git('ls-files', '--others', 'server/src', 'server/scripts', '.github/workflows'))
          throw Error('Incremental untracked executable source');
        if (plan.sourceBinding !== undefined) {
          const computeClosure =
            deps.computeClosure ??
            (await import('../engine/HorseFeatureAuthority.js')).featureAuthorityClosure;
          const tracked = new Set(git('ls-files', 'server').split('\n'));
          const closure = computeClosure((relative) => {
            if (!tracked.has('server/' + relative)) throw Error('untracked');
            return readServerFile(relative);
          });
          if (
            plan.sourceBinding !== 'horse-decision-closure-v1' ||
            JSON.stringify(closure) !== JSON.stringify(Object.keys(plan.runtimeSourceFiles).sort())
          )
            throw Error('Incremental decision closure changed');
          for (const relative of closure)
            if (sha(readServerFile(relative)) !== plan.runtimeSourceFiles[relative])
              throw Error('Incremental decision closure changed');
        } else {
          const sourceFiles = git('ls-files', 'server/src')
            .split('\n')
            .filter(
              (p) =>
                /\.(?:ts|json)$/.test(p) &&
                !/\.(?:test|spec)\.ts$/.test(p) &&
                !/Qualification(?:Plans|Families)\.json$/.test(p)
            );
          for (const path of sourceFiles) {
            const relative = path.slice('server/'.length);
            if (sha(readServerFile(relative)) !== plan.runtimeSourceFiles[relative])
              throw Error('Incremental full source closure changed');
          }
        }
      });
    } else if (!reasons.length) checks.push('provider_reservation_state_not_applicable');
    await stage('local_identity', () =>
      (deps.verifyLocalIdentity ?? verifyPreflightLocalIdentity)(plan, target)
    );
  }
  return {
    mode: 'preflight',
    target,
    sourceSha,
    ok: reasons.length === 0,
    reasons,
    checks,
    planDigest,
    heldoutHandsDealt: 0,
  };
}
/** The local frozen-identity checks the plan job performs after provider
 * admission, duplicated read-only for the preflight so the real contract path
 * below stays byte-for-byte untouched. Keep in step with that path. */
async function verifyPreflightLocalIdentity(
  plan: FeatureAblationQualificationPlan,
  target: FeatureAblationTarget
): Promise<void> {
  const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
  const { hydrateFrozenFeatureAblationStores } =
    await import('../benchmark/FeatureAblationStores.js');
  const { buildIncrementalWarmRecords } =
    await import('../benchmark/IncrementalPressureDevelopment.js');
  const { buildPressureWarmRecords, featureAblationHistoryDigest } =
    await import('../benchmark/FeatureAblationHistory.js');
  const { featureQualificationCanonical } =
    await import('../benchmark/FeatureAblationQualification.js');
  const { incrementalQualificationRules, isIncrementalQualificationTarget } =
    await import('../benchmark/IncrementalPressureQualification.js');
  const { defaultHorseDecisionWorkerDependencies: workerDeps } =
    await import('../engine/horseDecision/workerRuntime.js');
  const { HORSE_PHASE12_VARIANTS } = await import('../engine/HorsePhase12Authority.js');
  const { HORSE_PHASE14_DOMAINS } = await import('../engine/HorsePhase14Authority.js');
  const incremental = isIncrementalQualificationTarget(target)
    ? incrementalQualificationRules(target)
    : null;
  const store = await hydrateFrozenFeatureAblationStores();
  if (hash(featureQualificationCanonical(store)) !== plan.storeInputsDigest)
    throw Error('Frozen loader identity changed');
  const historyByProfile: Record<string, unknown> = {};
  for (const p of plan.profiles) {
    const records = isIncrementalQualificationTarget(target)
      ? buildIncrementalWarmRecords(p.variant, p.seats, target)
      : target === 'v53_pressure'
        ? buildPressureWarmRecords({
            variant: p.variant,
            seats: p.seats,
            seed: plan.clock.warmSeed,
          })
        : [];
    historyByProfile[p.id] = {
      kind:
        incremental?.historyVersion ??
        (target === 'v53_pressure' ? 'fixed_public_warm_v1' : 'fresh_empty_public_v1'),
      warmSeed: incremental || target === 'v53_pressure' ? plan.clock.warmSeed : null,
      records: records.length,
      digest: featureAblationHistoryDigest(records),
      pooledPublicProfiles: plan.pooledPublicProfiles,
    };
  }
  if (hash(featureQualificationCanonical(historyByProfile)) !== plan.historyDigest)
    throw Error('Fixed public history identity changed');
  const currentAdmissions = () => ({
    phase8: workerDeps.admitPhase8Authority?.(),
    phase10: workerDeps.admitPhase10Authority?.(),
    phase11: Object.fromEntries(
      ['plo5', 'plo6', 'plo8'].map((v) => [v, workerDeps.admitPhase11Authority?.(v as 'plo6')])
    ),
    phase12: Object.fromEntries(
      HORSE_PHASE12_VARIANTS.map((v) => [v, workerDeps.admitPhase12Authority?.(v)])
    ),
    phase13: Object.fromEntries(
      ['nlh', 'plo4', 'plo5', 'plo6'].map((v) => [
        v,
        workerDeps.admitPhase13Authority?.(v as 'plo6'),
      ])
    ),
    phase14: Object.fromEntries(
      HORSE_PHASE14_DOMAINS.map((d) => [d, workerDeps.admitPhase14Attachment?.(d)])
    ),
  });
  const admittedPolicyDigests = (value: unknown, prefix = '', out: Record<string, string> = {}) => {
    if (!value || typeof value !== 'object') return out;
    const x = value as Record<string, unknown>;
    if (x.status === 'admitted' && x.authority && typeof x.authority === 'object') {
      const a = x.authority as { policyDigest?: unknown };
      if (typeof a.policyDigest !== 'string') throw Error('Admitted policy digest missing');
      out[prefix] = a.policyDigest;
      return out;
    }
    for (const [k, v] of Object.entries(x))
      if (v && typeof v === 'object') admittedPolicyDigests(v, prefix ? prefix + '.' + k : k, out);
    return out;
  };
  const bootstrap = Reflect.get(workerDeps, 'publicProfileBootstrap');
  if (typeof bootstrap === 'function' && bootstrap() != null)
    throw Error('Declared empty controlled public pool differs from original bootstrap');
  const admissions = JSON.parse(JSON.stringify(currentAdmissions())),
    policies = admittedPolicyDigests(admissions);
  if (
    hash(featureQualificationCanonical(admissions)) !== plan.admissionDigest ||
    hash(featureQualificationCanonical(policies)) !== plan.policyDigestsDigest ||
    featureQualificationCanonical(policies) !== featureQualificationCanonical(plan.policyDigests)
  )
    throw Error('Actual original admission/policy identity changed');
}
// CLI entry: importing this module never parses arguments or runs the
// contract (the featureAblationDraftPlan.ts pattern), so the preflight
// exports above are testable without touching the provider boundary.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Map<string, string>();
  let planOnly = false;
  let preflightOnly = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--plan') {
      if (planOnly) throw Error('Duplicate plan mode');
      planOnly = true;
      continue;
    }
    if (arg === '--preflight') {
      if (preflightOnly) throw Error('Duplicate preflight mode');
      preflightOnly = true;
      continue;
    }
    const m = /^--(target|source-sha|output|cell)=(.+)$/.exec(arg);
    if (!m || args.has(m[1])) throw Error('Unknown or duplicate contract argument');
    args.set(m[1], m[2]);
  }
  if (preflightOnly && !planOnly) throw Error('Preflight validates the plan boundary; pass --plan');
  if (preflightOnly && args.has('output')) throw Error('Preflight writes no output');
  for (const key of preflightOnly ? ['target', 'source-sha'] : ['target', 'source-sha', 'output'])
    if (!args.has(key)) throw Error('Missing --' + key);
  if (!planOnly && !args.has('cell')) throw Error('Missing registered cell');
  if (planOnly && args.has('cell')) throw Error('Plan mode never selects or deals a cell');
  const {
    assertIncrementalWorkerFlags,
    authenticateIncrementalPlan,
    authenticateFeatureAblationProviderAttempt,
    incrementalQualificationRules,
    isIncrementalQualificationTarget,
  } = await import('../benchmark/IncrementalPressureQualification.js');
  const { buildIncrementalWarmRecords } =
    await import('../benchmark/IncrementalPressureDevelopment.js');
  const {
    qualificationPlan,
    qualificationPlanDigest,
    assertProtectedFeatureAblationSource,
    validateFeatureAblationCell,
    featureQualificationCanonical,
  } = await import('../benchmark/FeatureAblationQualification.js');
  const { hydrateFrozenFeatureAblationStores } =
    await import('../benchmark/FeatureAblationStores.js');
  const { buildPressureWarmRecords, makeFeatureAblationOwnHistory, featureAblationHistoryDigest } =
    await import('../benchmark/FeatureAblationHistory.js');
  const { createFeatureAblationWorker } = await import('../benchmark/FeatureAblationWorker.js');
  const { V53_PRESSURE_POPULATION } = await import('../benchmark/V53PressurePopulation.js');
  const { getFullRakeConfig } = await import('../config/RakeConfig.js');
  const { horseObserverReadContextFromRequest } =
    await import('../engine/HorseObserverReadContext.js');
  const { enableBrainTelemetry } = await import('../engine/BrainTelemetry.js');
  const { channelHub } = await import('../hub/ChannelHub.js');
  try {
    const { defaultHorseDecisionWorkerDependencies: deps } =
      await import('../engine/horseDecision/workerRuntime.js');
    const { HORSE_PHASE12_VARIANTS } = await import('../engine/HorsePhase12Authority.js');
    const { HORSE_PHASE14_DOMAINS } = await import('../engine/HorsePhase14Authority.js');
    const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
    const target = args.get('target') as FeatureAblationTarget,
      sourceSha = args.get('source-sha')!;
    if (preflightOnly) {
      const verdict = await runQualificationPreflight({ target, sourceSha }, {});
      console.log(JSON.stringify(verdict));
      process.exitCode = verdict.ok ? 0 : 1;
    } else {
      const plan = qualificationPlan(target),
        planDigest = qualificationPlanDigest(plan);
      const source = assertProtectedFeatureAblationSource(plan, sourceSha);
      await authenticateIncrementalPlan(plan, args.get('cell'));
      const incremental = isIncrementalQualificationTarget(target)
        ? incrementalQualificationRules(target)
        : null;
      const store = await hydrateFrozenFeatureAblationStores();
      if (hash(featureQualificationCanonical(store)) !== plan.storeInputsDigest)
        throw Error('Frozen loader identity changed');
      const warmByProfile = new Map<string, ReturnType<typeof buildPressureWarmRecords>>();
      const historyByProfile: Record<string, unknown> = {};
      for (const p of plan.profiles) {
        const records = isIncrementalQualificationTarget(target)
          ? buildIncrementalWarmRecords(p.variant, p.seats, target)
          : target === 'v53_pressure'
            ? buildPressureWarmRecords({
                variant: p.variant,
                seats: p.seats,
                seed: plan.clock.warmSeed,
              })
            : [];
        warmByProfile.set(p.id, records);
        historyByProfile[p.id] = {
          kind:
            incremental?.historyVersion ??
            (target === 'v53_pressure' ? 'fixed_public_warm_v1' : 'fresh_empty_public_v1'),
          warmSeed: incremental || target === 'v53_pressure' ? plan.clock.warmSeed : null,
          records: records.length,
          digest: featureAblationHistoryDigest(records),
          pooledPublicProfiles: plan.pooledPublicProfiles,
        };
      }
      if (hash(featureQualificationCanonical(historyByProfile)) !== plan.historyDigest)
        throw Error('Fixed public history identity changed');
      function currentAdmissions() {
        return {
          phase8: deps.admitPhase8Authority?.(),
          phase10: deps.admitPhase10Authority?.(),
          phase11: Object.fromEntries(
            ['plo5', 'plo6', 'plo8'].map((v) => [v, deps.admitPhase11Authority?.(v as 'plo6')])
          ),
          phase12: Object.fromEntries(
            HORSE_PHASE12_VARIANTS.map((v) => [v, deps.admitPhase12Authority?.(v)])
          ),
          phase13: Object.fromEntries(
            ['nlh', 'plo4', 'plo5', 'plo6'].map((v) => [
              v,
              deps.admitPhase13Authority?.(v as 'plo6'),
            ])
          ),
          phase14: Object.fromEntries(
            HORSE_PHASE14_DOMAINS.map((d) => [d, deps.admitPhase14Attachment?.(d)])
          ),
        };
      }
      function admittedPolicyDigests(
        value: unknown,
        prefix = '',
        out: Record<string, string> = {}
      ) {
        if (!value || typeof value !== 'object') return out;
        const x = value as Record<string, unknown>;
        if (x.status === 'admitted' && x.authority && typeof x.authority === 'object') {
          const a = x.authority as { policyDigest?: unknown };
          if (typeof a.policyDigest !== 'string') throw Error('Admitted policy digest missing');
          out[prefix] = a.policyDigest;
          return out;
        }
        for (const [k, v] of Object.entries(x))
          if (v && typeof v === 'object')
            admittedPolicyDigests(v, prefix ? prefix + '.' + k : k, out);
        return out;
      }
      function verifyAdmissions() {
        const bootstrap = Reflect.get(deps, 'publicProfileBootstrap');
        if (typeof bootstrap === 'function' && bootstrap() != null)
          throw Error('Declared empty controlled public pool differs from original bootstrap');
        const a = JSON.parse(JSON.stringify(currentAdmissions())),
          policies = admittedPolicyDigests(a);
        if (
          hash(featureQualificationCanonical(a)) !== plan.admissionDigest ||
          hash(featureQualificationCanonical(policies)) !== plan.policyDigestsDigest ||
          featureQualificationCanonical(policies) !==
            featureQualificationCanonical(plan.policyDigests)
        )
          throw Error('Actual original admission/policy identity changed');
        return a;
      }
      verifyAdmissions();
      const out = resolve(args.get('output')!);
      if (planOnly) {
        await writeFile(out, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
        console.log(
          'MATRIX=' + JSON.stringify({ include: plan.matrix.map((c) => ({ key: c.key })) })
        );
        console.log(JSON.stringify({ target, planDigest, source, heldoutHandsDealt: 0 }));
      } else {
        const cell = plan.matrix.find((c) => c.key === args.get('cell'));
        if (!cell) throw Error('Unknown registered cell');
        const profile = plan.profiles.find((p) => p.id === cell.profileId)!;
        const attempt = JSON.parse(await readFile(resolve(out, 'attempt.json'), 'utf8'));
        const bindings = {
          policyDigestsDigest: plan.policyDigestsDigest,
          dependencyDigest: plan.dependencyDigest,
          storeInputsDigest: plan.storeInputsDigest,
          admissionDigest: plan.admissionDigest,
          historyDigest: plan.historyDigest,
        };
        const expected = { planDigest, target, sourceSha, ...bindings, cell };
        if (
          attempt.schema !== 'horse-feature-ablation-attempt-v1' ||
          attempt.cellKey !== cell.key ||
          attempt.exitCode !== null ||
          featureQualificationCanonical(attempt.identity) !==
            featureQualificationCanonical(expected)
        )
          throw Error('Original pre-deal attempt binding refused');
        let authorized: Promise<void> | undefined;
        const authorizedGuard = () =>
          (authorized ??= (async () => {
            assertProtectedFeatureAblationSource(plan, sourceSha);
            verifyAdmissions();
            await authenticateFeatureAblationProviderAttempt(
              attempt.operation,
              cell.key,
              plan.maxAttempts
            );
          })());
        await authorizedGuard(); // The mandatory private-core wrapper repeats this guard before dealing.
        const physicalRake = getFullRakeConfig(1, 2, profile.variant);
        const physical = {
          id: profile.id,
          variant: profile.variant,
          seats: profile.seats,
          stackBB: profile.stackBB,
          tableSeats: 6,
          publishedRake: true,
          productionStyles: true,
          moodClock: 'deal_seed_time_of_day' as const,
          rakePercent: physicalRake.rakePercent,
          rakeCapBB: physicalRake.rakeCap / 2,
          anteBB: 0,
          straddle: false,
          tournament: false,
          opponentStyle: 'balanced' as const,
        };
        const receiptHash = createHash('sha256'),
          samples: unknown[] = [];
        let receiptCount = 0,
          interrupted = false;
        process.once('SIGINT', () => {
          interrupted = true;
        });
        process.once('SIGTERM', () => {
          interrupted = true;
        });
        const historyCache = new Map<string, ReturnType<typeof makeFeatureAblationOwnHistory>>();
        enableBrainTelemetry();
        const brain = createFeatureAblationWorker(
          (r) => {
            if (isIncrementalQualificationTarget(target))
              assertIncrementalWorkerFlags(target, r.inputFlags);
            receiptHash.update(JSON.stringify(r) + '\n');
            receiptCount++;
            if (samples.length < 8) samples.push(r);
          },
          () => {},
          true,
          (request) => {
            const context = horseObserverReadContextFromRequest(request);
            if (!context) throw Error('Original observer context unavailable');
            const key = JSON.stringify(context);
            let packet = historyCache.get(key);
            if (!packet) {
              packet = makeFeatureAblationOwnHistory(
                context,
                request.player.seat,
                warmByProfile.get(profile.id)!
              );
              historyCache.set(key, packet);
            }
            return packet;
          }
        );
        const spec = {
          id: plan.version,
          profile: physical,
          brain,
          candidate: plan.flags.candidate,
          reference: plan.flags.reference,
          ...(incremental
            ? { population: incremental.population }
            : target === 'v53_pressure'
              ? { population: V53_PRESSURE_POPULATION }
              : {}),
        };
        const league = await import('../benchmark/FeatureAblationLeague.js'),
          runContract = Reflect.get(league, 'runFeatureAblationContract');
        if (typeof runContract !== 'function')
          throw Error('Verified contract-only core capability unavailable');
        await mkdir(out, { recursive: true });
        const rawFile = resolve(out, 'raw-pairs.jsonl'),
          raw = await open(rawFile, 'wx'),
          rawHash = createHash('sha256');
        let rawPairCount = 0;
        try {
          const result = await runContract(
            spec,
            {
              seed: cell.seed,
              pairs: cell.pairs,
              startPair: cell.firstPair,
              planDigest,
              cellKey: cell.key,
            },
            authorizedGuard,
            async (row: unknown) => {
              const line = JSON.stringify(row) + '\n';
              await raw.writeFile(line);
              rawHash.update(line);
              rawPairCount++;
            },
            () => !interrupted
          );
          assertProtectedFeatureAblationSource(plan, sourceSha);
          verifyAdmissions();
          const envelope = {
            schema: 'horse-feature-ablation-cell-v1' as const,
            mode: 'contract' as const,
            target,
            cellKey: cell.key,
            sourceSha,
            planDigest,
            ...bindings,
            operation: attempt.operation,
            result,
            rawPairsSha256: rawHash.digest('hex'),
            rawPairCount,
            execution: {
              workerReceiptSha256: receiptHash.digest('hex'),
              workerReceiptCount: receiptCount,
              sampledWorkerReceipts: samples,
            },
          };
          await writeFile(resolve(out, 'result.json'), JSON.stringify(envelope, null, 2) + '\n', {
            flag: 'wx',
          });
          const reasons = validateFeatureAblationCell(plan, cell, envelope);
          if (reasons.length || !result.complete) process.exitCode = 2;
          console.log(
            JSON.stringify({
              target,
              cell: cell.key,
              pairs: result.pairs,
              complete: result.complete,
              reasons,
              qualified: false,
              activationAllowed: false,
              opportunityDenominator: 'not_measured',
              scope:
                'fixed-work FAST semantics; original caller scheduling and production latency not measured',
            })
          );
        } finally {
          await raw.close();
          channelHub.close();
        }
      }
    }
  } finally {
    channelHub.close();
  }
}
