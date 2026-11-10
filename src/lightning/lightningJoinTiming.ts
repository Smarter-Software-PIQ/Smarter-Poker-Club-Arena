/**
 * LIGHTNING JOINS ARE TIMED FROM THE CLICK TO THE PAINTED CARDS (2026-11-10).
 *
 * Dan's first Lightning hand took 18.4 s from his pool session opening to the
 * hand being dealt, and the browser's half of that join was never recorded, so
 * it could not be split into legs. One join is timed end to end, on the
 * browser's own monotonic clock, and reported once through
 * `fn_report_lightning_join_timing`:
 *
 *   click              the Join press
 *   rejoin_checked     the rejoin door answered
 *   dialog_shown       the buy-in question is on screen (price + wallet read)
 *   confirm            the player confirmed an amount
 *   hold_answered      fn_cash_game_join held a chair
 *   purchase_answered  the buy-in purchase answered
 *   seated             the pool session was read back (or a rejoin found one)
 *   room_open          the room page mounted
 *   socket_connected   the room's table socket is connected
 *   first_snapshot     the room's first snapshot arrived (in the pool)
 *   first_hand         the first snapshot carrying a hand
 *   cards_painted      that hand was painted (the RENDER_ACK moment)
 *
 * EVERY JOIN THAT STARTS ENDS IN EXACTLY ONE REPORT (Dan, 2026-11-10: "measure
 * the complete Join-to-visible-cards path, including failed attempts and tail
 * latency"). The outcome and a reason code say how it ended; the database
 * derives the leg it ended in from the last mark reached:
 *
 *   painted    the cards reached the screen (no reason)
 *   refused    a door said no (signed out, frozen, game closed, seat taken...)
 *   failed     a door could not be read or did not confirm
 *   abandoned  the player closed the question, left the page, or pressed Join
 *              again before this join bought a seat
 *   timeout    JOIN_TIMEOUT_MS passed after a confirmed buy-in with no paint
 *              (abandoned/QUESTION_IDLE when the player never confirmed)
 *
 * A reason code is an upper-case token ([A-Z0-9_]) chosen here or taken from
 * a door's own error code. Never a card, an amount, a seat, a name or a
 * message: lightningJoinReasonCode() keeps only the token, and the database
 * refuses anything else. A tab that was hidden at any point is flagged
 * (`hidden`): its paint waited for the player, not for us.
 *
 * Telemetry only: nothing here changes what the player sees or can do, and a
 * failure to send is silent.
 */
import { signedInAccessToken } from '../utils/clientErrorSink';

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

export type LightningJoinOutcome = 'painted' | 'timeout' | 'refused' | 'failed' | 'abandoned';
/** The ways a join ends other than painted cards or the timer. */
export type LightningJoinEnding = Extract<LightningJoinOutcome, 'refused' | 'failed' | 'abandoned'>;

/** A join is reported after this with no paint: timeout, or abandoned if never confirmed. */
export const JOIN_TIMEOUT_MS = 180_000;

