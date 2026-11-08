/**
 * The near-nut river fixture reaches smallPotNearNutRiverValue through the
 * original decision worker, and production cannot.
 *
 * Reach: every fixture state is inside the skill's own predicate, and with
 * the flag on in the development harness the gate fires on every one of
 * them, in all three Omaha variants. With the flag absent the harness
 * decision equals the production worker's decision exactly (action, amount,
 * natural RNG seed), so the fixture changes nothing but the flag.
 *
 * Unreachability (an implementation defect, recorded, not fixed here): the
 * variant packs do NOT pre-empt the gate, which runs inside the `reference`
 * node before them. The block is the worker's feature admission. Even with a
 * near-nut authority admitted for exactly this declared profile, the
 * worker's domain predicate (HorseFeatureAuthority.featureDomainMatches)
 * refuses every state the skill acts on, for two independent reasons:
 *   - `gs.pots.length <= 1`: facing an uncalled opening river bet the live
 *     pots always carry the bettor-only refundable layer (two layers), the
 *     exact shape the skill itself admits;
 *   - `hash(gs.rakeConfig) === hash(d.rakeConfig)`: the live rake snapshot
 *     carries `cashPolicy`, which a declared domain cannot carry
 *     (featureLiveDomainRefusals pins it to publishedCashPricing).
 * So the worker passes smallPotNearNutRiverValue: false to HorseLogic.decide.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HORSE_FEATURE_AUTHORITY_VERSION,
  HORSE_FEATURE_FLAGS,
  HORSE_FEATURE_SELECTION_PATH,
  admitHorseFeatureReleaseAuthority,
  featureDomainMatches,
  type HorseFeatureDomain,
} from '../engine/HorseFeatureAuthority.js';
import { featureLiveDomainRefusals } from '../engine/HorseFeatureLiveDomain.js';
import { HORSE_POLICY_ORDER } from '../engine/HorsePolicyGraph.js';
import type { HorseQualifiedAuthority } from '../engine/HorseQualifiedAuthority.js';
import type { HorseGameStateV2 } from '../engine/HorseLogic.js';
import { defaultHorseDecisionWorkerDependencies } from '../engine/horseDecision/workerRuntime.js';
import {
  NEAR_NUT_FIXTURE_VARIANTS,
  decideNearNutRiver,
  measureNearNutReach,
  nearNutDeclaredPricing,
  nearNutRiverState,
  type NearNutFixtureVariant,
} from './NearNutRiverFixture.js';

/** States per variant. Each decision runs three arms through the real worker. */
const N = 60;
/** Stated floor: the fraction of fixture states whose gate must fire, flag on. */
const MIN_REACH = 0.95;

describe('near-nut river fixture reaches the gate through the original worker', () => {
  it.each(NEAR_NUT_FIXTURE_VARIANTS)(
    '%s heads-up 100bb cash: gate reached, flag-off equals production',
    async (variant) => {
      const { row, on } = await measureNearNutReach(variant, N);
      console.log(
        `[near-nut fixture] ${variant} n=${row.states} inDomain=${row.inDomain} ` +
          `reach=${row.gateReached}/${row.states} (${((100 * row.gateReached) / row.states).toFixed(1)}%) ` +
          `skillRaised=${row.skillRaised} flatException=${row.flatException} accepted=${row.accepted} ` +
          `changedVsOff=${row.changed} offEqualsProduction=${row.offEqualsProduction} ` +
          `supersededBy=${JSON.stringify(row.supersededBy)} variantPolicy=${JSON.stringify(row.variantPolicy)}`
      );
      // Every dealt state is inside the skill's own predicate.
      expect(row.inDomain).toBe(N);
      // The gate is reached (an in-domain receipt) on at least the stated fraction.
      expect(row.gateReached / N).toBeGreaterThanOrEqual(MIN_REACH);
      // The qualification evaluation counter is produced from accepted actions.
      expect(row.accepted).toBeGreaterThan(0);
      expect(row.accepted).toBe(row.skillRaised);
      // Flag absent: the harness decision IS the production decision.
      expect(row.offEqualsProduction).toBe(N);
      expect(row.productionReceipts).toBe(0);
      // Paired on the production seed, the flag changes a decision only
      // through its own raise or the PLO6 flat exception.
      expect(row.changed).toBeLessThanOrEqual(row.skillRaised + row.flatException);
      expect(row.changed).toBeGreaterThan(0);
      // The skill's raise is the reference node's own choice (graph node 0).
      expect(HORSE_POLICY_ORDER[0]).toBe('reference');
      expect(HORSE_POLICY_ORDER.indexOf('variant_policy')).toBeGreaterThan(0);
      for (const d of on.filter((x) => x.skillRaised)) expect(d.referenceAction).toBe('raise');
      if (variant !== 'plo6') expect(row.flatException).toBe(0);
    },
    120_000
  );

  it('is deterministic: the same state and decision on every run', async () => {
    const a = nearNutRiverState('plo5', 7);
    const b = nearNutRiverState('plo5', 7);
    expect(b.snapshot.decisionKey).toBe(a.snapshot.decisionKey);
    const x = await decideNearNutRiver(a, 'on');
    const y = await decideNearNutRiver(b, 'on');
    expect([y.result.decision.action, y.result.decision.amount]).toEqual([
      x.result.decision.action,
      x.result.decision.amount,
    ]);
  });
});

