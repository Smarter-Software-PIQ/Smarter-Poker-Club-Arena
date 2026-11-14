/**
 * The manifest digest covers the upgrade entries (2026-11-14).
 *
 * Host and decision workers compare manifests by `manifestDigest`
 * (verifyWorkerUpgradeManifestCompatibility). An independent review of
 * dcd4990899 made the digest ignore an entry's `exceptions`, and then the
 * whole `upgrades` list, and every test still passed: nothing proved that a
 * changed declaration changes the digest. This does, through the production
 * digest function the manifest itself is stamped with.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonical } from './HorseQualifiedAuthority.js';
import {
  computeHorseUpgradeActivationManifest,
  horseUpgradeManifestDigest,
  type HorseUpgradeActivationManifest,
  type HorseUpgradeCapabilityEntry,
} from './HorseUpgradeActivationManifest.js';

const manifest = computeHorseUpgradeActivationManifest();
const UPGRADE_12 = 'upgrade_12_specialty_variants';

/** The served manifest with one entry rewritten; nothing else touched. */
function withEntry(
  id: string,
  rewrite: (entry: HorseUpgradeCapabilityEntry) => HorseUpgradeCapabilityEntry
): HorseUpgradeActivationManifest {
  expect(manifest.upgrades.some((u) => u.id === id)).toBe(true);
  return {
    ...manifest,
    upgrades: manifest.upgrades.map((u) => (u.id === id ? rewrite(structuredClone(u)) : u)),
  };
}

/** The same value with every object's keys in reverse insertion order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, inner]) => [key, reversedKeys(inner)])
    );
  return value;
}

describe('the upgrade manifest digest', () => {
  it('is the digest the served manifest is stamped with', () => {
    expect(manifest.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(horseUpgradeManifestDigest(manifest)).toBe(manifest.manifestDigest);
  });

  it('is sha256 over the canonical form of schema, version, revision, engine version, authorities and every upgrade entry', () => {
    // Recomputed here from the served fields, so a digest function that
    // drops one of them cannot agree with it.
    const expected = createHash('sha256')
      .update(
        JSON.stringify(
          canonical({
            schema: manifest.schema,
            version: manifest.version,
            sourceRevision: manifest.sourceRevision,
            engineVersion: manifest.engineVersion,
            authorities: manifest.authorities,
            upgrades: manifest.upgrades,
          })
        )
      )
      .digest('hex');
    expect(manifest.manifestDigest).toBe(expected);
  });

  it('is the same for two computations, and does not depend on key order', () => {
    expect(computeHorseUpgradeActivationManifest().manifestDigest).toBe(manifest.manifestDigest);
    const reordered = reversedKeys(manifest) as HorseUpgradeActivationManifest;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(manifest));
    expect(Object.keys(reordered.upgrades[0]!)).not.toEqual(Object.keys(manifest.upgrades[0]!));
    expect(horseUpgradeManifestDigest(reordered)).toBe(manifest.manifestDigest);
  });

  it('does not cover generatedAt or the stamped digest itself', () => {
    const restamped: HorseUpgradeActivationManifest = {
      ...manifest,
      generatedAt: '2000-01-01T00:00:00.000Z',
      manifestDigest: '0'.repeat(64),
    };
    expect(horseUpgradeManifestDigest(restamped)).toBe(manifest.manifestDigest);
  });

  it.each<[string, string, (entry: HorseUpgradeCapabilityEntry) => HorseUpgradeCapabilityEntry]>([
    [
      'a variant removed',
      'upgrade_02_card_removal_blockers',
      (e) => ({ ...e, variants: e.variants.filter((v) => v !== 'flh') }),
    ],
    [
      'a variant added',
      'upgrade_03_shared_deck_multiboard',
      (e) => ({ ...e, variants: [...e.variants, 'flh'] }),
    ],
    [
      'a mode added',
      'upgrade_07_tournament_cover_and_bounty',
      (e) => ({ ...e, modes: ['cash', 'tournament'] }),
    ],
    ['a mode removed', 'upgrade_01_range_posteriors', (e) => ({ ...e, modes: ['cash'] })],
    [
      'the enabled flag flipped',
      'upgrade_06_public_timing_pacing',
      (e) => ({ ...e, enabled: false }),
    ],
    [
      'a held-out pack switched on',
      'heldout_cash_feature_ablation_pack',
      (e) => ({ ...e, enabled: true }),
    ],
    [
      'the exceptions removed',
      UPGRADE_12,
      (e) => {
        const { exceptions: _dropped, ...rest } = e;
        return rest;
      },
    ],
    [
      'an exception reason changed',
      UPGRADE_12,
      (e) => ({
        ...e,
        exceptions: e.exceptions!.map((x) => ({ ...x, reason: 'variant_spin_unavailable' })),
      }),
    ],
    [
      'an exception added',
      'upgrade_02_card_removal_blockers',
      (e) => ({
        ...e,
        exceptions: [{ variant: 'flh', mode: 'cash', surface: 'HorseLogic', reason: 'not_scored' }],
      }),
    ],
  ])('changes when an entry has %s (%s)', (_what, id, rewrite) => {
    const changed = withEntry(id, rewrite);
    expect(changed.upgrades).not.toEqual(manifest.upgrades);
    expect(horseUpgradeManifestDigest(changed)).not.toBe(manifest.manifestDigest);
  });

  it('upgrade 12 carries the exception the cases above remove and rewrite', () => {
    expect(manifest.upgrades.find((u) => u.id === UPGRADE_12)?.exceptions).toHaveLength(1);
  });

  it('changes when an entry is dropped or the list is emptied', () => {
    expect(
      horseUpgradeManifestDigest({ ...manifest, upgrades: manifest.upgrades.slice(1) })
    ).not.toBe(manifest.manifestDigest);
    expect(horseUpgradeManifestDigest({ ...manifest, upgrades: [] })).not.toBe(
      manifest.manifestDigest
    );
  });
});
