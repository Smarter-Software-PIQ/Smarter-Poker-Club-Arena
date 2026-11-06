/**
 * Bust-art size correction — regression cover for the 2026-08-23 giant viking.
 *
 * The bug: `--sp-bust-gain` was two entries typed by hand, `viking: 2` and
 * `chef: 2`, written from a four-character sample. The chef is genuinely small
 * (71% of its canvas). The viking is the 6th LARGEST asset of 100 at 95%, so
 * 2x gave it a 2.9x render that swallowed its seat and spilled onto the felt.
 *
 * These tests pin the PROPERTY that makes that impossible — every gain is a
 * correction within a narrow band around 1 — rather than the exact numbers,
 * which are generated and will legitimately move when new art ships. A future
 * `viking: 2` fails on the band, whatever the character is called.
 */

import { describe, it, expect } from 'vitest';
import measurements from '../../scripts/data/bust-art-measurements.json';
import { AVATAR_ART_REVISION } from '../../src/lib/avatarArtRevision';
import { BUST_ART_GAIN, bustArtGain } from '../../src/components/table/bustArtGain';

/** Widest correction the composed scale may apply. See scripts/measure-bust-art.py. */
const GAIN_MIN = 0.75;
const GAIN_MAX = 1.4;

describe('bustArtGain', () => {
  it('covers the whole shipped library, not a sample', () => {
    // The bug was a 2-entry table standing in for 100 characters. Anything
    // that small is a sample again.
    expect(Object.keys(BUST_ART_GAIN).length).toBeGreaterThanOrEqual(90);
  });

  it('never lets a character grow or shrink beyond the correction band', () => {
    const outOfBand = Object.entries(BUST_ART_GAIN).filter(
      ([, gain]) => gain < GAIN_MIN || gain > GAIN_MAX
    );
    // `viking: 2` lands here. So does any other hand-typed guess.
    expect(outOfBand).toEqual([]);
  });

  it('corrects every current silhouette to the independently measured median', () => {
    expect(measurements.artRevision).toBe(AVATAR_ART_REVISION);
    expect(Object.keys(measurements.assets).sort()).toEqual(Object.keys(BUST_ART_GAIN).sort());
    for (const [slug, measured] of Object.entries(measurements.assets)) {
      expect(measured.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(
        Math.abs(measured.subjectShare * BUST_ART_GAIN[slug] - measurements.referenceShare)
      ).toBeLessThan(0.001);
    }
  });

  it('resolves a table avatar url to its slug, retina variant included', () => {
    expect(bustArtGain('/avatars/table/free_viking.webp')).toBe(BUST_ART_GAIN.viking);
    // The DB stores @2x urls, which is the form that was actually on the seat
    // that reported the bug.
    expect(bustArtGain('/avatars/table/free_viking@2x.webp')).toBe(BUST_ART_GAIN.viking);
  });

  it('distinguishes viking from viking_warrior', () => {
    // Non-greedy slug capture must not truncate a multi-word slug down to a
    // shorter one that happens to be a prefix.
    expect(bustArtGain('/avatars/table/vip_viking_warrior@2x.webp')).toBe(
      BUST_ART_GAIN.viking_warrior
    );
  });

  it('returns 1 for anything that is not a measured library bust', () => {
    // Uploaded photos and generated SVG monograms keep the circular frame and
    // must never be scaled by a correction meant for transparent bust art.
    expect(bustArtGain(null)).toBe(1);
    expect(bustArtGain(undefined)).toBe(1);
    expect(bustArtGain('')).toBe(1);
    expect(bustArtGain('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(1);
    expect(bustArtGain('https://example.invalid/storage/v1/object/public/a/b.png')).toBe(1);
    // Unmeasured new art falls back to the global scale rather than throwing.
    expect(bustArtGain('/avatars/table/free_brand_new_character.webp')).toBe(1);
  });
});

it('browser artwork fixtures match the exact measured retina library', async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  for (const [file, slug] of [
    ['tests/e2e/fixtures/table-art/vip_wolf@2x.webp', 'wolf'],
    ['tests/e2e/fixtures/table-art/vip_aztec_warrior@2x.webp', 'aztec_warrior'],
    ['tests/fixtures/mobile-avatar-geometry/free_penguin@2x.webp', 'penguin'],
  ] as const) {
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(
      measurements.assets[slug].retinaSha256
    );
  }
});
