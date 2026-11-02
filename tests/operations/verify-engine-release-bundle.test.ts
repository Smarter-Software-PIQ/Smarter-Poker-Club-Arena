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
});
