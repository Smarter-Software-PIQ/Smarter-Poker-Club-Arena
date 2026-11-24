/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PLAYER-CREATED PRIVATE HEADS-UP MATCHES & PRIVATE SPINS (2026-11-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling (2026-11-23):
 *   - Any club/union player can create a Private Heads-Up Match (2-max) or
 *     Private Spin (3-max) from the very top of the Sit & Go / Spins lobby.
 *   - Players choose ONLY Game, Stakes (Buy-In), and Starting Chips from what
 *     the club/union CURRENTLY OFFERS on its active boards — never unoffered
 *     variants, stakes, or stack sizes. Levels, rake, payout shape, and all
 *     other rules come automatically from the matched offered board.
 *   - Strictly link-only: nobody except players holding the creator's invite
 *     link can join (enforced in PostgreSQL and engine; no public expiry).
 *   - Creator can Unregister & Close at any time before start, refunding all
 *     seated players atomically and permanently closing that event.
 */
import { supabase } from './supabase';
import { HEADS_UP_LEVEL_MINUTES } from '../config/headsUpSpec';
import { SPIN_BLINDS, SPIN_TIERS } from '../config/spinSpec';
import { parsePrivateGameHold, type PrivateGameHold } from './privateGameInvite';

export type PrivateMatchFormat = 'heads_up' | 'spin';

export interface OfferedBoardRow {
  id: string;
  name?: string | null;
  club_id?: string | null;
  union_id?: string | null;
  game_type?: string | null;
  variant?: string | null;
  tournament_type?: string | null;
  format_contract?: unknown;
  is_satellite?: boolean | null;
  satellite_target_id?: string | null;
  satellite_target?: string | null;
  buy_in_amount?: number | string | null;
  buy_in_fee?: number | string | null;
  starting_chips?: number | string | null;
  max_players?: number | string | null;
  status?: string | null;
  blind_structure?: unknown;
}

export interface OfferedPrivateTemplate {
  /** Exact currently offered public board row ID passed to the server RPC. */
  id: string;
  name: string;
  format: PrivateMatchFormat;
  /** Normalized variant key, e.g. 'nlh', 'plo4', 'plo5', 'plo6'. */
  gameType: string;
  /** Player-facing game label, e.g. "NLH", "PLO", "PLO5". */
  gameLabel: string;
  buyInAmount: number;
  buyInFee: number;
  totalBuyIn: number;
  startingChips: number;
  levelMinutes: number;
  maxPlayers: number;
  status: string;
}

export interface MyPrivateMatchInfo {
  tournamentId: string;
  tableId: string | null;
  format: PrivateMatchFormat;
  isCreator: boolean;
  inviteToken: string | null;
  sourceTournamentId: string | null;
  status: string;
}

export interface PrivateLobbyVisibilityState {
  /** Private matches belonging to OTHER players — hidden from the public board. */
  hiddenTournamentIds: Set<string>;
  /** Open private matches created by or admitted to the current player. */
  myMatches: Map<string, MyPrivateMatchInfo>;
  /** True when the database RPC is not installed yet (safe fallback). */
  unavailable: boolean;
}

export interface CreatePrivateMatchResult {
  ok: boolean;
  reason: string | null;
  hold: PrivateGameHold | null;
}

export interface ClosePrivateMatchResult {
  ok: boolean;
  reason: string | null;
  alreadyClosed: boolean;
  refundedCount: number;
}

const GAME_ORDER: Record<string, number> = {
  nlh: 0,
  holdem: 0,
  plo: 1,
  plo4: 1,
  plo5: 2,
  plo6: 3,
  plo8: 4,
  short_deck: 5,
  pineapple: 6,
};

export function normalizePrivateGameType(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!s || s === 'holdem' || s === 'no_limit_holdem' || s === 'texas_holdem') return 'nlh';
  if (s === 'plo' || s === 'omaha' || s === 'pot_limit_omaha') return 'plo4';
  return s;
}

export function formatPrivateGameLabel(gameType: string): string {
  const key = normalizePrivateGameType(gameType);
  if (key === 'nlh') return 'NLH';
  if (key === 'plo4') return 'PLO';
  if (key === 'plo5') return 'PLO5';
  if (key === 'plo6') return 'PLO6';
  if (key === 'plo8') return 'PLO8';
  if (key === 'short_deck') return 'Short Deck';
  if (key === 'pineapple') return 'Pineapple';
  return key.toUpperCase();
}

function isSatelliteBoard(row: OfferedBoardRow): boolean {
  const ttype = String(row.tournament_type ?? '').toUpperCase();
  const fc = String(row.format_contract ?? '').toLowerCase();
  return (
    row.is_satellite === true ||
    ttype === 'SATELLITE' ||
    fc === 'seat-first-satellite-v1' ||
    Boolean(row.satellite_target_id || row.satellite_target)
  );
}

