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
 *
 * ── A SIT & GO HOLDS ITS FRIENDS' SEATS TOO (2026-11-23) ─────────────────────
 *
 * Dan: "if a human joins any Sit & Go it starts" - the field fills around the
 * people in it, so a friend sent a plain link to a six or nine seat Sit & Go
 * (or a "Starts When Full" satellite run as one) arrived to a game that had
 * filled and started. Invite To Game on one now holds up to seats - 1 seats
 * for the friends the inviter chooses (fn_invite_to_private_game, migration
 * 20261123071654): the inviter is registered through the normal registration
 * door when they are not in it yet, and the seats are held IN this game. The
 * hold is never exclusive in a Sit & Go: every other seat still fills as
 * usual, and the start waits for the friends until the hold ends. A Sit & Go
 * has no table before it starts, so its address is the tournament page: the
 * link is the tournament link with the hold's token (`?invite=`), the inviter
 * sees the held seats there, and the friend's Take Seat registers them.
 * Offered only when the serving engine says it honours Sit & Go holds
 * (/health privateSitAndGoHolds).
 */
import { supabase } from './supabase';
import { gameInviteUrl, tableInviteTarget, tournamentShareUrl } from './share';

export interface PrivateGameHold {
  tournamentId: string;
  tableId: string | null;
  inviteToken: string | null;
  isCreator: boolean;
  live: boolean;
  outcome: string;
  exclusive: boolean;
  /** True for player-created strictly link-only Heads-Up Matches and Private Spins. */
  permanentPrivate?: boolean;
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
  /** A Sit & Go held in place (no table until it starts). */
  sitAndGo: boolean;
  /** The invite registered the inviter through the normal registration door. */
  registered: boolean;
  hold: PrivateGameHold | null;
}