/** A declared near-nut domain for this exact profile that the live-domain
 * validator accepts, and a synthetic admitted authority carrying it. */
function admittedNearNut(variant: NearNutFixtureVariant) {
  const pricing = nearNutDeclaredPricing(variant);
  const domain: HorseFeatureDomain = {
    variant,
    mode: 'cash',
    asset: 'chips',
    boardCount: 1,
    dealtSeats: [2],
    remainingPlayers: [2],
    effectiveStackBB: [20, 100],
    startingStackBB: 100,
    smallBlind: 1,
    bigBlind: 2,
    ante: 0,
    bigBlindAnte: false,
    bettingStructure: 'pot_limit',
    chipUnit: 0.01,
    rakeConfig: pricing.rakeConfig,
    bbjConfig: pricing.bbjConfig,
    sidePots: false,
  };
  const profileId = `small_pot_near_nut_value_raise-${variant}-6max-2dealt-100bb`;
  const plan = {
    schema: 'horse-incremental-ablation-plan-v2',
    state: 'heldout_locked',
    target: 'small_pot_near_nut_value_raise',
    profiles: [{ id: profileId, variant, seats: 2, stackBB: 100, weight: 1 }],
    liveAdmission: { schema: 'horse-feature-live-domain-v1', profileId, domain },
  };
  const authority: HorseQualifiedAuthority = Object.freeze({
    schema: 'horse-qualified-authority-v1',
    phase: 'features',
    sourceSha: 'c'.repeat(40),
    continuationVersion: HORSE_FEATURE_AUTHORITY_VERSION,
    policyDigest: 'd'.repeat(64),
    packId: 'small_pot_near_nut_value_raise',
    domain: 'e'.repeat(64),
    evidencePath: 'docs/evidence/feature-activation/near-nut-fixture.json',
    evidenceSha256: 'f'.repeat(64),
    approvalGeneration: 1,
    issuedAt: '2026-11-08T00:00:00.000Z',
    expiresAt: null,
    featureFlags: {
      ...(Object.fromEntries(HORSE_FEATURE_FLAGS.map((k) => [k, false])) as Record<
        (typeof HORSE_FEATURE_FLAGS)[number],
        boolean
      >),
      smallPotNearNutRiverValue: true,
    },
    featureDomain: domain,
    featureCompositionDigest: 'a'.repeat(64),
    authorityKey: 'b'.repeat(64),
  });
  return { domain, plan, authority };
}

describe('production PLO cash rivers cannot reach the near-nut gate', () => {
  it('the release ships no feature selection, so the flag is off', () => {
    const selection = fileURLToPath(
      new URL(`../../../${HORSE_FEATURE_SELECTION_PATH}`, import.meta.url)
    );
    expect(existsSync(selection)).toBe(false);
    expect(admitHorseFeatureReleaseAuthority()).toEqual({
      status: 'refused',
      reason: 'unselected',
      transient: false,
    });
  });

  it.each(NEAR_NUT_FIXTURE_VARIANTS)(
    '%s: an admitted near-nut authority is still refused by the worker domain predicate',
    async (variant) => {
      const { domain, plan, authority } = admittedNearNut(variant);
      expect(featureLiveDomainRefusals(plan)).toEqual([]);
      for (let i = 0; i < 12; i++) {
        const state = nearNutRiverState(variant, i);
        const gs = state.snapshot.gameState;
        expect(state.inDomain).toBe(true);
        // The two refusing conjuncts, named. Each alone still refuses.
        expect(gs.pots?.length).toBe(2);
        expect(gs.pots?.[1]?.eligiblePlayers).toHaveLength(1);
        expect(gs.rakeConfig?.cashPolicy).toEqual({ version: 1, scope: 'standard' });
        const { cashPolicy: _c, ...rakeWithout } = gs.rakeConfig!;
        const onePot = [
          {
            amount: Math.round(gs.pots!.reduce((n, p) => n + p.amount, 0) * 100) / 100,
            eligiblePlayers: [...gs.pots![0].eligiblePlayers],
          },
        ];
        const patched = (p: Partial<HorseGameStateV2>) => ({ ...gs, ...p }) as HorseGameStateV2;
        expect(featureDomainMatches(domain, gs)).toBe(false);
        expect(featureDomainMatches(domain, patched({ rakeConfig: rakeWithout }))).toBe(false);
        expect(featureDomainMatches(domain, patched({ pots: onePot }))).toBe(false);
        expect(
          featureDomainMatches(domain, patched({ rakeConfig: rakeWithout, pots: onePot }))
        ).toBe(true);
        // The original production worker, admitted, on the production snapshot.
        const seen: unknown[] = [];
        const { result, fires } = await decideNearNutRiver(state, 'production', {
          admitFeatureAuthority: () => ({ status: 'admitted', authority }),
          decide: (p, g, s, m, o, rc, pr) => {
            seen.push(o?.smallPotNearNutRiverValue);
            return defaultHorseDecisionWorkerDependencies.decide(p, g, s, m, o, rc, pr);
          },
        });
        expect(seen).toEqual([false]);
        expect(result.decision.featureAuthority).toBeUndefined();
        expect(Object.keys(fires).filter((k) => k.startsWith('small_pot_near_nut_value_'))).toEqual(
          []
        );
      }
    },
    60_000
  );
});
