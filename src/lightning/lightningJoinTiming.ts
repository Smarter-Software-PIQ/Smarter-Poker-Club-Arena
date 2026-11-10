/**
 * LIGHTNING JOINS ARE TIMED FROM THE CLICK TO THE PAINTED CARDS (2026-11-10).
 *
 * Dan's first Lightning hand took 18.4 s from his pool session opening to the
 * hand being dealt, and the browser's half of that join was never recorded, so
 * it could not be split into legs. One join is now timed end to end, on the
 * browser's own monotonic clock, and reported once through
 * `fn_report_lightning_join_timing`:
 *
 *   click              the Join press (or the entry page sending a seated
 *                      player straight to their room: a rejoin)
 *   rejoin_checked     the rejoin door answered
 *   dialog_shown       the buy-in question is on screen (price + wallet read)
 *   confirm            the player confirmed an amount
 *   hold_answered      fn_cash_game_join held a chair
 *   purchase_answered  the buy-in purchase answered
 *   seated             the pool session was read back
 *   room_open          the room page mounted
 *   socket_connected   the room's table socket is connected
 *   first_snapshot     the room's first snapshot arrived (in the pool)
 *   first_hand         the first snapshot carrying a hand
 *   cards_painted      that hand was painted (the RENDER_ACK moment)
 *
 * One join at a time per tab: a new Join replaces an unsent one. A join is
 * reported when its cards paint, or, if the player confirmed a buy-in and no
 * hand ever painted, once after JOIN_TIMEOUT_MS as a 'timeout'. A join the
 * player abandoned before confirming, or that was refused, is never sent.
 * A tab that was hidden at any point is flagged (`hidden`): its paint waited
 * for the player, not for us.
 *
 * Telemetry only: nothing here changes what the player sees or can do, and a
 * failure to send is silent. NO CARD, no amount, no seat: marks and ids only.
 */
import { supabase } from '../lib/supabase';

export const LIGHTNING_JOIN_MARKS = [
  'click',
  'rejoin_checked',
  'dialog_shown',
  'confirm',
  'hold_answered',
  'purchase_answered',
  'seated',
  'room_open',
  'socket_connected',
  'first_snapshot',
  'first_hand',
  'cards_painted',
] as const;
export type LightningJoinMark = (typeof LIGHTNING_JOIN_MARKS)[number];

/** Marks a room page may record (only for the room its join was bound to). */
export type LightningRoomMark = Extract<
  LightningJoinMark,
  'room_open' | 'socket_connected' | 'first_snapshot' | 'first_hand' | 'cards_painted'
>;

/** A join with a confirmed buy-in that never paints is reported after this. */
export const JOIN_TIMEOUT_MS = 180_000;

export interface LightningJoinTimingPayload {
  kind: 'buy_in' | 'rejoin';
  outcome: 'painted' | 'timeout';
  cluster_id: string | null;
  hidden: boolean;
  app_version: string | null;
  marks: Partial<Record<LightningJoinMark, number>>;
}

interface ActiveJoin {
  kind: 'buy_in' | 'rejoin';
  clusterId: string | null;
  t0: number;
  marks: Partial<Record<LightningJoinMark, number>>;
  room: string | null;
  hidden: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export type LightningJoinSender = (payload: LightningJoinTimingPayload) => void;

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const pageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

function appVersion(): string | null {
  try {
    const v = import.meta.env.VITE_APP_VERSION;
    return typeof v === 'string' && v.trim() !== '' ? v.slice(0, 64) : null;
  } catch {
    return null;
  }
}

const defaultSender: LightningJoinSender = (payload) => {
  try {
    void Promise.resolve(
      supabase.rpc('fn_report_lightning_join_timing', { p_timing: payload })
    ).catch(() => undefined);
  } catch {
    /* telemetry: a failure to send is no sample */
  }
};

let sender: LightningJoinSender = defaultSender;
let active: ActiveJoin | null = null;
let visibilityBound = false;

function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (active && pageHidden()) active.hidden = true;
  });
}

function clear(): void {
  if (active?.timer) clearTimeout(active.timer);
  active = null;
}

function send(outcome: 'painted' | 'timeout'): void {
  const join = active;
  if (!join) return;
  clear();
  sender({
    kind: join.kind,
    outcome,
    cluster_id: join.clusterId,
    hidden: join.hidden,
    app_version: appVersion(),
    marks: { ...join.marks },
  });
}

/** The Join press (or a direct rejoin). Replaces any unsent join in this tab. */
export function startLightningJoin(
  clusterId: string | null,
  kind: 'buy_in' | 'rejoin' = 'buy_in'
): void {
  clear();
  bindVisibility();
  active = {
    kind,
    clusterId,
    t0: now(),
    marks: { click: 0 },
    room: null,
    hidden: pageHidden(),
    timer: null,
  };
}

/** A join-page mark (first one wins). No join in flight: nothing happens. */
export function markLightningJoin(mark: LightningJoinMark): void {
  const join = active;
  if (!join || join.marks[mark] !== undefined) return;
  join.marks[mark] = Math.max(0, Math.round(now() - join.t0));
  if (pageHidden()) join.hidden = true;
  if (mark === 'confirm' && !join.timer) {
    join.timer = setTimeout(() => {
      if (active === join) send('timeout');
    }, JOIN_TIMEOUT_MS);
  }
  if (mark === 'cards_painted') send('painted');
}

/** The entry door found the player already seated: this join is a rejoin into that room. */
export function markLightningJoinRejoined(roomId: string | null | undefined): void {
  if (!active) return;
  active.kind = 'rejoin';
  markLightningJoin('seated');
  bindLightningJoinRoom(roomId);
}

/** The join was refused or abandoned: nothing is sent. */
export function cancelLightningJoin(): void {
  clear();
}

/** The join now belongs to this room (its pool session id). */
export function bindLightningJoinRoom(roomId: string | null | undefined): void {
  if (active && roomId) active.room = roomId;
}

/**
 * A room page's mark. Recorded only for the room the join was bound to, or, for
 * a join still unbound (the anchor table hands the tab on to the room), the
 * first room to claim it. Any other room's events are someone else's join.
 */
export function markLightningJoinRoom(
  roomId: string | null | undefined,
  mark: LightningRoomMark
): void {
  const join = active;
  if (!join || !roomId) return;
  if (join.room === null) {
    // Only a join that bought (or rejoined) a seat can belong to a room.
    if (join.marks.seated === undefined) return;
    join.room = roomId;
  }
  if (join.room !== roomId) return;
  markLightningJoin(mark);
}

/** Tests only: the active join's marks, and a fake sender. */
export const __lightningJoinTimingForTests = {
  setSender(next: LightningJoinSender | null): void {
    sender = next ?? defaultSender;
  },
  active(): Readonly<ActiveJoin> | null {
    return active;
  },
  reset(): void {
    clear();
  },
};