export interface PrivateAdmission {
  allowed: boolean;
  reason: string | null;
  /** The database has no such door yet: the caller falls back to the old check. */
  unavailable: boolean;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The most a game can hold: every seat but the inviter's. A Spin 2, a Heads Up
 * 1, a six seat Sit & Go 5 and a nine seat Sit & Go 8.
 */
export function privateSeatsHoldable(maxPlayers: number): number {
  const n = Math.floor(Number(maxPlayers) || 0);
  return n >= 2 && n <= 9 ? n - 1 : 0;
}

type InviteFormatRow =
  | {
      variant?: string | null;
      max_players?: number | null;
      maxPlayers?: number | null;
      format_contract?: unknown;
    }
  | null
  | undefined;

/**
 * Is this a Sit & Go of four to nine seats, held in place? The database reads
 * the persisted format (sng-v1); a row that says otherwise is refused there.
 */
export function isSitAndGoInviteFormat(row: InviteFormatRow): boolean {
  if (!row) return false;
  const seats = Number(row.max_players ?? row.maxPlayers ?? 0);
  if (String(row.variant ?? '').toLowerCase() !== 'sng') return false;
  if (row.format_contract !== undefined && row.format_contract !== 'sng-v1') return false;
  return Number.isInteger(seats) && seats >= 4 && seats <= 9;
}

/** Is this game one whose invite can hold a seat: a Spin, a Heads Up or a Sit & Go? */
export function isPrivateInviteFormat(row: InviteFormatRow): boolean {
  if (!row) return false;
  const seats = Number(row.max_players ?? row.maxPlayers ?? 0);
  const spin = String(row.variant ?? '').toLowerCase() === 'spin';
  return (spin && seats === 3) || seats === 2 || isSitAndGoInviteFormat(row);
}

/**
 * How many friends the inviter may choose to hold seats for: every seat but
 * their own, and never more than the field has room for (their own entry
 * counted when they are not in it yet). The database bounds it again under
 * its lock; this only keeps the chooser honest. At least 1, so the database's
 * own answer is what the inviter reads when the room is gone.
 */
export function privateSeatsChoosable(
  maxPlayers: number,
  entrants: number | null | undefined,
  alreadyIn: boolean
): number {
  const most = privateSeatsHoldable(maxPlayers);
  const taken = Math.floor(Number(entrants));
  if (!Number.isFinite(taken) || taken < 0) return Math.max(1, most);
  const room = Math.floor(Number(maxPlayers)) - taken - (alreadyIn ? 0 : 1);
  return Math.max(1, Math.min(most, room));
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
  const token =
    typeof r.invite_token === 'string' && TOKEN_RE.test(r.invite_token) ? r.invite_token : null;
  return {
    tournamentId: String(r.tournament_id ?? tournamentId),
    tableId: typeof r.table_id === 'string' && r.table_id ? r.table_id : null,
    inviteToken: token,
    isCreator: r.is_creator === true || token !== null,
    live: r.live === true,
    outcome: String(r.outcome ?? ''),
    exclusive: r.exclusive === true,
    permanentPrivate: r.permanent_private === true,
    seatsHeld: Number(r.seats_held ?? 0) || 0,
    heldOpen: Number(r.held_open ?? 0) || 0,
    expiresAtMs: parseMs(r.hold_expires_at),
    inviterName:
      typeof r.inviter_name === 'string' && r.inviter_name.trim() ? r.inviter_name.trim() : null,
    tokenValid: r.token_valid === true,
    admitted: r.admitted === true,
  };
}

function isMissingDoor(error: { code?: string; message?: string } | null | undefined): boolean {
  return (
    !!error &&
    (error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? ''))
  );
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
      sitAndGo: false,
      registered: false,
      hold: null,
    };
  }
  const id = String(res.tournament_id ?? tournamentId);
  return {
    ok: true,
    reason: null,
    created: res.created === true,
    sitAndGo: res.sit_and_go === true,
    registered: res.registered === true,
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
    return {
      allowed: false,
      reason: error.message || 'unknown',
      unavailable: isMissingDoor(error),
    };
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

/**
 * The link a Sit & Go's friends open: the tournament itself (a Sit & Go has no
 * table before it starts), with the hold's token, through the same builder
 * every tournament link uses (World Hub /t/<id>, which passes `invite` on).
 */
export function privateSitAndGoInviteUrl(hold: {
  tournamentId: string;
  inviteToken: string | null;
  inviteCode?: string | null;
}): string {
  return tournamentShareUrl(hold.tournamentId, {
    inviteCode: hold.inviteCode ?? null,
    inviteToken: hold.inviteToken,
  });
}

/*
 * THE TOKEN A FRIEND ARRIVED WITH (2026-11-23). A Sit & Go is registered for
 * from several surfaces (its page, the lobby card, the lobby panel), all
 * through TournamentService.registerPlayer. The tournament page remembers the
 * `?invite=` token it was opened with, so the registration asks
 * fn_accept_private_game_invite with it before any money moves, whichever
 * button the friend pressed. Session memory only: a token is never stored.
 */
const rememberedTokens = new Map<string, string>();

export function rememberPrivateInviteToken(tournamentId: string, token: string | null): void {
  if (!tournamentId) return;
  if (token && TOKEN_RE.test(token)) {
    if (rememberedTokens.size > 50) rememberedTokens.clear();
    rememberedTokens.set(tournamentId, token);
  }
}

export function privateInviteTokenFor(tournamentId: string): string | null {
  return rememberedTokens.get(tournamentId) ?? null;
}

/** The database's entry guard refused a seat held for an invited friend. */
export function isPrivateGameSeatHeldError(err: unknown): boolean {
  const text =
    err && typeof err === 'object'
      ? `${String((err as { message?: unknown }).message ?? '')} ${String((err as { hint?: unknown }).hint ?? '')}`
      : String(err ?? '');
  return /PRIVATE_GAME_SEAT_HELD|private_game_seat_held/.test(text);
}

/** "9:41" until the hold ends; "0:00" once it has. */
export function formatHoldRemaining(
  expiresAtMs: number | null,
  nowMs: number = Date.now()
): string {
  if (expiresAtMs === null || !Number.isFinite(expiresAtMs)) return '0:00';
  const left = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const seconds = left % 60;
  return `${Math.floor(left / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** Plain words for every refusal. Title Case, no em dashes (CLAUDE.md 5.7). */
export function privateGameRefusalText(reason: string | null | undefined): string {
  const r = String(reason ?? '');
  if (/private_game_closed/.test(r)) return 'This Private Match Has Been Closed By Its Host';
  if (/source_not_offered/.test(r)) return 'Only Games And Stakes Currently Offered Can Be Created';
  if (/too_many_open_private_matches/.test(r))
    return 'Close An Open Private Match Before Creating Another';
  if (/not_creator/.test(r)) return 'Only The Creator Can Close This Private Match';
  if (/use_close_private_match/.test(r))
    return 'Use Unregister And Close To End This Private Match';
  if (/private_game_seat_held|PRIVATE_GAME_SEAT_HELD|heads_up_invite_required/.test(r))
    return 'This Seat Is Held For An Invited Friend';
  if (/private_game_full/.test(r)) return 'Every Held Seat In This Game Is Already Taken';
  if (/another_invite_is_holding/.test(r))
    return 'Another Player Is Already Holding Seats In This Game';
  if (/no_open_seat/.test(r)) return 'There Is No Open Seat Left To Hold';
  if (/game_already_started/.test(r)) return 'This Game Has Already Started';
  if (/format_not_supported/.test(r))
    return 'Seats Can Be Held For Spins, Heads Up And Sit N Gos Only';
  if (/insufficient|balance/.test(r)) return 'Not Enough Chips To Buy In';
  if (/table_limit_reached/.test(r)) return 'You Are Already Playing The Maximum Number Of Tables';
  if (/already_registered/.test(r)) return 'You Are Already Registered For This Game';
  if (/registration_closed|tournament_full/.test(r)) return 'This Game Is No Longer Taking Entries';
  if (/platform_frozen|daily_maintenance_window|spin_sng_closed_until_reopen/.test(r))
    return 'New Games Are Paused For Maintenance, Please Try Again Soon';
  if (/board_not_reproducible/.test(r))
    return 'This Game Cannot Be Made Private, Please Share It Instead';
  return 'Could Not Start A Private Game, Please Try Again';
}

interface EngineHoldSupport {
  /** Spins and Heads Up (/health privateGameHolds). */
  seatFirst: boolean;
  /** Six and nine seat Sit & Gos (/health privateSitAndGoHolds). */
  sitAndGo: boolean;
}

let engineSupportCache: { at: number; value: EngineHoldSupport } | null = null;

/** The serving engine's answer, read from /health and kept for a minute. */
async function engineHoldSupport(): Promise<EngineHoldSupport> {
  if (engineSupportCache && Date.now() - engineSupportCache.at < 60_000)
    return engineSupportCache.value;
  const base =
    import.meta.env.VITE_GAME_SERVER_URL ||
    (import.meta.env.PROD ? 'https://engine.smarter.poker' : 'http://localhost:8080');
  let value: EngineHoldSupport = { seatFirst: false, sitAndGo: false };
  try {
    const response = await fetch(`${base}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const health = (await response.json()) as {
        privateGameHolds?: unknown;
        privateSitAndGoHolds?: unknown;
      } | null;
      value = {
        seatFirst: health?.privateGameHolds === 1,
        sitAndGo: health?.privateSitAndGoHolds === 1,
      };
    }
  } catch {
    value = { seatFirst: false, sitAndGo: false };
  }
  engineSupportCache = { at: Date.now(), value };
  return value;
}

/**
 * Does the engine serving the tables honour held seats at a Spin or Heads Up?
 * Read from /health, never inferred from this client or a database row.
 * Unreadable is false: the plain share link is offered instead.
 */
export async function privateGameHoldsSupported(): Promise<boolean> {
  return (await engineHoldSupport()).seatFirst;
}

/**
 * Does it honour held seats in a six or nine seat Sit & Go? A separate answer:
 * an engine with only the Spin and Heads Up half would register a horse into
 * a Sit & Go seat held for a friend.
 */
export async function privateSitAndGoHoldsSupported(): Promise<boolean> {
  return (await engineHoldSupport()).sitAndGo;
}

/** Test seam: forget the cached engine answer. */
export function _resetPrivateGameSupportForTests(): void {
  engineSupportCache = null;
}