export interface LightningJoinTimingPayload {
  kind: 'buy_in' | 'rejoin';
  outcome: LightningJoinOutcome;
  reason: string | null;
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

export type LightningJoinSender = (payload: LightningJoinTimingPayload, keepalive: boolean) => void;

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

/**
 * One fire-and-forget POST to fn_report_lightning_join_timing, the way the
 * client error sink reaches its own RPC: a plain fetch, so it can go with
 * `keepalive` when the page is closing (the Supabase client cannot). Signed-in
 * players only (the RPC is not executable by anon); never reports itself.
 */
const defaultSender: LightningJoinSender = (payload, keepalive) => {
  try {
    const base = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const token = signedInAccessToken();
    if (typeof base !== 'string' || !base || typeof key !== 'string' || !key || !token) return;
    void fetch(`${base.replace(/\/+$/, '')}/rest/v1/rpc/fn_report_lightning_join_timing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ p_timing: payload }),
      keepalive,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* telemetry: a failure to send is no sample */
  }
};

let sender: LightningJoinSender = defaultSender;
let active: ActiveJoin | null = null;
let pageBound = false;

/**
 * A door's error as a reason code: its own upper-case code (PLATFORM_FROZEN,
 * SEAT_RESERVED, GAME_BARRED, a Postgres SQLSTATE as PG_xxxxx) and nothing
 * else. Free text, ids and numbers are never kept; no code found -> fallback.
 */
export function lightningJoinReasonCode(error: unknown, fallback: string): string {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  const token = /(?:^|[^A-Za-z0-9_])([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])(?![A-Za-z0-9_])/.exec(
    message
  );
  if (token) return token[1].slice(0, 64);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  if (/^[0-9A-Z]{5}$/.test(code)) return `PG_${code}`;
  return fallback;
}

function bindPage(): void {
  if (pageBound || typeof window === 'undefined' || typeof document === 'undefined') return;
  pageBound = true;
  document.addEventListener('visibilitychange', () => {
    if (active && pageHidden()) active.hidden = true;
  });
  // The tab is closing or navigating away: the join ends here, sent with keepalive.
  window.addEventListener('pagehide', () => {
    if (active) send('abandoned', 'PAGE_CLOSED', true);
  });
}

function clear(): void {
  if (active?.timer) clearTimeout(active.timer);
  active = null;
}

function send(outcome: LightningJoinOutcome, reason: string | null, keepalive = false): void {
  const join = active;
  if (!join) return;
  clear();
  try {
    sender(
      {
        kind: join.kind,
        outcome,
        reason: outcome === 'painted' ? null : reason,
        cluster_id: join.clusterId,
        hidden: join.hidden,
        app_version: appVersion(),
        marks: { ...join.marks },
      },
      keepalive
    );
  } catch {
    /* telemetry: a failure to send is no sample */
  }
}

/** The Join press. An unsent earlier join in this tab ends as abandoned/REPLACED. */
export function startLightningJoin(
  clusterId: string | null,
  kind: 'buy_in' | 'rejoin' = 'buy_in'
): void {
  if (active) send('abandoned', 'REPLACED');
  bindPage();
  const join: ActiveJoin = {
    kind,
    clusterId,
    t0: now(),
    marks: { click: 0 },
    room: null,
    hidden: pageHidden(),
    timer: null,
  };
  join.timer = setTimeout(() => {
    if (active !== join) return;
    if (join.marks.confirm === undefined && join.marks.seated === undefined)
      send('abandoned', 'QUESTION_IDLE');
    else send('timeout', 'NO_PAINT');
  }, JOIN_TIMEOUT_MS);
  active = join;
}

/** A join-page mark (first one wins). No join in flight: nothing happens. */
export function markLightningJoin(mark: LightningJoinMark): void {
  const join = active;
  if (!join || join.marks[mark] !== undefined) return;
  join.marks[mark] = Math.max(0, Math.round(now() - join.t0));
  if (pageHidden()) join.hidden = true;
  if (mark === 'cards_painted') send('painted', null);
}

/** The join ended without cards: a door refused, a read failed, or the player left. */
export function endLightningJoin(outcome: LightningJoinEnding, reason: string): void {
  send(outcome, reason);
}

/**
 * The player walked away before this join bought a seat (closed the question,
 * left the entry page). A join already confirmed or seated is left running: it
 * is the buy-in or the room that decides how it ends.
 */
export function abandonUnseatedLightningJoin(reason: string): void {
  const join = active;
  if (!join || join.marks.confirm !== undefined || join.marks.seated !== undefined) return;
  send('abandoned', reason);
}

/** The entry door found the player already seated: this join is a rejoin into that room. */
export function markLightningJoinRejoined(roomId: string | null | undefined): void {
  if (!active) return;
  active.kind = 'rejoin';
  markLightningJoin('seated');
  bindLightningJoinRoom(roomId);
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
