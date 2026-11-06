import { describe, expect, it } from 'vitest';
import { AVATAR_ART_REVISION, versionedTableAvatarArt } from '../../src/lib/avatarArtRevision';
import { getAvatarWithFallback } from '../../src/utils/avatarGenerator';

describe('the requested artwork matches the shipped size calibration', () => {
  it('has a concrete content revision', () => {
    expect(AVATAR_ART_REVISION).toMatch(/^[a-f0-9]{20}$/);
  });
  it('requests one retina suffix for old base, retina and versioned preferences', () => {
    const expected = `/avatars/table/free_chef@2x.webp?art=${AVATAR_ART_REVISION}`;
    for (const input of [
      '/avatars/table/free_chef.webp',
      '/avatars/table/free_chef@2x.webp',
      '/avatars/table/free_chef@2x.webp?art=old',
    ]) {
      expect(versionedTableAvatarArt(input)).toBe(expected);
    }
  });
  it('versions absolute library image requests and legacy gallery choices', () => {
    const expected = `https://smarter.poker/avatars/table/free_chef@2x.webp?art=${AVATAR_ART_REVISION}`;
    expect(
      getAvatarWithFallback('https://smarter.poker/avatars/table/free_chef.webp', 'seed', 'Name')
    ).toBe(expected);
    expect(getAvatarWithFallback('/avatars/free/chef.webp?art=old', 'seed', 'Name')).toBe(expected);
  });
  it('leaves custom art and inline fallbacks unchanged', () => {
    for (const input of [
      'data:image/svg+xml,test',
      'https://smarter.poker/avatars/table/custom_owner@2x.webp',
      'https://example.com/photo.png',
    ]) {
      expect(versionedTableAvatarArt(input)).toBe(input);
    }
  });
});
