/**
 * riverPositionDefense held-out plan: bind and verify (100bb heads-up NLH cash).
 * Plan doc: docs/horse-measure/2026-11-08/river-position-defense-heldout-plan.md
 *
 * Run from server/ with the server's own tsx:
 *   BIND (once, on a clean branch whose HEAD is exactly <POST_10048_SHA>):
 *     npx tsx ../docs/horse-measure/2026-11-08/river-position-defense-heldout/register-plan.mts \
 *       --bind --baseline=<POST_10048_SHA> --anchor-run-id=42447773710 \
 *       --anchor-run-number=1 --workflow-id=398426971
 *   VERIFY (read-only, at any later commit, before every dispatch):
 *     npx tsx ../docs/horse-measure/2026-11-08/river-position-defense-heldout/register-plan.mts --verify
 *
 * --bind writes the plan into IncrementalPressureQualificationPlans.json and
 * family 283 into IncrementalPressureQualificationFamilies.json, nothing else.
 * --verify recomputes every pinned input from the bytes in front of it and
 * exits 1 unless the registered plan is reproduced exactly. Neither mode
 * deals a hand, contacts the provider or changes a flag. The digest
 * computations mirror server/src/scripts/featureAblationQualify.ts.
 */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'feature-ablation-offline-placeholder';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const mode = process.argv.includes('--bind') ? 'bind' : process.argv.includes('--verify') ? 'verify' : null;
if (!mode) throw Error('pass --bind or --verify');
const root = process.cwd();
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const imp = (p: string) => import(root + '/' + p);
const planPath = root + '/src/benchmark/IncrementalPressureQualificationPlans.json';
const famPath = root + '/src/benchmark/IncrementalPressureQualificationFamilies.json';
const target = 'river_position_defense';
const FAMILY = '283';
const head = git('rev-parse', 'HEAD');
if (git('status', '--porcelain', '--untracked-files=no')) throw Error('tracked tree is dirty');
const registered = JSON.parse(readFileSync(planPath, 'utf8'));
const registeredFamilies = JSON.parse(readFileSync(famPath, 'utf8'));
let baseline: string;
if (mode === 'bind') {
  baseline = arg('baseline') ?? '';
  if (!/^[0-9a-f]{40}$/.test(baseline)) throw Error('--baseline=<full 40-char POST_10048_SHA> required');
  if (head !== baseline) throw Error(`HEAD ${head} is not the baseline ${baseline}`);
  // Protected main must contain the baseline. --rehearse (local dry runs on an
  // unmerged head only; never for a registration that is pushed) skips this.
  if (!process.argv.includes('--rehearse')) git('merge-base', '--is-ancestor', head, 'origin/main');
  if (registered[target] !== undefined) throw Error('a river_position_defense plan is already registered');
  if (registeredFamilies[FAMILY] !== undefined) throw Error('family 283 is already registered');
  for (const k of ['anchor-run-id', 'anchor-run-number', 'workflow-id'])
    if (!/^\d+$/.test(arg(k) ?? '')) throw Error(`--${k} required`);
} else {
  if (!registered[target]) throw Error('no registered river_position_defense plan to verify');
  baseline = registered[target].baselineReferenceRevision;
  git('merge-base', '--is-ancestor', baseline, head);
}
// Requires #10048 (domain-scoped, closure-bound qualification): without it this import fails.
const { featureAuthorityClosure } = await imp('src/engine/HorseFeatureAuthority.ts');
const FAQ = await imp('src/benchmark/FeatureAblationQualification.ts');
const IPQ = await imp('src/benchmark/IncrementalPressureQualification.ts');
const IPD = await imp('src/benchmark/IncrementalPressureDevelopment.ts');
const { hydrateFrozenFeatureAblationStores } = await imp('src/benchmark/FeatureAblationStores.ts');
const { featureAblationHistoryDigest } = await imp('src/benchmark/FeatureAblationHistory.ts');
const { PLO4_STRENGTH_CONTRACT } = await imp('src/benchmark/Plo4StrengthContract.ts');
const { publishedCashPricing } = await imp('src/config/leagueCashPricing.ts');
const { defaultHorseDecisionWorkerDependencies: deps } = await imp('src/engine/horseDecision/workerRuntime.ts');
const { HORSE_PHASE12_VARIANTS } = await imp('src/engine/HorsePhase12Authority.ts');
const { HORSE_PHASE14_DOMAINS } = await imp('src/engine/HorsePhase14Authority.ts');
const canon = FAQ.featureQualificationCanonical;
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const rules = IPQ.incrementalQualificationRules(target);
// 3 held-out seeds x 12 cells x 4 rotation blocks of 576 pairs = 82,944 pairs.
const BLOCKS_PER_SEED = 48,
  BLOCKS_PER_CELL = 4;
