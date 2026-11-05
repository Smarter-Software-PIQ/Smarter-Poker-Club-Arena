import { describe, expect, it } from 'vitest';
import { evaluateEngineReleaseCertificationBundle } from '../../scripts/ci/verify-engine-release-bundle.mjs';

function createValidBundle() {
  const sha = '08e3edee7aaa1ca235403e3812504fd6cf88206c';
  return {
    expectedCommitSha: sha,
    publicHealth: {
      status: 'ok',
      commitSha: sha,
      instanceId: '1-2790e861',
      liveness: {
        status: 'ok',
        wholeFleetStalled: false,
        quarantinedTables: 0,
      },
      maintenance: {
        active: false,
        phase: 'idle',
      },
    },
    sealedReceipt: {
      status: 'SEALED',
      commitSha: sha,
      instanceId: '1-2790e861',
    },
    v3Thaw: {
      platformFrozen: false,
      entryFrozen: false,
      maintenanceRows: 0,
      verifiedDeadlineFamilies: 15,
      countsMatch: true,
    },
    canonicalCensus: {
      commitSha: sha,
      canonicalHorseCount: 1000,
      gamesVerified: ['NLH', 'PLO4', 'PLO5', 'PLO6', 'PLO8'],
      contradictoryBindings: 0,
    },
    naturalFunding: {
      naturalBuyInCount: 14,
      naturalReloadOrTopUpCount: 9,
      boundsViolations: 0,
    },
    resourceWindow: {
      commitSha: sha,
      activeSeconds: 905,
      maxHeapUsedMB: 1340,
      maxRssMB: 5620,
      rssSamples: Array.from({ length: 16 }, (_, i) => ({
        activeSeconds: i * 60,
        rssMb: 5600 + Math.min(i, 6) * 3,
      })),
    },
  };
}

describe('verify-engine-release-bundle (Phase 4 certification verifier)', () => {
  it('certifies a complete bundle where health, SEALED receipt, v3 thaw, 1,000-horse census, funding, and 900s resource proof all pass', () => {
    const res = evaluateEngineReleaseCertificationBundle(createValidBundle());
    expect(res.certified).toBe(true);
    expect(res.failures).toEqual([]);
  });

  it('rejects SHA mismatch, incomplete v3 thaw, missing game variants, or resource budget violations', () => {
    const broken = createValidBundle();
    broken.sealedReceipt.commitSha = 'eed06fe51dea622069c661a6213d5b031ff3a9e3';
    broken.v3Thaw.verifiedDeadlineFamilies = 14;
    broken.canonicalCensus.gamesVerified = ['NLH', 'PLO4', 'PLO5', 'PLO6'];
    broken.resourceWindow.activeSeconds = 600;
    broken.resourceWindow.maxHeapUsedMB = 2400;

    const res = evaluateEngineReleaseCertificationBundle(broken);
    expect(res.certified).toBe(false);
    expect(res.failures).toContain('sealed_receipt_sha_mismatch');
    expect(res.failures).toContain('v3_thaw_deadline_families_incomplete');
    expect(res.failures).toContain('canonical_census_missing_game_PLO8');
    expect(res.failures).toContain('resource_window_under_900_active_seconds');
    expect(res.failures).toContain('resource_window_heap_exceeded_2048mb');
  });

  it('applies the owner 12288 MB RSS ceiling and requires RSS to level off', () => {
    const at = (rss: number[]) => rss.map((rssMb, i) => ({ activeSeconds: i * 60, rssMb }));
    const ok = createValidBundle();
    ok.resourceWindow.maxRssMB = 9200;
    ok.resourceWindow.rssSamples = at(
      Array.from({ length: 16 }, (_, i) => 9180 + (i < 8 ? i * 2 : 16))
    );
    expect(evaluateEngineReleaseCertificationBundle(ok).failures).toEqual([]);

    const over = createValidBundle();
    over.resourceWindow.maxRssMB = 12289;
    expect(evaluateEngineReleaseCertificationBundle(over).failures).toContain(
      'resource_window_rss_exceeded_12288mb'
    );

    // The measured 8017564a window: ~17 MB per active minute is still climbing.
    const climbing = createValidBundle();
    climbing.resourceWindow.maxRssMB = 8609;
    climbing.resourceWindow.rssSamples = at(Array.from({ length: 16 }, (_, i) => 8356 + i * 17));
    expect(evaluateEngineReleaseCertificationBundle(climbing).failures).toContain(
      'resource_window_rss_not_leveling_off'
    );

    const thin = createValidBundle();
    thin.resourceWindow.rssSamples = at([5600, 5601, 5602]);
    expect(evaluateEngineReleaseCertificationBundle(thin).failures).toContain(
      'resource_window_rss_level_off_unproven'
    );
  });
});
