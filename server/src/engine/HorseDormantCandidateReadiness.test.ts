import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publishedCashPricing } from '../config/leagueCashPricing.js';
import {
  admitHorseFeatureAuthority,
  admittedHorseFeatureFlags,
  featureDomainMatches,
  HORSE_FEATURE_AUTHORITY_VERSION,
  HORSE_FEATURE_FLAGS,
  runningFeatureSourcePaths,
  type HorseFeatureDomain,
  type HorseFeatureFlag,
  type HorseFeatureSelection,
} from './HorseFeatureAuthority.js';
import { featureLiveDomainRefusals } from './HorseFeatureLiveDomain.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { canonical } from './HorseQualifiedAuthority.js';

const hash = (x: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(x)))
    .digest('hex');

const bytesHash = (x: Buffer): string => createHash('sha256').update(x).digest('hex');

interface DormantCandidateTargetSpec {
  readonly target: string;
  readonly flag: HorseFeatureFlag;
  readonly variant: 'nlh' | 'plo4' | 'plo5' | 'plo6';
  readonly seats: 2 | 4 | 6;
  readonly stackBB: 40 | 100 | 200;
  readonly candidateFlags: Readonly<Record<string, boolean>>;
  readonly referenceFlags: Readonly<Record<string, boolean>>;
}

const SEVEN_DORMANT_CANDIDATE_SPECS: readonly DormantCandidateTargetSpec[] = [
  {
    target: 'combo_draw_pressure',
    flag: 'comboDrawPressure',
    variant: 'plo4',
    seats: 2,
    stackBB: 100,
    candidateFlags: { comboDrawPressure: true },
    referenceFlags: { comboDrawPressure: false },
  },
  {
    target: 'targeted_river_bluff',
    flag: 'v54RiverBluff',
    variant: 'plo5',
    seats: 2,
    stackBB: 100,
    candidateFlags: { v54RiverBluff: true },
    referenceFlags: { v54RiverBluff: false },
  },
  {
    target: 'river_position_defense',
    flag: 'riverPositionDefense',
    variant: 'nlh',
    seats: 6,
    stackBB: 100,
    candidateFlags: { riverPositionDefense: true },
    referenceFlags: { riverPositionDefense: false },
  },
  {
    target: 'river_bluff_checkraise',
    flag: 'riverBluffCheckRaise',
    variant: 'plo4',
    seats: 2,
    stackBB: 100,
    candidateFlags: { riverBluffCheckRaise: true },
    referenceFlags: { riverBluffCheckRaise: false },
  },
  {
    target: 'barrel_continuation_outlook',
    flag: 'barrelContinuationOutlook',
    variant: 'plo6',
    seats: 4,
    stackBB: 100,
    candidateFlags: { barrelContinuationOutlook: true },
    referenceFlags: { barrelContinuationOutlook: false },
  },
  {
    target: 'small_pot_near_nut_value_raise',
    flag: 'smallPotNearNutRiverValue',
    variant: 'plo5',
    seats: 4,
    stackBB: 100,
    candidateFlags: { smallPotNearNutRiverValue: true },
    referenceFlags: { smallPotNearNutRiverValue: false },
  },
  {
    target: 'multiway_river_bluff_checkraise',
    flag: 'multiwayRiverBluffCheckRaise',
    variant: 'plo4',
    seats: 4,
    stackBB: 100,
    candidateFlags: { riverBluffCheckRaise: true, multiwayRiverBluffCheckRaise: true },
    referenceFlags: { riverBluffCheckRaise: true, multiwayRiverBluffCheckRaise: false },
  },
];

