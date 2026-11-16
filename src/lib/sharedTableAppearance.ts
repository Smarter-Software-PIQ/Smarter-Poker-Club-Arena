import { readSharedChips, type SharedChip } from './sharedChipFlights';
import { readSharedDeal, type SharedDeal } from './sharedDeal';
import { readSeatPaints, type SeatPaintEvent } from './sharedSeatPresentation';
import { readSharedThrows, type SharedThrow } from './sharedThrows';
import { readTableGeometry, type SharedTableGeometry } from './sharedTableGeometry';
import { ANIMATION_SPEED_MAX, ANIMATION_SPEED_MIN } from '../utils/animationSpeed';
import type { ShareableAction, ShareableHand } from '../components/table/ShareHand';
import { cosmeticClassName } from '../cosmetics/avatarCosmetics';
import { readBoardTiming, type SharedBoardTiming } from './sharedBoardTiming';
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
  chips?: SharedChip[];
  deal?: SharedDeal;
  boardTiming?: SharedBoardTiming;
  endAtMs?: number;
  throws?: SharedThrow[];
  seatPaints?: SeatPaintEvent[];
  geometry?: SharedTableGeometry;
  buttonSkin?: string;
  animationSpeed?: number;
  showStackInBB?: boolean;
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
    animationSpeed:
      typeof v.animationSpeed === 'number' &&
      v.animationSpeed >= ANIMATION_SPEED_MIN &&
      v.animationSpeed <= ANIMATION_SPEED_MAX
        ? v.animationSpeed
        : undefined,
    showStackInBB: typeof v.showStackInBB === 'boolean' ? v.showStackInBB : undefined,
    seatPaints: readSeatPaints(v.seatPaints),
    throws: readSharedThrows(v.throws),
    endAtMs:
      typeof v.endAtMs === 'number' &&
      Number.isSafeInteger(v.endAtMs) &&
      v.endAtMs >= 0 &&
      v.endAtMs <= 86400000
        ? v.endAtMs
        : undefined,
    geometry: readTableGeometry(v.geometry),
    chips: readSharedChips(v.chips),
    deal: readSharedDeal(v.deal),
    boardTiming: readBoardTiming(v.boardTiming),
    buttonSkin: token(v.buttonSkin) ? v.buttonSkin : undefined,
  };
}

export function sharedAvatar(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const path = value.replace(/^https:\/\/smarter\.poker(?=\/avatars\/)/, '');
  if (/^\/avatars\/(free|vip|table)\/[a-z0-9_-]{1,160}(?:@2x)?\.(png|webp)$/i.test(path))
    return path;
}

interface ObservedSeat {
  seat: number;
  userId: string;
  avatar?: string;
  frame?: string;
  aura?: string;
}

type ActionTiming = Pick<ShareableAction, 'action' | 'seat' | 'atMs'>;
type StreetTiming = Partial<Record<'preflop' | 'flop' | 'turn' | 'river', ActionTiming[]>>;

export function applyObservedActionTimes(share: ShareableHand, timing?: StreetTiming) {
  if (!timing) return;
  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    const saved = timing[street];
    const rows = street === 'preflop' ? share.preflop : share[street]?.actions;
    if (!rows || !Array.isArray(saved)) continue;
    // Archive-generated blinds or returns need not have had a visible seat action.
    const choices = (action: ShareableAction['action']) =>
      ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN', 'DISCARD'].includes(action);
    const tracked = saved.filter((row) => row && choices(row.action));
    const archived = rows.filter((row) => choices(row.action));
    if (
      tracked.length !== archived.length ||
      !tracked.every((row, i) => row.seat === archived[i].seat && row.action === archived[i].action)
    )
      continue;
    for (const [i, row] of archived.entries()) {
      const at = tracked[i].atMs;
      if (typeof at === 'number' && Number.isSafeInteger(at) && at >= 0 && at <= 86400000)
        row.atMs = at;
    }
  }
}

interface ObservedTable {
  table: string;
  viewer: string;
  hand: string;
  appearance: SharedTableAppearance;
  seats: ObservedSeat[];
  timing?: StreetTiming;
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
  seats: ReadonlyArray<{ id: string; avatar?: string; frame?: string; aura?: string } | null>,
  timing?: StreetTiming
) {
  if (!table || !viewer || !Number.isSafeInteger(hand) || hand < 1) return;
  const observation: ObservedTable = {
    table,
    viewer,
    hand: String(hand),
    appearance,
    timing,
    seats: seats.flatMap((p, i) =>
      p
        ? [
            {
              seat: i + 1,
              userId: p.id,
              avatar: sharedAvatar(p.avatar),
              frame: cosmeticClassName(p.frame, 'frame') || undefined,
              aura: cosmeticClassName(p.aura, 'aura') || undefined,
            },
          ]
        : []
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
  return { appearance, seats: saved.seats, timing: saved.timing };
}
