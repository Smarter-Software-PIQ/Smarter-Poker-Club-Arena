/*
 * AN INVITE NAMES A GAME, NOT ONE DEAL OF IT (2026-11-22).
 *
 * Dan, relaying a player: "The share link still doesn't work either ... The
 * crazy river is always on the table, even when you invite someone. It
 * doesn't open a new table."
 *
 * A Spin, a Sit & Go, a Heads Up and a When Full satellite start the moment
 * their last seat is bought, and the board then opens a fresh game of the
 * same kind under a NEW tournament id (TournamentRecurringService
 * ensureBoardOpen keys a board on its owner and its name). An invite link
 * carries the id of the one game it was made from. That game opens with a
 * horse already waiting in it and fills within minutes, so the friend who
 * taps the link a little later is shown a game that is already running, with
 * two other players seated, and no way into the one that is open now.
 *
 * This module answers the two questions every landing surface needs, in one
 * place:
 *
 *   1. is the game this link names still open to enter? (inviteLandingState)
 *   2. if not, which open game is the same game? (findNextOpenGame)
 *
 * "The same game" is the board's own identity: same owner (club and union),
 * same format, same stake, same game type, same seat count, same satellite
 * target, and the same name when one is open. It is scoped to the owner on
 * purpose: an unscoped hop once nearly seated a player in a stranger's club
 * (TournamentRankingHost Play Again, PR #1702).
 *
 * No money moves here and nobody is seated: the answer is a tournament id the
 * player is taken to, where Register or the seat buy-in still asks them.
 */
import { supabase } from './supabase';
import { reportError } from '../utils/errorReporter';
import {
  isSeatFirstTournamentFormat,
  isTournamentEntryUnavailable,
  readTournamentFormat,
} from '../utils/tournamentPresentation';

/** The columns a game is matched on. Every caller passes its own row. */
export interface WhenFullGameRow {
  id: string;
  name?: string | null;
  status?: string | null;
  club_id?: string | null;
  union_id?: string | null;
  format_contract?: unknown;
  buy_in_amount?: number | string | null;
  game_type?: string | null;
  max_players?: number | null;
  current_players?: number | null;
  satellite_target_id?: string | null;
  created_at?: string | null;
}

export const NEXT_OPEN_GAME_COLUMNS =
  'id, name, status, club_id, union_id, format_contract, buy_in_amount, game_type, max_players, current_players, satellite_target_id, created_at';

/**
 * A game that starts when its seats fill and is then replaced by the next one:
 * a Spin, a Sit & Go of any size (Heads Up and the 6-max and 9-max satellite
 * feeders included) and a seat-first satellite. An MTT starts on a clock and
 * keeps its id through late registration, so its link never goes stale this
 * way.
 */
export function isWhenFullGame(row: unknown): boolean {
  const format = readTournamentFormat(row);
  return format === 'sng-v1' || format === 'spin-v1' || format === 'seat-first-satellite-v1';
}

const OPEN_STATUSES = new Set(['REGISTERING', 'ANNOUNCED']);

export type InviteLandingState =
  /** The link's own game can still be entered (or is not a When Full game). */
  | 'open'
  /** The viewer plays in it: their own seat or result is the landing. */
  | 'mine'
  /** A When Full game that started, finished, filled or was cancelled without the viewer. */
  | 'gone';

/**
 * What a person who followed a link to this game should be offered.
 * `viewerIsEntrant` is true when they hold an entry in it, in any state.
 */
export function inviteLandingState(
  row: WhenFullGameRow | null | undefined,
  viewerIsEntrant: boolean
): InviteLandingState {
  if (!row || !isWhenFullGame(row)) return 'open';
  if (viewerIsEntrant) return 'mine';
  const status = String(row.status ?? '').toUpperCase();
  if (!OPEN_STATUSES.has(status)) return 'gone';
  const entrants = Number(row.current_players ?? 0);
  return isTournamentEntryUnavailable(row, Number.isSafeInteger(entrants) ? entrants : 0)
    ? 'gone'
    : 'open';
}

function sameText(a: unknown, b: unknown): boolean {
  return (
    String(a ?? '')
      .trim()
      .toLowerCase() ===
    String(b ?? '')
      .trim()
      .toLowerCase()
  );
}

function sameNullableId(a: unknown, b: unknown): boolean {
  return String(a ?? '') === String(b ?? '');
}

