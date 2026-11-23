/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  INVITE TO GAME HOLDS A PRIVATE SEAT FOR YOUR FRIEND (2026-11-22)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The player, texted to Dan: "The share link still doesn't work either ...
 * The crazy river is always on the table, even when you invite someone. It
 * doesn't open a new table." A Spin or a Heads Up opened from the lobby often
 * already holds a horse, and a Heads Up starts the moment a person takes its
 * other seat, so a friend sent its link arrived to a game that had started.
 *
 * Invite To Game on a Spin, a Heads Up or a Heads Up satellite now:
 *   - from outside the game: opens a PRIVATE copy of the same board, buys the
 *     inviter in through the normal seat door, and holds the other seat(s);
 *   - seated alone: makes that game private (Heads Up "Specific Player" is
 *     this case);
 *   - seated beside others: holds the open seat(s) of that game.
 * The friend gets the table's link with the hold's token, through the share
 * builders as they are (tableInviteTarget, gameInviteUrl). The database
 * refuses the held seat to anyone else, a horse by the same rule
 * (fn_private_game_entry_refusal); the hold lasts ten minutes of open play
 * and then the game is an ordinary board again.
 *
 * The private game is offered only when the engine serving the tables says it
 * honours held seats (/health privateGameHolds). An older engine cannot see a
 * hold and would fill the seat with a horse.
 */
import { supabase } from './supabase';
import { gameInviteUrl, tableInviteTarget } from './share';

export interface PrivateGameHold {
  tournamentId: string;
  tableId: string | null;
  inviteToken: string | null;
  isCreator: boolean;
  live: boolean;
  outcome: string;
  exclusive: boolean;
  seatsHeld: number;
  heldOpen: number;
  expiresAtMs: number | null;
  inviterName: string | null;
  tokenValid: boolean;
  admitted: boolean;
}

export interface PrivateInviteResult {
  ok: boolean;
  reason: string | null;
  created: boolean;
  hold: PrivateGameHold | null;
}

export interface PrivateAdmission {
  allowed: boolean;
  reason: string | null;
  /** The database has no such door yet: the caller falls back to the old check. */
  unavailable: boolean;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** The longest a Spin, Heads Up or satellite can hold: every seat but the inviter's. */
export function privateSeatsHoldable(maxPlayers: number): number {
  const n = Math.floor(Number(maxPlayers) || 0);
  return n >= 2 && n <= 3 ? n - 1 : 0;
}

/** Is this game a seat-first board whose invite can hold a private seat? */
export function isPrivateInviteFormat(row: {
  variant?: string | null;
  max_players?: number | null;
  maxPlayers?: number | null;
} | null | undefined): boolean {
  if (!row) return false;
  const seats = Number(row.max_players ?? row.maxPlayers ?? 0);
  const spin = String(row.variant ?? '').toLowerCase() === 'spin';
  return (spin && seats === 3) || seats === 2;
}

function parseMs(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function parsePrivateGameHold(raw: unknown, tournamentId: string): PrivateGameHold | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.held === false) return null;
  const token = typeof r.invite_token === 'string' && TOKEN_RE.test(r.invite_token) ? r.invite_token : null;
  return {
    tournamentId: String(r.tournament_id ?? tournamentId),
    tableId: typeof r.table_id === 'string' && r.table_id ? r.table_id : null,
    inviteToken: token,
    isCreator: r.is_creator === true || token !== null,
    live: r.live === true,
    outcome: String(r.outcome ?? ''),
    exclusive: r.exclusive === true,
    seatsHeld: Number(r.seats_held ?? 0) || 0,
    heldOpen: Number(r.held_open ?? 0) || 0,
    expiresAtMs: parseMs(r.hold_expires_at),
    inviterName: typeof r.inviter_name === 'string' && r.inviter_name.trim() ? r.inviter_name.trim() : null,
    tokenValid: r.token_valid === true,
    admitted: r.admitted === true,
  };
}

function isMissingDoor(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? ''));
}

/** INVITE TO GAME: open or reserve the private game, buying the inviter in when it is new. */
export async function inviteToPrivateGame(
  tournamentId: string,
  seatsHeld = 1
): Promise<PrivateInviteResult> {
  const { data, error } = await supabase.rpc('fn_invite_to_private_game', {
    p_tournament_id: tournamentId,
    p_seats_held: seatsHeld,
  });
  const res = (data ?? {}) as Record<string, unknown>;
  if (error || res.ok !== true) {
    return {
      ok: false,
      reason: String(res.reason ?? error?.message ?? 'private_game_refused'),
      created: false,
      hold: null,
    };
  }
  const id = String(res.tournament_id ?? tournamentId);
  return {
    ok: true,
    reason: null,
    created: res.created === true,
    hold: parsePrivateGameHold({ ...res, is_creator: true }, id),
  };
}