function readLevelMinutes(row: OfferedBoardRow, format: PrivateMatchFormat): number {
  const fallback = format === 'spin' ? (SPIN_TIERS[0]?.levelMinutes ?? 3) : HEADS_UP_LEVEL_MINUTES;
  try {
    const parsed =
      typeof row.blind_structure === 'string'
        ? JSON.parse(row.blind_structure)
        : row.blind_structure;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as Record<string, unknown>;
      const mins = Number(first.durationMinutes ?? first.duration_minutes ?? first.duration);
      if (Number.isFinite(mins) && mins > 0) return mins;
    }
  } catch {
    // Use canonical format duration when blind_structure cannot be parsed.
  }
  return fallback;
}

function isActiveOfferedStatus(raw: unknown): boolean {
  const s = String(raw ?? '').toUpperCase();
  return s === 'ANNOUNCED' || s === 'REGISTERING' || s === 'RUNNING';
}

function statusPriority(raw: unknown): number {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'REGISTERING') return 0;
  if (s === 'ANNOUNCED') return 1;
  return 2;
}

/**
 * Extract the exact set of (Game, Stakes, Starting Chips) combinations that
 * this club/union CURRENTLY OFFERS for Heads-Up (2-max) or Spins (3-max).
 *
 * Excludes private matches, satellites, and finished/cancelled rows so players
 * can NEVER pick a game, stake, or starting stack that is not offered.
 */
export function extractOfferedPrivateTemplates(
  tournaments: readonly OfferedBoardRow[],
  format: PrivateMatchFormat,
  excludePrivateIds?: ReadonlySet<string>
): OfferedPrivateTemplate[] {
  const bestByKey = new Map<string, OfferedPrivateTemplate>();

  for (const row of tournaments) {
    if (!row?.id) continue;
    if (excludePrivateIds?.has(row.id)) continue;
    if (!isActiveOfferedStatus(row.status)) continue;
    if (isSatelliteBoard(row)) continue;

    const variant = String(row.variant ?? '').toLowerCase();
    const ttype = String(row.tournament_type ?? '').toUpperCase();
    const fc = String(row.format_contract ?? '').toLowerCase();
    const maxPlayers = Number(row.max_players ?? 0);

    const isSpin = variant === 'spin' || ttype === 'SPIN' || fc === 'spin-v1';
    const isHeadsUp =
      !isSpin && maxPlayers === 2 && (variant === 'sng' || ttype === 'SNG' || fc === 'sng-v1');

    if (format === 'spin' && !(isSpin && maxPlayers === 3)) continue;
    if (format === 'heads_up' && !isHeadsUp) continue;

    const buyInAmount = Number(row.buy_in_amount ?? 0);
    const buyInFee = Number(row.buy_in_fee ?? 0);
    const totalBuyIn = Math.round((buyInAmount + buyInFee) * 100) / 100;
    const startingChips = Math.round(Number(row.starting_chips ?? 0));

    if (!Number.isFinite(totalBuyIn) || totalBuyIn <= 0) continue;
    if (!Number.isFinite(startingChips) || startingChips <= 0) continue;

    const gameType = normalizePrivateGameType(row.game_type);
    const key = `${gameType}|${totalBuyIn}|${startingChips}`;
    const candidate: OfferedPrivateTemplate = {
      id: row.id,
      name: String(row.name ?? '').trim() || `${totalBuyIn} ${formatPrivateGameLabel(gameType)}`,
      format,
      gameType,
      gameLabel: formatPrivateGameLabel(gameType),
      buyInAmount,
      buyInFee,
      totalBuyIn,
      startingChips,
      levelMinutes: readLevelMinutes(row, format),
      maxPlayers,
      status: String(row.status ?? '').toUpperCase(),
    };

    const existing = bestByKey.get(key);
    if (!existing || statusPriority(candidate.status) < statusPriority(existing.status)) {
      bestByKey.set(key, candidate);
    }
  }

  return [...bestByKey.values()].sort((a, b) => {
    const ga = GAME_ORDER[a.gameType] ?? 99;
    const gb = GAME_ORDER[b.gameType] ?? 99;
    if (ga !== gb) return ga - gb;
    if (a.gameType !== b.gameType) return a.gameType.localeCompare(b.gameType);
    if (a.totalBuyIn !== b.totalBuyIn) return a.totalBuyIn - b.totalBuyIn;
    return a.startingChips - b.startingChips;
  });
}

export function offeredGamesFor(
  templates: readonly OfferedPrivateTemplate[]
): Array<{ gameType: string; gameLabel: string }> {
  const seen = new Map<string, string>();
  for (const t of templates) {
    if (!seen.has(t.gameType)) seen.set(t.gameType, t.gameLabel);
  }
  return [...seen.entries()].map(([gameType, gameLabel]) => ({ gameType, gameLabel }));
}

