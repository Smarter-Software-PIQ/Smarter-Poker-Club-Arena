import { afterEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  readCount: 0,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      fsMock.readCount += 1;
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
  };
});

import {
  _resetHorsePhase8PolicyDigestCacheForTests,
  HORSE_PHASE8_POLICY_SOURCE_FILES,
} from './HorsePhase8PolicyDigest.js';
import { horsePhase8PolicyDigest } from './HorseQualifiedAuthority.js';
import {
  _resetHorseCatastropheGuardPolicyDigestCacheForTests,
  HORSE_CATASTROPHE_GUARD_POLICY_SOURCE_FILES,
  horseCatastropheGuardPolicyDigest,
} from './HorseCatastropheGuardPolicyDigest.js';
import {
  _resetHorseUpgradeActivationManifestCacheForTests,
  computeHorseUpgradeActivationManifest,
} from './HorseUpgradeActivationManifest.js';

describe('policy digests and upgrade activation manifest are memoized (b87d2b52)', () => {
  const savedGitSha = process.env.GIT_COMMIT_SHA;

  afterEach(() => {
    if (savedGitSha === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = savedGitSha;
    _resetHorsePhase8PolicyDigestCacheForTests();
    _resetHorseCatastropheGuardPolicyDigestCacheForTests();
    _resetHorseUpgradeActivationManifestCacheForTests();
  });

  it('memoizes horsePhase8PolicyDigest after warm-up and still honors custom readers', () => {
    _resetHorsePhase8PolicyDigestCacheForTests();
    fsMock.readCount = 0;

    const first = horsePhase8PolicyDigest();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fsMock.readCount).toBe(HORSE_PHASE8_POLICY_SOURCE_FILES.length);

    const afterWarmup = fsMock.readCount;
    for (let i = 0; i < 10; i++) {
      expect(horsePhase8PolicyDigest()).toBe(first);
    }
    expect(fsMock.readCount).toBe(afterWarmup);

    // Custom reader always computes fresh rather than returning the cached running digest.
    const syntheticA = horsePhase8PolicyDigest((p) => Buffer.from(`a:${p}`));
    const syntheticB = horsePhase8PolicyDigest((p) => Buffer.from(`b:${p}`));
    expect(syntheticA).not.toBe(first);
    expect(syntheticA).not.toBe(syntheticB);
  });

  it('memoizes horseCatastropheGuardPolicyDigest after warm-up and still honors custom readers', () => {
    _resetHorseCatastropheGuardPolicyDigestCacheForTests();
    fsMock.readCount = 0;

    const first = horseCatastropheGuardPolicyDigest();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fsMock.readCount).toBe(HORSE_CATASTROPHE_GUARD_POLICY_SOURCE_FILES.length);

    const afterWarmup = fsMock.readCount;
    for (let i = 0; i < 10; i++) {
      expect(horseCatastropheGuardPolicyDigest()).toBe(first);
    }
    expect(fsMock.readCount).toBe(afterWarmup);

    const synthetic = horseCatastropheGuardPolicyDigest((p) => Buffer.from(`guard:${p}`));
    expect(synthetic).not.toBe(first);
  });

  it('computes computeHorseUpgradeActivationManifest once per release identity with zero repeated readFileSync calls', () => {
    _resetHorsePhase8PolicyDigestCacheForTests();
    _resetHorseCatastropheGuardPolicyDigestCacheForTests();
    _resetHorseUpgradeActivationManifestCacheForTests();

    const first = computeHorseUpgradeActivationManifest();
    expect(first.manifestDigest).toMatch(/^[0-9a-f]{64}$/);

    const afterWarmup = fsMock.readCount;
    for (let i = 0; i < 50; i++) {
      const next = computeHorseUpgradeActivationManifest();
      expect(next.manifestDigest).toBe(first.manifestDigest);
      expect(next.authorities).toEqual(first.authorities);
    }
    expect(fsMock.readCount).toBe(afterWarmup);

    // Changing GIT_COMMIT_SHA invalidates the release-identity cache key cleanly.
    const alternateSha = 'a'.repeat(40);
    process.env.GIT_COMMIT_SHA = alternateSha;
    const updated = computeHorseUpgradeActivationManifest();
    expect(updated.sourceRevision).toBe(alternateSha);
    expect(updated.manifestDigest).not.toBe(first.manifestDigest);
  });
});
