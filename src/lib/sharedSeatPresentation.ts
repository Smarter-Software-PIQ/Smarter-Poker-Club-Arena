import { createContext } from 'react';
import type {
  AvatarGesture,
  LastAction,
  PlayerStatus,
  SeatSlotProps,
} from '../components/table/SeatSlot';

const statuses: PlayerStatus[] = [
  'active',
  'away',
  'sitting_out',
  'folded',
  'all_in',
  'disconnected',
];
const actions: LastAction[] = [null, 'fold', 'check', 'call', 'bet', 'raise', 'all_in', 'discard'];
const gestures: AvatarGesture[] = [null, 'push', 'check', 'fold', 'celebrate', 'lose', 'alert'];
const switches = [
  'isActive',
  'isCollectingChips',
  'isDealing',
  'isMucking',
  'foldCommitted',
  'dealPending',
  'handInPlay',
  'isWinner',
  'winnerDisplayActive',
  'isMuckedShowdown',
  'showAvatar',
  'showStackInBB',
] as const;

export type SeatPaint = [
  flags: number,
  status: number,
  action: number,
  stack: number,
  wager: number,
  net: number,
  cardMask: number,
];
export type SeatPaintEvent = [at: number, seat: number, ...paint: SeatPaint];
type ObserveSeat = (props: SeatSlotProps) => void;
export const SharedSeatObserver = createContext<ObserveSeat | null>(null);

export function seatPaint(props: SeatSlotProps): SeatPaint | undefined {
  const player = props.player;
  if (!player) return;
  const stateBits = switches.reduce((bits, key, i) => (props[key] ? bits | (1 << i) : bits), 0);
  const gesture = gestures.indexOf(props.recordedGesture ?? null);
  const flags = stateBits | (gesture << 12) | (props.recordedCardsCovered ? 1 << 15 : 0);
  // Only the visibility of each authorized card. Card values come from the ordinary share.
  const mask =
    player.isHero || player.showCards
      ? (player.holeCards ?? []).reduce(
          (bits, card, i) => (card && i < 6 ? bits | (1 << i) : bits),
          0
        )
      : 0;
  return [
    flags,
    statuses.indexOf(player.status),
    actions.indexOf(props.lastAction),
    player.stackPending ? -1 : player.stack,
    props.lastBetAmount ?? 0,
    props.netWinAmount ?? 0,
    mask,
  ];
}

export function readSeatPaints(input: unknown): SeatPaintEvent[] | undefined {
  if (!Array.isArray(input) || !input.length || input.length > 4096) return;
  let time = 0;
  const events: SeatPaintEvent[] = [];
  for (const entry of input) {
    if (!Array.isArray(entry) || entry.length !== 9 || !entry.every(Number.isFinite)) return;
    const [at, seat, flags, status, action, stack, bet, net, mask] = entry;
    if (
      ![at, seat, flags, status, action, mask].every(Number.isSafeInteger) ||
      at < time ||
      at > 86400000 ||
      seat < 1 ||
      seat > 10 ||
      flags < 0 ||
      flags >= 65536 ||
      ((flags >> 12) & 7) >= gestures.length ||
      !statuses[status] ||
      action < 0 ||
      action >= actions.length ||
      stack < -1 ||
      bet < 0 ||
      mask < 0 ||
      mask > 63
    )
      return;
    events.push([at, seat, flags, status, action, stack, bet, net, mask]);
    time = at;
  }
  return events;
}

export function seatPaintProps(event: SeatPaintEvent) {
  const [, , flags, status, action, stack, bet, net, mask] = event;
  const bits = Object.fromEntries(switches.map((key, i) => [key, !!(flags & (1 << i))])) as Record<
    (typeof switches)[number],
    boolean
  >;
  return {
    bits,
    gesture: gestures[(flags >> 12) & 7],
    covered: !!(flags & (1 << 15)),
    status: statuses[status],
    action: actions[action],
    stack,
    bet,
    net,
    mask,
  };
}
