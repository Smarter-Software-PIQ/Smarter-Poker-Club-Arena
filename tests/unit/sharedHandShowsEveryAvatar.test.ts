/**
 * A SHARED HAND SHOWS EVERY SEAT'S AVATAR (2026-11-18).
 *
 * Dan: "ITS SUPPOSED TO BE SHOWING ANY AND ALL AVATARS AS WELL."
 *
 * Root cause: the stored hand row carries no art, and the one mapping from a
 * row to the replay model (`replayInputFromRow`) never received the avatars
 * HandHistoryService had already read from `profiles`. So every model built
 * from the archive had `avatarUrl` undefined, and a link shared from Hand
 * History or Previous Hand (outside the live table's short memory) reached the
 * recipient as bare name plates. A second gap: `sharedAvatar` admitted only
 * the library art, so generated portraits and inline SVG portraits - kinds
 * real profiles hold - were dropped from every link.
 *
 * Pinned here end to end: stored row + profiles -> model -> wire -> recipient
 * model, for every avatar kind on production.
 */
import { describe, expect, it } from 'vitest';
import { buildReplay, replayInputFromRow } from '../../src/utils/handReplay';
import { shareableFromModel, replayFromShareable } from '../../src/lib/shareHandModel';
import { encodeHand, decodeHandFromUrl } from '../../src/components/table/ShareHand';
import { sharedAvatar } from '../../src/lib/sharedTableAppearance';

const LIBRARY = '/avatars/table/free_fox@2x.webp';
const ORIGIN_LIBRARY = 'https://smarter.poker/avatars/table/free_ninja@2x.webp';
const GENERATED =
  'https://kuklfnapbkmacvwxktbh.supabase.co/storage/v1/object/public/custom-avatars/generated/d55730d2-da5a-45fc-8478-82e49f97cd7e_1794753658797.png';
const INLINE =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2010%2010%22%2F%3E';

const row = {
  hand_number: 59965661,
  created_at: '2026-11-18T07:06:52Z',
  game_variant: 'nlh',
  small_blind: 1,
  big_blind: 2,
  pot_size: 6,
  button_seat: 1,
  community_cards: [],
  players: [
    { seat: 1, userId: 'u1', username: 'alpha', stack: 100 },
    { seat: 2, userId: 'u2', username: 'bravo', stack: 100 },
    { seat: 3, userId: 'u3', username: 'charlie', stack: 100 },
    { seat: 4, userId: 'u4', username: 'delta', stack: 100 },
  ],
  actions: [
    { seat: 2, userId: 'u2', action: 'sb', amount: 1, stage: 'preflop' },
    { seat: 3, userId: 'u3', action: 'bb', amount: 2, stage: 'preflop' },
    { seat: 4, userId: 'u4', action: 'call', amount: 2, stage: 'preflop' },
    { seat: 1, userId: 'u1', action: 'fold', amount: 0, stage: 'preflop' },
    { seat: 2, userId: 'u2', action: 'fold', amount: 0, stage: 'preflop' },
    { seat: 3, userId: 'u3', action: 'check', amount: 0, stage: 'preflop' },
  ],
  winners: [{ userId: 'u3', amount: 5, potIndex: 0 }],
};

const avatars = { u1: LIBRARY, u2: ORIGIN_LIBRARY, u3: GENERATED, u4: INLINE };

describe('a shared hand shows every avatar', () => {
  it('the archive model carries each seat avatar from the profiles read', () => {
    const model = buildReplay(replayInputFromRow(row as never, { avatars }));
    expect(model.players.map((p) => p.avatarUrl)).toEqual([
      LIBRARY,
      ORIGIN_LIBRARY,
      GENERATED,
      INLINE,
    ]);
  });

  it('every production avatar kind survives the link to the recipient', () => {
    const model = buildReplay(replayInputFromRow(row as never, { avatars }));
    const sent = shareableFromModel(model, { id: 'h', tableName: 'Table', heroUserId: 'u1' });
    const received = decodeHandFromUrl(encodeHand(sent));
    expect(received).not.toBeNull();
    const recipient = replayFromShareable(received!);
    expect(recipient.players.map((p) => p.avatarUrl)).toEqual([
      LIBRARY,
      '/avatars/table/free_ninja@2x.webp',
      GENERATED,
      INLINE,
    ]);
  });

  it('a link still refuses art from any other host or shape', () => {
    for (const bad of [
      'https://evil.example/avatars/table/x.webp',
      'https://kuklfnapbkmacvwxktbh.supabase.co/storage/v1/object/public/other-bucket/x.png',
      'https://kuklfnapbkmacvwxktbh.supabase.co/storage/v1/object/public/custom-avatars/../x.png',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'data:text/html,hi',
      'javascript:alert(1)',
      `data:image/svg+xml,${'a'.repeat(1300)}`,
    ]) {
      expect(sharedAvatar(bad), bad).toBeUndefined();
    }
  });
});
