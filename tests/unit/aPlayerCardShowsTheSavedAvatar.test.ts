/**
 * Dan, 2026-11-27: "MAKE SURE IT IS USING THE ACTUAL USERS SAVED AVATAR OR
 * IMAGE EXACTLY." A Player Management card draws the avatar the player saved
 * (profiles.arena_avatar_url, then avatar_url, as ca_club_roster_rows returns
 * it) through the same resolver the table seat uses, so the card and the seat
 * can never show two different pictures of one player.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAvatarWithFallback } from '../../src/utils/avatarGenerator';
import { AVATAR_ART_REVISION } from '../../src/lib/avatarArtRevision';

const PAGE = readFileSync(resolve(__dirname, '../../src/pages/ClubMembersPage.tsx'), 'utf8');

describe('a player card shows the saved avatar exactly', () => {
  it('resolves the roster avatar through the table seat resolver', () => {
    expect(PAGE).toMatch(/getAvatarWithFallback\(\s*member\.avatar_url,\s*member\.user_id,/);
    // The old path fetched a 64px thumbnail of uploads and skipped the art
    // revision for library avatars.
    expect(PAGE).not.toMatch(/sizedStorageUrl\(\s*member\.avatar_url/);
  });

  it('fetches the portrait at its drawn size, never the old thumbnail', () => {
    const size = Number(/const MEMBER_PORTRAIT_PX = (\d+);/.exec(PAGE)?.[1]);
    expect(size).toBeGreaterThanOrEqual(92);
    const upload =
      'https://kuklfnapbkmacvwxktbh.supabase.co/storage/v1/object/public/avatars/u/avatar.jpg';
    expect(getAvatarWithFallback(upload, 'u', 'KingFish', size)).toContain(
      `width=${size * 2}&height=${size * 2}`
    );
  });

  it('keeps a saved library avatar as the same artwork the seat draws', () => {
    for (const saved of [
      '/avatars/table/free_musician@2x.webp',
      'https://smarter.poker/avatars/table/vip_wolf@2x.webp',
    ]) {
      const drawn = getAvatarWithFallback(saved, 'u', 'Player', 92);
      const path = saved.replace(/^https:\/\/smarter\.poker/, '');
      expect(drawn).toBe(`https://smarter.poker${path}?art=${AVATAR_ART_REVISION}`);
    }
  });

  it('draws any other saved image untouched', () => {
    const google = 'https://lh3.googleusercontent.com/a/abc=s96-c';
    const custom = 'https://smarter.poker/avatars/table/custom_butter_1ea1bc1e847b@2x.webp';
    expect(getAvatarWithFallback(google, 'u', 'Player', 92)).toBe(google);
    expect(getAvatarWithFallback(custom, 'u', 'Player', 92)).toBe(custom);
  });
});
