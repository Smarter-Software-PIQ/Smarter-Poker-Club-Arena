import { getLocalStorage, setLocalStorage } from './storage';
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

interface ObservedSeat {
  seat: number;
  userId: string;
  avatar?: string;
}

interface ObservedTable {
  table: string;
  viewer: string;
  hand: string;
  appearance: SharedTableAppearance;
  seats: ObservedSeat[];
}

// Keep cosmetics only. Financial facts and visible cards always come from the archive.
// The complete identity is checked on read, including when another tab reused a slot.
function observationKey(hand: string | number) {
  return 'ca:shared-table:1:' + (Number(hand) % 256);
}

export function rememberObservedTable(
  table: string,
  viewer: string,
  hand: number,
  appearance: SharedTableAppearance,
  seats: ReadonlyArray<{ id: string; avatar?: string } | null>
) {
  if (!table || !viewer || !Number.isSafeInteger(hand) || hand < 1) return;
  const observation: ObservedTable = {
    table,
    viewer,
    hand: String(hand),
    appearance,
    seats: seats.flatMap((p, i) =>
      p ? [{ seat: i + 1, userId: p.id, avatar: sharedAvatar(p.avatar) }] : []
    ),
  };
  setLocalStorage(observationKey(hand), observation);
}

export function observedTable(
  table?: string | null,
  viewer?: string | null,
  hand?: number | string | null
) {
  if (!table || !viewer || !hand) return;
  const saved = getLocalStorage<ObservedTable | null>(observationKey(hand), null);
  if (
    saved?.table !== table ||
    saved.viewer !== viewer ||
    saved.hand !== String(hand) ||
    !Array.isArray(saved.seats)
  )
    return;
  const appearance = readSharedTableAppearance(saved.appearance);
  if (!appearance) return;
  return { appearance, seats: saved.seats };
}
