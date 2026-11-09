/** Draft (never register) a domain-scoped, closure-bound held-out plan for one
 * incremental feature target, with every binding recomputed from the bytes in
 * front of it. It deals no seed, reads no registry, writes no registry and
 * touches no provider: the output is a review artifact. Registration remains a
 * separate protected change of IncrementalPressureQualificationPlans.json and
 * its CRN family, made from protected main only.
 *
 *   npx tsx src/scripts/featureAblationDraftPlan.ts --design=<design.json> --output=<plan.json>
 *
 * The design file fixes the scientific choices (profile, pairs, cell size,
 * coverage minimums) so they are reviewed as data, not edited into code. */
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL ??= 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'feature-ablation-offline-placeholder';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HeldoutPlanDesign {
  schema: 'horse-heldout-plan-design-v1';
  target: string;
  version: string;
  variant: 'nlh' | 'plo4' | 'plo5' | 'plo6';
  dealtSeats: 2 | 4 | 6;
  stackBB: 40 | 100 | 200;
  pairsPerSeed: number;
  pairsPerCell: number;
  maxAttempts: number;
  coverageMinimums: {
    candidateHeroDecisionsMinimum: number;
    referenceHeroDecisionsMinimum: number;
    acceptedHeroContrastsMinimum: number;
    evaluationCounterMinimum: number;
  };
}

const ROTATION = 576;

export function draftMatrix(
  profileId: string,
  variant: string,
  seeds: readonly number[],
  pairsPerSeed: number,
  pairsPerCell: number
) {
  if (pairsPerSeed % ROTATION || pairsPerCell % ROTATION || pairsPerSeed % pairsPerCell)
    throw Error('Pairs must be whole rotation blocks and whole cells');
  const matrix = [];
  for (const seed of seeds)
    for (let shard = 0; shard * pairsPerCell < pairsPerSeed; shard++)
      matrix.push({
        key: `${profileId}-s${seed}-c${shard}`.replace(/[^a-z0-9_-]/g, '-').slice(0, 100),
        profileId,
        variant,
        seed,
        shard,
        firstPair: shard * pairsPerCell,
        pairs: pairsPerCell,
      });
  if (matrix.length > 256) throw Error('Matrix exceeds 256 cells');
  return matrix;
}

const t0 = Date.now();
const step = (s: string) =>
  process.stderr.write(`[draft ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}\n`);