/** The friend's door, asked before every seat-first purchase. */
export async function acceptPrivateGameInvite(
  tournamentId: string,
  inviteToken: string | null
): Promise<PrivateAdmission> {
  const { data, error } = await supabase.rpc('fn_accept_private_game_invite', {
    p_tournament_id: tournamentId,
    p_invite_token: inviteToken,
  });
  if (error) {
    return { allowed: false, reason: error.message || 'unknown', unavailable: isMissingDoor(error) };
  }
  const res = (data ?? {}) as { allowed?: boolean; reason?: string };
  return { allowed: res.allowed !== false, reason: res.reason ?? null, unavailable: false };
}

export async function cancelPrivateGameHold(tournamentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_cancel_private_game_hold', {
    p_tournament_id: tournamentId,
  });
  return !error && (data as { ok?: boolean } | null)?.ok === true;
}

/** What the table shows. null when nothing is held or it could not be read. */
export async function readPrivateGameHold(
  tournamentId: string,
  inviteToken: string | null
): Promise<PrivateGameHold | null> {
  const { data, error } = await supabase.rpc('fn_private_game_hold_state', {
    p_tournament_id: tournamentId,
    p_invite_token: inviteToken,
  });
  if (error) return null;
  return parsePrivateGameHold(data, tournamentId);
}

/** The link the friend opens: the held table, with the hold's token. */
export function privateGameInviteUrl(hold: {
  tableId: string | null;
  tournamentId: string;
  inviteToken: string | null;
  inviteCode?: string | null;
}): string {
  return gameInviteUrl(
    tableInviteTarget({
      tableId: hold.tableId ?? '',
      isTournament: true,
      tournamentId: hold.tournamentId,
      inviteCode: hold.inviteCode ?? null,
      seatHoldToken: hold.inviteToken,
    })
  );
}

/** "9:41" until the hold ends; "0:00" once it has. */
export function formatHoldRemaining(expiresAtMs: number | null, nowMs: number = Date.now()): string {
  if (expiresAtMs === null || !Number.isFinite(expiresAtMs)) return '0:00';
  const left = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const seconds = left % 60;
  return `${Math.floor(left / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** Plain words for every refusal. Title Case, no em dashes (CLAUDE.md 5.7). */
export function privateGameRefusalText(reason: string | null | undefined): string {
  const r = String(reason ?? '');
  if (/private_game_seat_held|PRIVATE_GAME_SEAT_HELD|heads_up_invite_required/.test(r))
    return 'This Seat Is Held For An Invited Friend';
  if (/private_game_full/.test(r)) return 'Every Held Seat In This Game Is Already Taken';
  if (/another_invite_is_holding/.test(r)) return 'Another Player Is Already Holding Seats In This Game';
  if (/no_open_seat/.test(r)) return 'There Is No Open Seat Left To Hold';
  if (/game_already_started/.test(r)) return 'This Game Has Already Started';
  if (/format_not_supported/.test(r)) return 'Private Games Are Available For Spins And Heads Up Only';
  if (/insufficient|balance/.test(r)) return 'Not Enough Chips To Buy In';
  if (/table_limit_reached/.test(r)) return 'You Are Already Playing The Maximum Number Of Tables';
  if (/platform_frozen|daily_maintenance_window|spin_sng_closed_until_reopen/.test(r))
    return 'New Games Are Paused For Maintenance, Please Try Again Soon';
  if (/board_not_reproducible/.test(r)) return 'This Game Cannot Be Made Private, Please Share It Instead';
  return 'Could Not Start A Private Game, Please Try Again';
}

let engineSupportCache: { at: number; value: boolean } | null = null;

/**
 * Does the engine serving the tables honour held seats? Read from /health,
 * never inferred from this client or a database row. Unreadable is false: the
 * plain share link is offered instead.
 */
export async function privateGameHoldsSupported(): Promise<boolean> {
  if (engineSupportCache && Date.now() - engineSupportCache.at < 60_000) return engineSupportCache.value;
  const base =
    import.meta.env.VITE_GAME_SERVER_URL ||
    (import.meta.env.PROD ? 'https://engine.smarter.poker' : 'http://localhost:8080');
  let value = false;
  try {
    const response = await fetch(`${base}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const health = (await response.json()) as { privateGameHolds?: unknown } | null;
      value = health?.privateGameHolds === 1;
    }
  } catch {
    value = false;
  }
  engineSupportCache = { at: Date.now(), value };
  return value;
}

/** Test seam: forget the cached engine answer. */
export function _resetPrivateGameSupportForTests(): void {
  engineSupportCache = null;
}