export function offeredStakesFor(
  templates: readonly OfferedPrivateTemplate[],
  gameType: string
): number[] {
  const set = new Set<number>();
  for (const t of templates) {
    if (t.gameType === gameType) set.add(t.totalBuyIn);
  }
  return [...set].sort((a, b) => a - b);
}

export function offeredStacksFor(
  templates: readonly OfferedPrivateTemplate[],
  gameType: string,
  totalBuyIn: number
): number[] {
  const set = new Set<number>();
  for (const t of templates) {
    if (t.gameType === gameType && t.totalBuyIn === totalBuyIn) set.add(t.startingChips);
  }
  return [...set].sort((a, b) => a - b);
}

export function resolveOfferedTemplate(
  templates: readonly OfferedPrivateTemplate[],
  gameType: string,
  totalBuyIn: number,
  startingChips: number
): OfferedPrivateTemplate | null {
  return (
    templates.find(
      (t) =>
        t.gameType === gameType && t.totalBuyIn === totalBuyIn && t.startingChips === startingChips
    ) ?? null
  );
}

export function stackBandLabel(startingChips: number): string {
  const bb = SPIN_BLINDS[0]?.big ?? 20;
  const bbs = Math.round(startingChips / bb);
  if (startingChips <= 300) return `${startingChips.toLocaleString()} (${bbs}BB Turbo)`;
  if (startingChips >= 1000) return `${startingChips.toLocaleString()} (${bbs}BB Deep)`;
  return `${startingChips.toLocaleString()} (${bbs}BB)`;
}

function isMissingDoor(error: { code?: string; message?: string } | null | undefined): boolean {
  return (
    !!error &&
    (error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? ''))
  );
}

export async function createPrivateSeatFirstMatch(
  sourceTournamentId: string
): Promise<CreatePrivateMatchResult> {
  const { data, error } = await supabase.rpc('fn_create_private_seat_first_match', {
    p_source_tournament_id: sourceTournamentId,
  });
  const res = (data ?? {}) as Record<string, unknown>;
  if (error || res.ok !== true) {
    return {
      ok: false,
      reason: String(res.reason ?? error?.message ?? 'private_game_refused'),
      hold: null,
    };
  }
  const id = String(res.tournament_id ?? '');
  return {
    ok: true,
    reason: null,
    hold: parsePrivateGameHold({ ...res, is_creator: true, permanent_private: true }, id),
  };
}

export async function closePrivateSeatFirstMatch(
  tournamentId: string
): Promise<ClosePrivateMatchResult> {
  const { data, error } = await supabase.rpc('fn_close_private_seat_first_match', {
    p_tournament_id: tournamentId,
  });
  const res = (data ?? {}) as Record<string, unknown>;
  if (error || res.ok !== true) {
    return {
      ok: false,
      reason: String(res.reason ?? error?.message ?? 'close_refused'),
      alreadyClosed: false,
      refundedCount: 0,
    };
  }
  return {
    ok: true,
    reason: null,
    alreadyClosed: res.already_closed === true,
    refundedCount: Number(res.refunded_count ?? 0) || 0,
  };
}

export async function readPrivateSeatFirstLobbyState(
  clubId: string
): Promise<PrivateLobbyVisibilityState> {
  const { data, error } = await supabase.rpc('fn_private_seat_first_lobby_state', {
    p_club_id: clubId,
  });
  if (error || !data || typeof data !== 'object') {
    return {
      hiddenTournamentIds: new Set(),
      myMatches: new Map(),
      unavailable: isMissingDoor(error),
    };
  }
  const payload = data as {
    hidden_tournament_ids?: unknown;
    my_matches?: unknown;
  };
  const hidden = new Set<string>();
  if (Array.isArray(payload.hidden_tournament_ids)) {
    for (const id of payload.hidden_tournament_ids) {
      if (typeof id === 'string' && id) hidden.add(id);
    }
  }
  const mine = new Map<string, MyPrivateMatchInfo>();
  if (Array.isArray(payload.my_matches)) {
    for (const raw of payload.my_matches) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const tournamentId = typeof r.tournament_id === 'string' ? r.tournament_id : '';
      if (!tournamentId) continue;
      const format: PrivateMatchFormat = r.format === 'spin' ? 'spin' : 'heads_up';
      mine.set(tournamentId, {
        tournamentId,
        tableId: typeof r.table_id === 'string' && r.table_id ? r.table_id : null,
        format,
        isCreator: r.is_creator === true,
        inviteToken: typeof r.invite_token === 'string' && r.invite_token ? r.invite_token : null,
        sourceTournamentId:
          typeof r.source_tournament_id === 'string' && r.source_tournament_id
            ? r.source_tournament_id
            : null,
        status: String(r.status ?? 'open'),
      });
    }
  }
  return {
    hiddenTournamentIds: hidden,
    myMatches: mine,
    unavailable: false,
  };
}