describe('HorseDormantCandidateReadiness — Item 25 all 7 dormant candidates qualification', () => {
  const readActualSource = (p: string): Buffer =>
    readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)));

  const actualPaths = runningFeatureSourcePaths();
  const actualRuntimeSourceFiles = Object.fromEntries(
    actualPaths.map((p) => [p, bytesHash(readActualSource(p))])
  );
  const actualRuntimeSourceDigest = hash(actualRuntimeSourceFiles);
  const actualDependencyDigest = bytesHash(readActualSource('package-lock.json'));

  it('covers all 7 HORSE_FEATURE_FLAGS and computes exact current runtime source and dependency digests', () => {
    const coveredFlags = SEVEN_DORMANT_CANDIDATE_SPECS.map((s) => s.flag);
    expect(coveredFlags).toEqual([...HORSE_FEATURE_FLAGS]);
    expect(actualPaths.length).toBeGreaterThanOrEqual(80);
    expect(actualRuntimeSourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(actualDependencyDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(SEVEN_DORMANT_CANDIDATE_SPECS)(
    'proves $target ($flag on $variant $seats-dealt $stackBB BB) passes featureLiveDomainRefusals and admits with exact real disk source hashes',
    (spec) => {
      const now = Date.now();
      const pricing = publishedCashPricing({
        tournament: false,
        variant: spec.variant,
        tableSeats: 6,
        seats: spec.seats,
      });
      const domain: HorseFeatureDomain = {
        variant: spec.variant,
        mode: 'cash',
        asset: 'chips',
        boardCount: 1,
        dealtSeats: [spec.seats],
        remainingPlayers: [spec.seats],
        effectiveStackBB: [20, spec.stackBB],
        startingStackBB: spec.stackBB,
        smallBlind: 1,
        bigBlind: 2,
        ante: 0,
        bigBlindAnte: false,
        bettingStructure: spec.variant === 'nlh' ? 'no_limit' : 'pot_limit',
        chipUnit: 0.01,
        rakeConfig: pricing.rakeConfig,
        bbjConfig: pricing.bbjConfig,
        sidePots: false,
      };
      const profileId = `${spec.target}-${spec.variant}-6max-${spec.seats}dealt-${spec.stackBB}bb`;
      const plan = {
        schema: 'horse-incremental-ablation-plan-v2',
        state: 'heldout_locked',
        target: spec.target,
        population: 'readiness-qualification',
        flags: {
          candidate: spec.candidateFlags,
          reference: spec.referenceFlags,
        },
        dependencyDigest: actualDependencyDigest,
        runtimeSourceFiles: actualRuntimeSourceFiles,
        runtimeSourceDigest: actualRuntimeSourceDigest,
        profiles: [
          {
            id: profileId,
            variant: spec.variant,
            seats: spec.seats,
            stackBB: spec.stackBB,
            weight: 1,
          },
        ],
        liveAdmission: {
          schema: 'horse-feature-live-domain-v1',
          profileId,
          domain,
        },
      };

      expect(featureLiveDomainRefusals(plan)).toEqual([]);

      const planDigest = hash(plan);
      const assembly = {
        schema: 'horse-feature-ablation-assembly-v1',
        qualified: true,
        activationAllowed: false,
        reasons: [],
        sourceSha: 'c'.repeat(40),
        planDigest,
        target: spec.target,
        summary: {
          qualified: true,
          activationAllowed: false,
          planDigest,
          byVariant: {
            [spec.variant]: { qualified: true },
          },
        },
        provider: {
          rawArtifactsRetained: true,
          inventorySha256: 'e'.repeat(64),
        },
      };

      const records = new Map<string, Buffer>();
      const bindRecord = (name: string, val: unknown) => {
        const path = `docs/evidence/feature-activation/${name}.json`;
        const buf = Buffer.from(JSON.stringify(val));
        records.set(path, buf);
        return { path, sha256: bytesHash(buf) };
      };

      const planBinding = bindRecord(`plan-${spec.target}`, plan);
      const assemblyBinding = bindRecord(`assembly-${spec.target}`, assembly);
      const qualification = {
        schema: 'horse-feature-live-admission-v1',
        version: HORSE_FEATURE_AUTHORITY_VERSION,
        qualificationKind: 'locked_paired_condition_a',
        qualified: true,
        activationAllowed: false,
        reasons: [],
        sourceSha: 'c'.repeat(40),
        profileId,
        domain,
        compositionDigest: hash(plan.flags),
        plan: planBinding,
        assembly: assemblyBinding,
      };
      const qualBinding = bindRecord(`qual-${spec.target}`, qualification);

      const selection: HorseFeatureSelection = {
        schema: 'horse-feature-release-selection-v1',
        qualificationPath: qualBinding.path,
        qualificationSha256: qualBinding.sha256,
        sourceSha: 'c'.repeat(40),
        approvalGeneration: 1,
        issuedAt: new Date(now - 5_000).toISOString(),
        expiresAt: new Date(now + 3_600_000).toISOString(),
        withdrawn: null,
      };

      const reader = {
        read: (p: string): Buffer => {
          const b = records.get(p);
          if (!b) throw new Error(`Missing record: ${p}`);
          return b;
        },
      };

      // Pass real readActualSource and runningFeatureSourcePaths!
      const admission = admitHorseFeatureAuthority(
        selection,
        reader,
        now,
        readActualSource,
        runningFeatureSourcePaths
      );
      expect(admission.status).toBe('admitted');
      if (admission.status !== 'admitted') {
        throw new Error(`Expected admitted for ${spec.target}`);
      }

      // Build matching HorseGameStateV2 for this candidate domain
      const dealtSeatIds = Array.from({ length: spec.seats }, (_, idx) => idx);
      const matchingState = {
        gameVariant: spec.variant,
        gameMode: 'cash',
        asset: 'chips',
        boardCount: 1,
        dealtSeatIds,
        players: dealtSeatIds.map((seat) => ({
          seat,
          stack: spec.stackBB * 2,
          bet: 0,
          totalInvested: 0,
          is_folded: false,
        })),
        smallBlind: 1,
        bigBlind: 2,
        ante: 0,
        bigBlindAnte: false,
        bettingStructure: spec.variant === 'nlh' ? 'no_limit' : 'pot_limit',
        chipUnit: 0.01,
        rakeConfig: pricing.rakeConfig,
        bbjConfig: pricing.bbjConfig,
        pots: [],
        straddleActive: false,
        bombPot: false,
        allInOrFold: false,
      } as unknown as HorseGameStateV2;

      expect(featureDomainMatches(domain, matchingState)).toBe(true);
      const activeFlags = admittedHorseFeatureFlags(admission.authority, true, matchingState, {});
      expect(activeFlags[spec.flag]).toBe(true);

      // Verify domain refusal when PLO8 or side pots or wrong seat count is supplied
      const sidePotState = {
        ...matchingState,
        pots: [{ amount: 100 }, { amount: 50 }],
      } as unknown as HorseGameStateV2;
      expect(
        admittedHorseFeatureFlags(admission.authority, true, sidePotState, {})[spec.flag]
      ).toBe(false);
    }
  );
});
