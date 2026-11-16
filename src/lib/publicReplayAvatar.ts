import { publicOrigin } from './appBase';
import { sharedAvatar } from './sharedTableAppearance';

/** Older links carry a public seat name but no avatar. Respect profile visibility,
 * reject a name reused after the deal, and use only the Arena character. */
export async function publicReplayAvatar(
  name: string,
  playedAt: string | null,
  signal: AbortSignal
) {
  if (!name || name.length > 64) return;
  const url = new URL('/api/profile/public', publicOrigin());
  url.searchParams.set('username', name);
  try {
    const response = await fetch(url, { signal, credentials: 'omit' });
    if (!response.ok) return;
    const { success, profile } = await response.json();
    if (
      !success ||
      typeof profile?.username !== 'string' ||
      profile.username.toLowerCase() !== name.toLowerCase()
    )
      return;
    const created = Date.parse(profile.created_at);
    const deal = Date.parse(playedAt ?? '');
    if (!Number.isFinite(deal) || !Number.isFinite(created) || created > deal) return;
    return sharedAvatar(profile.arena_avatar_url);
  } catch {
    // A missing or unavailable public profile leaves only this seat without art.
    return;
  }
}