async function main() {
  const args = new Map(
    process.argv.slice(2).map((a) => {
      const m = /^--(design|output)=(.+)$/.exec(a);
      if (!m) throw Error('Unknown argument ' + a);
      return [m[1], m[2]] as const;
    })
  );
  if (!args.has('design') || !args.has('output')) throw Error('Need --design and --output');
  const design: HeldoutPlanDesign = JSON.parse(readFileSync(resolve(args.get('design')!), 'utf8'));
  if (design.schema !== 'horse-heldout-plan-design-v1') throw Error('Unknown design schema');

  const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
  const git = (...a: string[]) =>
    execFileSync('git', a, {
      cwd: serverRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }).trim();
  const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
  const dirty = git(
    'status',
    '--porcelain',
    '--untracked-files=no',
    '--',
    'src',
    'package-lock.json'
  );

  step('imports');
  const q = await import('../benchmark/FeatureAblationQualification.js');
  const inc = await import('../benchmark/IncrementalPressureQualification.js');
  const dev = await import('../benchmark/IncrementalPressureDevelopment.js');
  const { featureAuthorityClosure } = await import('../engine/HorseFeatureAuthority.js');
  const { HORSE_DECISION_CLOSURE_BINDING } = await import('../engine/HorseDecisionClosure.js');
  const { publishedCashPricing } = await import('../config/leagueCashPricing.js');
  const { hydrateFrozenFeatureAblationStores } =
    await import('../benchmark/FeatureAblationStores.js');
  const { featureAblationHistoryDigest } = await import('../benchmark/FeatureAblationHistory.js');
  const { PLO4_STRENGTH_CONTRACT } = await import('../benchmark/Plo4StrengthContract.js');
  const target = design.target as Parameters<typeof inc.incrementalQualificationRules>[0];
  if (!inc.isIncrementalQualificationTarget(target)) throw Error('Not an incremental target');
  const rules = inc.incrementalQualificationRules(target);

  const profile = dev
    .incrementalDevelopmentProfiles(target, design.variant)
    .find((p) => p.seats === design.dealtSeats && p.stackBB === design.stackBB);
  if (!profile) throw Error('Design profile is not a registered development profile');
  const profiles = [
    {
      id: profile.id,
      variant: design.variant,
      seats: design.dealtSeats,
      stackBB: design.stackBB,
      weight: 1,
    },
  ];

  // Exact decision closure, read from tracked bytes only (same rule as admission).
  step('closure');
  const tracked = new Set(git('ls-files', '.').split('\n'));
  const closure = featureAuthorityClosure((rel) => {
    if (!tracked.has(rel)) throw Error('untracked');
    return readFileSync(resolve(serverRoot, rel));
  });
  const runtimeSourceFiles = Object.fromEntries(
    closure.map((rel) => [rel, sha(readFileSync(resolve(serverRoot, rel)))])
  );

  step('store');
  const store = await hydrateFrozenFeatureAblationStores();
  const history: Record<string, unknown> = {};
  for (const p of profiles) {
    const records = dev.buildIncrementalWarmRecords(p.variant, p.seats, target);
    history[p.id] = {
      kind: rules.historyVersion,
      warmSeed: rules.warmSeed,
      records: records.length,
      digest: featureAblationHistoryDigest(records),
      pooledPublicProfiles: { kind: 'empty_for_local_simulation', bootstrap: null, profiles: 0 },
    };
  }

  step('admissions');
  // Original admissions, computed exactly as featureAblationQualify.ts verifies them.
  const { defaultHorseDecisionWorkerDependencies: deps } =
    await import('../engine/horseDecision/workerRuntime.js');
  const { HORSE_PHASE12_VARIANTS } = await import('../engine/HorsePhase12Authority.js');
  const { HORSE_PHASE14_DOMAINS } = await import('../engine/HorsePhase14Authority.js');
  const admissions = JSON.parse(
    JSON.stringify({
      phase8: deps.admitPhase8Authority?.(),
      phase10: deps.admitPhase10Authority?.(),
      phase11: Object.fromEntries(
        ['plo5', 'plo6', 'plo8'].map((v) => [v, deps.admitPhase11Authority?.(v as 'plo6')])
      ),
      phase12: Object.fromEntries(
        HORSE_PHASE12_VARIANTS.map((v) => [v, deps.admitPhase12Authority?.(v)])
      ),
      phase13: Object.fromEntries(
        ['nlh', 'plo4', 'plo5', 'plo6'].map((v) => [v, deps.admitPhase13Authority?.(v as 'plo6')])
      ),
      phase14: Object.fromEntries(
        HORSE_PHASE14_DOMAINS.map((d) => [d, deps.admitPhase14Attachment?.(d)])
      ),
    })
  );
  const policyDigests: Record<string, string> = {};
  (function walk(value: unknown, prefix: string) {
    if (!value || typeof value !== 'object') return;
    const x = value as Record<string, any>;
    if (x.status === 'admitted' && x.authority && typeof x.authority === 'object') {
      if (typeof x.authority.policyDigest !== 'string')
        throw Error('Admitted policy digest missing');
      policyDigests[prefix] = x.authority.policyDigest;
      return;
    }
    for (const [k, v] of Object.entries(x)) walk(v, prefix ? prefix + '.' + k : k);
  })(admissions, '');

  step('assemble');
  const pricing = publishedCashPricing({
    tournament: false,
    variant: design.variant,
    seats: design.dealtSeats,
    tableSeats: 6,
  });
  const canonical = q.featureQualificationCanonical;
  const counter = inc
    .incrementalComponentCoverage(target, design.dealtSeats)
    .filter((c) => c.applicable)
    .map((c) => c.counter);
  const plan = {
    schema: 'horse-incremental-ablation-plan-v2',
    version: design.version,
    state: 'heldout_locked',
    target,
    dealSampler: 'sha256-profile-seed-index-v1',
    baselineReferenceRevision: git('rev-parse', 'HEAD'),
    sourceBinding: HORSE_DECISION_CLOSURE_BINDING,
    runtimeSourceFiles,
    runtimeSourceDigest: sha(canonical(runtimeSourceFiles)),
    policyDigests,
    policyDigestsDigest: sha(canonical(policyDigests)),
    dependencyDigest: sha(readFileSync(resolve(serverRoot, 'package-lock.json'))),
    storeInputsDigest: sha(canonical(store)),
    admissionDigest: sha(canonical(admissions)),
    historyDigest: sha(canonical(history)),
    maxAttempts: design.maxAttempts,
    pooledPublicProfiles: { kind: 'empty_for_local_simulation', bootstrap: null, profiles: 0 },
    flags: rules.flags,
    population: rules.population.id,
    clock: {
      policyDateMs: Date.UTC(2026, 9, 26),
      publicHistoryAvailableAtMs: Date.UTC(2026, 9, 25, 23),
      warmSeed: rules.warmSeed,
    },
    profiles,
    heldoutSeeds: [...rules.seeds],
    matrix: draftMatrix(
      profile.id,
      design.variant,
      rules.seeds,
      design.pairsPerSeed,
      design.pairsPerCell
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
            candidateHeroDecisionsMinimum: design.coverageMinimums.candidateHeroDecisionsMinimum,
            referenceHeroDecisionsMinimum: design.coverageMinimums.referenceHeroDecisionsMinimum,
            acceptedHeroContrastsMinimum: design.coverageMinimums.acceptedHeroContrastsMinimum,
            evaluationCounterMinimums: Object.fromEntries(
              counter.map((c) => [c, design.coverageMinimums.evaluationCounterMinimum])
            ),
          },
        ])
      ),
    },
    admittedDomain: {
      schema: 'horse-feature-admitted-domain-v1',
      variant: design.variant,
      dealtSeats: design.dealtSeats,
      stackBB: design.stackBB,
    },
    liveAdmission: {
      schema: 'horse-feature-live-domain-v1',
      profileId: profile.id,
      domain: {
        variant: design.variant,
        mode: 'cash',
        asset: 'chips',
        boardCount: 1,
        dealtSeats: [design.dealtSeats],
        remainingPlayers: [2],
        effectiveStackBB: [0, design.stackBB],
        startingStackBB: design.stackBB,
        smallBlind: 1,
        bigBlind: 2,
        ante: 0,
        bigBlindAnte: false,
        bettingStructure: design.variant === 'nlh' ? 'no_limit' : 'pot_limit',
        chipUnit: 0.01,
        rakeConfig: pricing.rakeConfig,
        bbjConfig: pricing.bbjConfig,
        sidePots: false,
      },
    },
  };
  const refusals = q.validateLockedFeatureAblationPlan(plan as never);
  const report = {
    schema: 'horse-heldout-plan-draft-v1',
    registrable: refusals.length === 0 && dirty === '',
    sourceRevision: plan.baselineReferenceRevision,
    sourceDirty: dirty !== '',
    refusals,
    planDigest: q.qualificationPlanDigest(plan as never),
    closureFiles: closure.length,
    matrixCells: plan.matrix.length,
    totalPairs: plan.matrix.reduce((n, c) => n + c.pairs, 0),
    seedFamily: inc.incrementalSeedFamily(target),
    heldoutHandsDealt: 0,
    plan,
  };
  writeFileSync(resolve(args.get('output')!), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      registrable: report.registrable,
      refusals,
      planDigest: report.planDigest,
      closureFiles: report.closureFiles,
      matrixCells: report.matrixCells,
      totalPairs: report.totalPairs,
      seedFamily: report.seedFamily,
    })
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
  step('done');
  process.exit(0);
}