const devProfile = IPD.incrementalDevelopmentProfiles(target, 'nlh').find(
  (p: any) => p.seats === 2 && p.stackBB === 100
);
const profile = { id: devProfile.id, variant: 'nlh', seats: 2, stackBB: 100, weight: 1 };
// Source binding: exactly the decision closure, recomputed from these bytes.
const runtimeSourceFiles = Object.fromEntries(
  featureAuthorityClosure((p: string) => readFileSync(root + '/' + p)).map((p: string) => [
    p,
    hash(readFileSync(root + '/' + p)),
  ])
);
const records = IPD.buildIncrementalWarmRecords('nlh', 2, target);
const historyByProfile = {
  [profile.id]: {
    kind: rules.historyVersion,
    warmSeed: rules.warmSeed,
    records: records.length,
    digest: featureAblationHistoryDigest(records),
    pooledPublicProfiles: { kind: 'empty_for_local_simulation', bootstrap: null, profiles: 0 },
  },
};
const store = await hydrateFrozenFeatureAblationStores();
const admissions = JSON.parse(
  JSON.stringify({
    phase8: deps.admitPhase8Authority?.(),
    phase10: deps.admitPhase10Authority?.(),
    phase11: Object.fromEntries(['plo5', 'plo6', 'plo8'].map((v) => [v, deps.admitPhase11Authority?.(v)])),
    phase12: Object.fromEntries(HORSE_PHASE12_VARIANTS.map((v: string) => [v, deps.admitPhase12Authority?.(v)])),
    phase13: Object.fromEntries(['nlh', 'plo4', 'plo5', 'plo6'].map((v) => [v, deps.admitPhase13Authority?.(v)])),
    phase14: Object.fromEntries(HORSE_PHASE14_DOMAINS.map((d: string) => [d, deps.admitPhase14Attachment?.(d)])),
  })
);
function admittedPolicyDigests(value: any, prefix = '', out: Record<string, string> = {}) {
  if (!value || typeof value !== 'object') return out;
  if (value.status === 'admitted' && value.authority && typeof value.authority === 'object') {
    if (typeof value.authority.policyDigest !== 'string') throw Error('Admitted policy digest missing');
    out[prefix] = value.authority.policyDigest;
    return out;
  }
  for (const [k, v] of Object.entries(value))
    if (v && typeof v === 'object') admittedPolicyDigests(v, prefix ? prefix + '.' + k : k, out);
  return out;
}
const policyDigests = admittedPolicyDigests(admissions);
const matrix = rules.seeds.flatMap((seed: number) =>
  Array.from({ length: BLOCKS_PER_SEED / BLOCKS_PER_CELL }, (_, i) => ({
    key: `rpd-nlh-2d-100bb-s${seed}-c${String(i).padStart(2, '0')}`,
    profileId: profile.id,
    variant: 'nlh',
    seed,
    shard: i,
    firstPair: i * BLOCKS_PER_CELL * 576,
    pairs: BLOCKS_PER_CELL * 576,
  }))
);
const pricing = publishedCashPricing({ variant: 'nlh', tournament: false, seats: 2, tableSeats: 6 });
const plan: any = {
  schema: 'horse-incremental-ablation-plan-v2',
  version: 'horse-river-position-defense-nlh-2dealt-100bb-closure-v1',
  state: 'heldout_locked',
  target,
  admittedDomain: { schema: 'horse-feature-admitted-domain-v1', variant: 'nlh', dealtSeats: 2, stackBB: 100 },
  sourceBinding: 'horse-decision-closure-v1',
  liveAdmission: {
    schema: 'horse-feature-live-domain-v1',
    profileId: profile.id,
    domain: {
      variant: 'nlh', mode: 'cash', asset: 'chips', chipUnit: 0.01, boardCount: 1,
      smallBlind: 1, bigBlind: 2, ante: 0, bigBlindAnte: false, bettingStructure: 'no_limit',
      sidePots: false, dealtSeats: [2], remainingPlayers: [2], startingStackBB: 100,
      effectiveStackBB: [0, 100], rakeConfig: pricing.rakeConfig, bbjConfig: pricing.bbjConfig,
    },
  },
  dealSampler: 'sha256-profile-seed-index-v1',
  baselineReferenceRevision: baseline,
  runtimeSourceFiles,
  runtimeSourceDigest: hash(canon(runtimeSourceFiles)),
  policyDigests,
  policyDigestsDigest: hash(canon(policyDigests)),
  dependencyDigest: hash(readFileSync(root + '/package-lock.json')),
  storeInputsDigest: hash(canon(store)),
  admissionDigest: hash(canon(admissions)),
  historyDigest: hash(canon(historyByProfile)),
  maxAttempts: 3,
  pooledPublicProfiles: { kind: 'empty_for_local_simulation', bootstrap: null, profiles: 0 },
  flags: rules.flags,
  population: rules.population.id,
  clock: { policyDateMs: Date.UTC(2026, 9, 26), publicHistoryAvailableAtMs: Date.UTC(2026, 9, 25, 23), warmSeed: rules.warmSeed },
  profiles: [profile],
  heldoutSeeds: rules.seeds,
  matrix,
  interval: PLO4_STRENGTH_CONTRACT.interval,
  thresholds: { primaryLowerBoundAboveBb100: 0, eachSeedPointEstimateAboveBb100: 0, everyCriticalCellLowerBoundAtLeastBb100: -10 },
  criticalCells: ['profile', 'relative_position', 'depth'],
  coverage: {
    opportunityDenominator: 'not_measured',
    byProfile: {
      [profile.id]: {
        // Pilot 27301101: 2,378 hero decisions and 50 accepted calls per 576 pairs,
        // so about 342,000 and 7,200 are expected; the minimums are under a third.
        candidateHeroDecisionsMinimum: 100000,
        referenceHeroDecisionsMinimum: 100000,
        acceptedHeroContrastsMinimum: 2400,
        evaluationCounterMinimums: { river_position_defense_accepted: 2400 },
      },
    },
  },
};
const reasons = FAQ.validateLockedFeatureAblationPlan(plan);
const live = FAQ.featureLiveDomainRefusals(plan);
if (reasons.length || live.length) throw Error('plan invalid: ' + [...reasons, ...live].join(','));
const planDigest = FAQ.qualificationPlanDigest(plan);
const summary = {
  mode,
  head,
  baseline,
  closureFiles: Object.keys(runtimeSourceFiles).length,
  runtimeSourceDigest: plan.runtimeSourceDigest,
  dependencyDigest: plan.dependencyDigest,
  storeInputsDigest: plan.storeInputsDigest,
  admissionDigest: plan.admissionDigest,
  policyDigestsDigest: plan.policyDigestsDigest,
  historyDigest: plan.historyDigest,
  policies: Object.keys(policyDigests).length,
  cells: matrix.length,
  pairs: matrix.reduce((n: number, c: any) => n + c.pairs, 0),
  planDigest,
};
if (mode === 'verify') {
  const want = registered[target];
  const drift = [...new Set([...Object.keys(runtimeSourceFiles), ...Object.keys(want.runtimeSourceFiles)])]
    .filter((k) => runtimeSourceFiles[k] !== want.runtimeSourceFiles[k])
    .sort();
  const fields = Object.keys({ ...plan, ...want }).filter(
    (k) => JSON.stringify(plan[k]) !== JSON.stringify(want[k])
  );
  let family = 'ok';
  try {
    IPQ.validateIncrementalFamily(want, registered, registeredFamilies);
  } catch (e) {
    family = String((e as Error).message);
  }
  const ok = planDigest === FAQ.qualificationPlanDigest(want) && !drift.length && !fields.length && family === 'ok';
  console.log(JSON.stringify({ ...summary, ok, changedFields: fields, closureDrift: drift, family }));
  process.exit(ok ? 0 : 1);
}
// --bind: family 283 gets exactly one member, fixed now (one-shot, see the plan doc).
const digest = (value: unknown): string => {
  const c = (v: any): string =>
    Array.isArray(v)
      ? '[' + v.map(c).join(',') + ']'
      : v && typeof v === 'object'
        ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + c(v[k])).join(',') + '}'
        : JSON.stringify(v);
  return createHash('sha256').update(c(value)).digest('hex');
};
const registry = { ...registered, [target]: plan };
const families = {
  ...registeredFamilies,
  [FAMILY]: {
    schema: 'horse-incremental-crn-family-v1',
    members: [{ target, planDigest: digest(plan) }],
    providerAnchor: {
      workflowId: Number(arg('workflow-id')),
      baselineRunId: Number(arg('anchor-run-id')),
      baselineRunNumber: Number(arg('anchor-run-number')),
    },
    runtimeSourceDigest: plan.runtimeSourceDigest,
  },
};
IPQ.validateIncrementalFamily(plan, registry, families);
writeFileSync(planPath, JSON.stringify(registry, null, 2) + '\n');
writeFileSync(famPath, JSON.stringify(families, null, 2) + '\n');
console.log(JSON.stringify(summary));
process.exit(0);
