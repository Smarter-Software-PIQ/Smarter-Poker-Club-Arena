import { normalizeFaceDeckId, type FaceDeckId } from './faceDeck';

/** Only asset catalogue identifiers travel in a public replay. */
export interface SharedTableAppearance {
  skin: string;
  background: string;
  cardBack: string;
  faceDeck: FaceDeckId;
  showAvatars: boolean;
  fourColor: boolean;
  maxPlayers: number;
}

export function readSharedTableAppearance(value: unknown): SharedTableAppearance | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<SharedTableAppearance>;
  const token = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9_-]{0,64}$/i.test(s);
  if (
    !token(v.skin) ||
    !token(v.background) ||
    !token(v.cardBack) ||
    typeof v.fourColor !== 'boolean' ||
    typeof v.maxPlayers !== 'number' ||
    !Number.isInteger(v.maxPlayers) ||
    v.maxPlayers < 2 ||
    v.maxPlayers > 10
  )
    return;
  return {
    skin: v.skin,
    background: v.background,
    cardBack: v.cardBack,
    faceDeck: normalizeFaceDeckId(v.faceDeck),
    showAvatars: v.showAvatars !== false,
    fourColor: v.fourColor,
    maxPlayers: v.maxPlayers,
  };
}

export function sharedAvatar(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const path = value.replace(/^https:\/\/smarter\.poker(?=\/avatars\/)/, '');
  if (/^\/avatars\/(free|vip|table)\/[a-z0-9_-]{1,160}\.(png|webp)$/i.test(path)) return path;
}
