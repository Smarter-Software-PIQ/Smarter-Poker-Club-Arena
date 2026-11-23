/**
 * THE SENDER'S INVITE CODE FOR A SHARED HAND (2026-11-06).
 *
 * A shared replay is opened by friends who often have no account. The replay
 * offers them Create Account through the sender's own Share & Invite code
 * (`https://smarter.poker/i/<CODE>`), the one door that credits the sender
 * and places the new player in their downline (ClubInviteService,
 * fn_redeem_club_invite_code). No second attribution path is invented here.
 *
 * Which club's code: the club that hosts the hand's table when the sender is
 * a member of it; otherwise (a union table hosted by another club) the
 * sender's own active club. fn_club_invite_link returns an existing code and
 * only creates one on first use, so asking again is harmless.
 *
 * The code is fetched when the hand is OPENED, not when Link or Share is
 * tapped: a phone only opens its share sheet straight from the tap, and a
 * network round trip in between loses that permission. A sender with no
 * club, or a failed read, simply shares without a code: the link still opens
 * the hand, it just credits nobody.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getMyInviteLink } from '../services/ClubInviteService';
import { normalizeInviteCode } from '../lib/inviteCode';
import { reportError } from '../utils/errorReporter';

const ACTIVE = ['active', 'approved', 'automatic'];

async function clubForTable(tableId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('tables')
    .select('club_id')
    .eq('id', tableId)
    .maybeSingle();
  if (error) {
    // Could not tell which club hosts the table: fall back to the sender's own.
    reportError(error, 'useSenderInviteCode.clubForTable');
    return null;
  }
  return (data as { club_id?: string | null } | null)?.club_id ?? null;
}

async function ownActiveClub(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('club_members')
    .select('club_id, joined_at')
    .eq('user_id', userId)
    .in('status', ACTIVE)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Could not read the sender's clubs: share without a code rather than guess.
    reportError(error, 'useSenderInviteCode.ownActiveClub');
    return null;
  }
  return (data as { club_id?: string | null } | null)?.club_id ?? null;
}

async function codeFor(clubId: string | null): Promise<string | null> {
  if (!clubId) return null;
  try {
    return normalizeInviteCode((await getMyInviteLink(clubId)).code);
  } catch {
    return null;
  }
}

/** Resolve the sender's invite code for a hand or live table (null when there is none). */
export async function resolveSenderInviteCode(
  tableId: string | null | undefined,
  userId: string | null | undefined,
  clubIdOverride?: string | null
): Promise<string | null> {
  if (!userId) return null;
  try {
    const directCode = clubIdOverride ? await codeFor(clubIdOverride) : null;
    if (directCode) return directCode;
    const hostCode = tableId ? await codeFor(await clubForTable(tableId)) : null;
    return hostCode ?? (await codeFor(await ownActiveClub(userId)));
  } catch {
    return null;
  }
}

export function useSenderInviteCode(
  tableId: string | null | undefined,
  userId: string | null | undefined,
  enabled = true,
  clubIdOverride?: string | null
): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !userId) {
      setCode(null);
      return;
    }
    let cancelled = false;
    void resolveSenderInviteCode(tableId, userId, clubIdOverride).then((c) => {
      if (!cancelled) setCode(c);
    });
    return () => {
      cancelled = true;
    };
  }, [tableId, userId, enabled, clubIdOverride]);
  return code;
}

/** Resolve the sender's invite code directly for a known chip club (lobby surfaces). */
export function useClubSenderInviteCode(
  clubId: string | null | undefined,
  userId: string | null | undefined,
  enabled = true
): string | null {
  return useSenderInviteCode(null, userId, Boolean(enabled && clubId), clubId);
}

/*
 * THE SENDER'S CODE FOR A TOURNAMENT LINK (2026-11-22).
 *
 * A tournament link carries the club code (`?i=`) so a friend who is not in
 * the club yet is offered its join step instead of "Tournament Not Found".
 * Which club's code: the club that hosts the tournament when the sender is a
 * member of it; for a union event hosted by a sibling club, the sender's own
 * club inside that union (every club in a union can read the union's
 * tournaments, fn_poker_can_read_games over fn_club_scope_ids); otherwise the
 * sender's own active club, the same last resort a table link uses.
 *
 * A lobby renders a card per tournament, most of them in one club, so the
 * answer is remembered per account and scope for the session: thirty cards
 * ask once, not thirty times. Only a code is remembered; "no code" is asked
 * again next time.
 */
export interface TournamentInviteScope {
  tournamentId?: string | null;
  clubId?: string | null;
  unionId?: string | null;
}

