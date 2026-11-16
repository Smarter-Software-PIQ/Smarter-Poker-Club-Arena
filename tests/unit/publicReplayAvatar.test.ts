import { afterEach, expect, it, vi } from 'vitest';
import { publicReplayAvatar } from '@/lib/publicReplayAvatar';

const deal = '2026-11-16T03:12:22Z';
const avatar = '/avatars/table/custom_complete_73072f2a2aa98d3d@2x.webp';
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['Burls', '2025-01-01', avatar, avatar],
  ['Different', '2025-01-01', avatar, undefined],
  ['Burls', '2026-12-01', avatar, undefined],
  ['Burls', '2025-01-01', 'https://outside.example/avatars/table/some.png', undefined],
])(
  'checks the public seat identity, creation date and art for %s',
  async (username, created_at, arena_avatar_url, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          profile: { username, created_at, arena_avatar_url },
        }),
      })
    );
    expect(await publicReplayAvatar('Burls', deal, new AbortController().signal)).toBe(expected);
  }
);

it('leaves a seat without art when its public lookup is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  expect(await publicReplayAvatar('Absent', deal, new AbortController().signal)).toBeUndefined();
});