/** True when `candidate` is an open game of the same board as `origin`. */
export function isSameOpenGame(origin: WhenFullGameRow, candidate: WhenFullGameRow): boolean {
  if (!candidate?.id || candidate.id === origin.id) return false;
  if (String(candidate.status ?? '').toUpperCase() !== 'REGISTERING') return false;
  const format = readTournamentFormat(origin);
  if (!format || readTournamentFormat(candidate) !== format) return false;
  if (!sameNullableId(candidate.club_id, origin.club_id)) return false;
  if (!sameNullableId(candidate.union_id, origin.union_id)) return false;
  if (!sameNullableId(candidate.satellite_target_id, origin.satellite_target_id)) return false;
  if (Number(candidate.buy_in_amount ?? 0) !== Number(origin.buy_in_amount ?? 0)) return false;
  if (!sameText(candidate.game_type, origin.game_type)) return false;
  if (Number(candidate.max_players ?? 0) !== Number(origin.max_players ?? 0)) return false;
  const entrants = Number(candidate.current_players ?? 0);
  return !isTournamentEntryUnavailable(candidate, Number.isSafeInteger(entrants) ? entrants : 0);
}

/**
 * The open game a stale link should lead to, from the candidates read.
 * The board's own name wins (that is the key the engine reopens a board on);
 * otherwise the oldest open game of the same shape, the engine's own
 * primary-table bias.
 */
export function pickNextOpenGame(
  origin: WhenFullGameRow,
  candidates: readonly WhenFullGameRow[]
): WhenFullGameRow | null {
  const open = candidates
    .filter((candidate) => isSameOpenGame(origin, candidate))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return open.find((candidate) => sameText(candidate.name, origin.name)) ?? open[0] ?? null;
}

export interface NextOpenGame {
  tournamentId: string;
  /** Sat at, not registered for: the landing goes straight to the seats. */
  seatFirst: boolean;
}

/** In-app path that opens the next game: the seats for a seat-first game, else its lobby. */
export function nextOpenGamePath(next: NextOpenGame): string {
  const base = `/tournaments/${encodeURIComponent(next.tournamentId)}`;
  return next.seatFirst ? `${base}?seat=1` : base;
}

/** Where a player is sent when no game of this kind is open right now. */
export function openGamesListPath(origin: WhenFullGameRow | null | undefined): string {
  return readTournamentFormat(origin) === 'spin-v1' ? '/tournaments?type=spin' : '/tournaments';
}

type NextOpenGameReader = (origin: WhenFullGameRow) => Promise<WhenFullGameRow[]>;

const readOpenCandidates: NextOpenGameReader = async (origin) => {
  const format = readTournamentFormat(origin);
  if (!format) return [];
  let query = supabase
    .from('tournaments')
    .select(NEXT_OPEN_GAME_COLUMNS)
    .eq('status', 'REGISTERING')
    .eq('format_contract', format)
    .eq('buy_in_amount', Number(origin.buy_in_amount ?? 0))
    .eq('max_players', Number(origin.max_players ?? 0))
    .neq('id', origin.id)
    .order('created_at', { ascending: true })
    .limit(24);
  query = origin.club_id ? query.eq('club_id', origin.club_id) : query.is('club_id', null);
  query = origin.union_id ? query.eq('union_id', origin.union_id) : query.is('union_id', null);
  query = origin.satellite_target_id
    ? query.eq('satellite_target_id', origin.satellite_target_id)
    : query.is('satellite_target_id', null);
  if (origin.game_type) query = query.eq('game_type', origin.game_type);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as WhenFullGameRow[];
};

/**
 * The open game of the same board, or null when none is open (or the read
 * failed: a failure is reported and answers null, so the caller offers the
 * list of open games instead of a dead button).
 */
export async function findNextOpenGame(
  origin: WhenFullGameRow | null | undefined,
  read: NextOpenGameReader = readOpenCandidates
): Promise<NextOpenGame | null> {
  if (!origin?.id || !isWhenFullGame(origin)) return null;
  try {
    const next = pickNextOpenGame(origin, await read(origin));
    if (!next) return null;
    return { tournamentId: String(next.id), seatFirst: isSeatFirstTournamentFormat(next) };
  } catch (error) {
    reportError(error, 'nextOpenGame.read_failed', { tournamentId: origin.id });
    return null;
  }
}

/** The game row for a tournament id, for a surface that holds only the id. */
export async function readWhenFullGame(tournamentId: string): Promise<WhenFullGameRow | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(NEXT_OPEN_GAME_COLUMNS)
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) {
    reportError(error, 'nextOpenGame.origin_read_failed', { tournamentId });
    return null;
  }
  return (data ?? null) as unknown as WhenFullGameRow | null;
}