async function scopeOfTournament(
  tournamentId: string
): Promise<{ clubId: string | null; unionId: string | null } | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('club_id, union_id')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) {
    reportError(error, 'useSenderInviteCode.scopeOfTournament');
    return null;
  }
  const row = data as { club_id?: string | null; union_id?: string | null } | null;
  return row ? { clubId: row.club_id ?? null, unionId: row.union_id ?? null } : null;
}

/** The sender's earliest-joined active club inside a union (or the union's own row). */
async function ownClubInUnion(userId: string, unionId: string): Promise<string | null> {
  const { data: rows, error } = await supabase
    .from('club_members')
    .select('club_id, joined_at')
    .eq('user_id', userId)
    .in('status', ACTIVE)
    .order('joined_at', { ascending: true })
    .limit(50);
  if (error) {
    reportError(error, 'useSenderInviteCode.ownClubInUnion');
    return null;
  }
  const mine = ((rows || []) as { club_id?: string | null }[])
    .map((r) => r.club_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (mine.length === 0) return null;
  if (mine.includes(unionId)) return unionId;
  const [byColumn, byLink] = await Promise.all([
    supabase.from('clubs').select('id').in('id', mine).eq('union_id', unionId),
    supabase.from('union_clubs').select('club_id').eq('union_id', unionId).in('club_id', mine),
  ]);
  const inUnion = new Set<string>();
  for (const r of (byColumn.data || []) as { id?: string | null }[]) if (r.id) inUnion.add(r.id);
  for (const r of (byLink.data || []) as { club_id?: string | null }[])
    if (r.club_id) inUnion.add(r.club_id);
  return mine.find((id) => inUnion.has(id)) ?? null;
}

const tournamentCodeCache = new Map<string, Promise<string | null>>();
const TOURNAMENT_CODE_CACHE_LIMIT = 200;

/** Test helper: forget every remembered tournament code. */
export function resetTournamentSenderInviteCodes(): void {
  tournamentCodeCache.clear();
}

async function resolveTournamentScopeCode(
  clubId: string | null,
  unionId: string | null,
  userId: string
): Promise<string | null> {
  const host = await codeFor(clubId);
  if (host) return host;
  if (unionId && unionId !== clubId) {
    const inUnion = await codeFor(await ownClubInUnion(userId, unionId));
    if (inUnion) return inUnion;
  }
  return codeFor(await ownActiveClub(userId));
}

/** Resolve the sender's invite code for a tournament link (null when there is none). */
export async function resolveTournamentSenderInviteCode(
  scope: TournamentInviteScope,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null;
  try {
    let clubId = scope.clubId || null;
    let unionId = scope.unionId || null;
    if (!clubId && !unionId && scope.tournamentId) {
      const read = await scopeOfTournament(scope.tournamentId);
      clubId = read?.clubId ?? null;
      unionId = read?.unionId ?? null;
    }
    const key = `${userId}|${clubId ?? ''}|${unionId ?? ''}`;
    let pending = tournamentCodeCache.get(key);
    if (!pending) {
      if (tournamentCodeCache.size >= TOURNAMENT_CODE_CACHE_LIMIT) tournamentCodeCache.clear();
      pending = resolveTournamentScopeCode(clubId, unionId, userId).catch(() => null);
      tournamentCodeCache.set(key, pending);
    }
    const code = await pending;
    if (!code && tournamentCodeCache.get(key) === pending) tournamentCodeCache.delete(key);
    return code;
  } catch {
    return null;
  }
}

/**
 * The sender's invite code for the tournament a surface shares, fetched when
 * the surface opens (a phone only opens its share sheet straight from the
 * tap). Pass the tournament's club and union when the surface has them; a
 * surface holding only the id gets them read once.
 */
export function useTournamentSenderInviteCode(
  scope: TournamentInviteScope,
  userId: string | null | undefined,
  enabled = true
): string | null {
  const tournamentId = scope.tournamentId || null;
  const clubId = scope.clubId || null;
  const unionId = scope.unionId || null;
  const active = Boolean(enabled && userId && (tournamentId || clubId || unionId));
  const key = active ? `${userId}|${tournamentId ?? ''}|${clubId ?? ''}|${unionId ?? ''}` : '';
  /* Held with the scope it answers, so a surface that switches to another
     tournament never shares the previous club's code while the new one is
     still being read. */
  const [answer, setAnswer] = useState<{ key: string; code: string | null }>({
    key: '',
    code: null,
  });
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void resolveTournamentSenderInviteCode({ tournamentId, clubId, unionId }, userId).then((c) => {
      if (!cancelled) setAnswer({ key, code: c });
    });
    return () => {
      cancelled = true;
    };
  }, [key, tournamentId, clubId, unionId, userId]);
  return key && answer.key === key ? answer.code : null;
}
