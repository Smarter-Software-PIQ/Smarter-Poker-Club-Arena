/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TABLE INVITE SERVICE - In-App Friend & Clubmate Table Invitations
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Loads invitable contacts (accepted friends + optional active clubmates),
 * sends one `table_invite` notification per tap through the server
 * (public.fn_send_game_invite), enforces self-invite / invalid-target /
 * duplicate-cooldown guards, and looks up the player's active seated table for
 * one-tap friend invites from ProfilePage.
 */

import { supabase } from '../lib/supabase';
import { reportError } from '../utils/errorReporter';
import { playerDisplayName, PLAYER_NAME_COLUMNS } from '../utils/playerDisplayName';
import { resolveVipStatus, type VipColumns } from '../utils/vipStatus';
import type { VipTier } from '../components/avatars/PlayerAvatar';
import { normalizeInviteCode, normalizeInviteToken, normalizeUuid } from '../lib/inviteCode';

export type TableInviteKind = 'cash' | 'tournament' | 'lightning';
export type InvitableContactSource = 'friend' | 'clubmate';

export interface InvitableContact {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  level?: number;
  vipTier?: VipTier;
  source: InvitableContactSource;
}

export interface SendTableInviteParams {
  recipientUserId: string;
  senderUserId: string;
  /** The picker's own label. The notification's wording is built by the server. */
  senderName: string;
  kind: TableInviteKind;
  tableId?: string | null;
  tournamentId?: string | null;
  clusterId?: string | null;
  /** The picker's own label. The notification names the game from its row. */
  tableName: string;
  inviteCode?: string | null;
  inviteToken?: string | null;
}

export type SendTableInviteFailureReason =
  | 'self'
  | 'cooldown'
  | 'invalid_target'
  | 'not_allowed'
  | 'rate_limited'
  | 'insert_failed';

export type SendTableInviteResult =
  | { ok: true; actionUrl: string; cooldownMs: number }
  | { ok: false; reason: SendTableInviteFailureReason; message: string; retryAfterMs?: number };

export interface ActiveTableInviteTarget {
  kind: TableInviteKind;
  tableId: string;
  tableName: string;
  clubId?: string | null;
  clusterId?: string | null;
  tournamentId?: string | null;
}

export const TABLE_INVITE_COOLDOWN_MS = 60_000;
const CLUBMATE_FETCH_LIMIT = 60;
const INACTIVE_MEMBER_STATUSES = new Set(['banned', 'suspended', 'pending', 'rejected', 'left']);
const TERMINAL_TABLE_STATUSES = new Set(['closed', 'completed', 'cancelled', 'canceled']);

/** Per-(recipient, targetKey) cooldown expiry timestamps in epoch ms. */
const inviteCooldowns = new Map<string, number>();

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ringTier(row: VipColumns | null | undefined): VipTier | undefined {
  const status = resolveVipStatus(row);
  if (status === 'lifetime') return 'diamond';
  if (status === 'vip') return 'gold';
  return undefined;
}

/**
 * Deterministic target key used for duplicate-invite cooldown enforcement.
 * Returns null when the params lack a valid destination ID for the kind.
 */
export function buildTableInviteTargetKey(
  params: Pick<SendTableInviteParams, 'kind' | 'tableId' | 'tournamentId' | 'clusterId'>
): string | null {
  const tableId = cleanText(params.tableId);
  const tournamentId = cleanText(params.tournamentId);
  const clusterId = cleanText(params.clusterId);

  if (params.kind === 'lightning') {
    if (clusterId) return `lightning:${clusterId}`;
    if (tableId) return `lightning:table:${tableId}`;
    return null;
  }

  if (params.kind === 'tournament') {
    if (tableId) return `tournament:table:${tableId}`;
    if (tournamentId) return `tournament:${tournamentId}`;
    return null;
  }

  if (tableId) return `cash:${tableId}`;
  return null;
}

function cooldownKeyOf(recipientUserId: string, targetKey: string): string {
  return `${recipientUserId}::${targetKey}`;
}

/** Remaining cooldown milliseconds for a recipient + target pair, or 0 if ready. */
export function getTableInviteCooldownRemainingMs(
  recipientUserId: string,
  targetKey: string | null,
  now = Date.now()
): number {
  const recipient = cleanText(recipientUserId);
  if (!recipient || !targetKey) return 0;
  const key = cooldownKeyOf(recipient, targetKey);
  const expiresAt = inviteCooldowns.get(key);
  if (!expiresAt) return 0;
  if (expiresAt <= now) {
    inviteCooldowns.delete(key);
    return 0;
  }
  return expiresAt - now;
}

/** Test & session helper to clear in-memory invite cooldowns. */
export function resetTableInviteCooldowns(): void {
  inviteCooldowns.clear();
}

function pruneExpiredCooldowns(now: number): void {
  if (inviteCooldowns.size <= 200) return;
  for (const [key, expiresAt] of inviteCooldowns) {
    if (expiresAt <= now) inviteCooldowns.delete(key);
  }
}

/**
 * Loads accepted friends (bidirectional) and optionally active clubmates
 * (deduplicated, preferring 'friend'), hydrated with arena-safe profile fields.
 * Never selects `is_horse` or social-only `profiles.avatar_url`.
 */
export async function fetchInvitableContacts(
  userId: string,
  clubId?: string | null
): Promise<InvitableContact[]> {
  const cleanUserId = cleanText(userId);
  if (!cleanUserId) return [];

  const cleanClubId = cleanText(clubId);

  const [outboundRes, inboundRes, clubRes] = await Promise.all([
    supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', cleanUserId)
      .eq('status', 'accepted'),
    supabase
      .from('friendships')
      .select('user_id')
      .eq('friend_id', cleanUserId)
      .eq('status', 'accepted'),
    cleanClubId
      ? supabase
          .from('club_members')
          .select('user_id, status')
          .eq('club_id', cleanClubId)
          .neq('user_id', cleanUserId)
          .limit(CLUBMATE_FETCH_LIMIT)
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (outboundRes.error) {
    reportError(outboundRes.error, 'TableInviteService.fetchInvitableContacts.outbound');
  }
  if (inboundRes.error) {
    reportError(inboundRes.error, 'TableInviteService.fetchInvitableContacts.inbound');
  }
  if (clubRes.error) {
    reportError(clubRes.error, 'TableInviteService.fetchInvitableContacts.clubmates');
  }

  const sourceByUserId = new Map<string, InvitableContactSource>();

  for (const row of outboundRes.data || []) {
    const id = cleanText((row as { friend_id?: unknown }).friend_id);
    if (id && id !== cleanUserId) sourceByUserId.set(id, 'friend');
  }
  for (const row of inboundRes.data || []) {
    const id = cleanText((row as { user_id?: unknown }).user_id);
    if (id && id !== cleanUserId) sourceByUserId.set(id, 'friend');
  }
  for (const row of clubRes.data || []) {
    const member = row as { user_id?: unknown; status?: unknown };
    const id = cleanText(member.user_id);
    const status = cleanText(member.status).toLowerCase();
    if (!id || id === cleanUserId) continue;
    if (status && INACTIVE_MEMBER_STATUSES.has(status)) continue;
    if (!sourceByUserId.has(id)) {
      sourceByUserId.set(id, 'clubmate');
    }
  }

  const allIds = [...sourceByUserId.keys()];
  if (allIds.length === 0) return [];

  const profileMap = new Map<string, Record<string, unknown>>();
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select(
      `id, ${PLAYER_NAME_COLUMNS}, avatar_url:arena_avatar_url, level, is_vip, vip_tier, vip_expires_at`
    )
    .in('id', allIds);

  if (profileErr) {
    reportError(profileErr, 'TableInviteService.fetchInvitableContacts.profiles');
  } else if (Array.isArray(profiles)) {
    for (const row of profiles) {
      const id = cleanText((row as { id?: unknown }).id);
      if (id) profileMap.set(id, row as Record<string, unknown>);
    }
  }

  const contacts: InvitableContact[] = allIds.map((id) => {
    const profile = profileMap.get(id);
    return {
      userId: id,
      displayName: playerDisplayName(profile),
      username: cleanText(profile?.username),
      avatarUrl: cleanText(profile?.avatar_url) || undefined,
      level: typeof profile?.level === 'number' ? profile.level : 1,
      vipTier: ringTier(profile as VipColumns | undefined),
      source: sourceByUserId.get(id) ?? 'clubmate',
    };
  });

  contacts.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'friend' ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return contacts;
}

/** What public.fn_send_game_invite answers (20261123013356). */
interface SendGameInviteAnswer {
  ok?: boolean;
  duplicate?: boolean;
  reason?: string;
  path?: string;
  retry_after_seconds?: number;
}

/**
 * Sends one `table_invite` notification to `recipientUserId`, through the
 * server.
 *
 * THE BROWSER NEVER WRITES ANOTHER PLAYER'S INBOX (2026-11-22). This used to
 * insert the friend's notification row itself. Production refuses that write
 * (the browser holds SELECT and UPDATE on notifications and no INSERT policy
 * admits it: World Hub migrations 20261020170027 and 20261020171316), so every
 * in-app invite answered "Could Not Send Invite" and nobody received one. And
 * where a wide INSERT policy did exist it let any account write any notice to
 * anyone. public.fn_send_game_invite is the one door: it checks the friend is
 * a friend or plays in the game's club, that the sender can see the game,
 * names the game the way the share door does (a tournament as its tournament,
 * a Heads Up hold as its table and token), builds the title, sentence and
 * link itself, answers a repeat inside a minute with the first invite and
 * allows 30 a sender in ten minutes.
 *
 * The guards below run first so an impossible tap never reaches the network,
 * and success is reported only when the server says it delivered.
 */
export async function sendInAppTableInvite(
  params: SendTableInviteParams
): Promise<SendTableInviteResult> {
  const recipientUserId = cleanText(params.recipientUserId);
  const senderUserId = cleanText(params.senderUserId);

  if (!recipientUserId || !senderUserId) {
    return {
      ok: false,
      reason: 'invalid_target',
      message: 'Invalid Invite Recipient Or Sender.',
    };
  }

  if (recipientUserId === senderUserId) {
    return {
      ok: false,
      reason: 'self',
      message: 'You Cannot Invite Yourself To A Table.',
    };
  }

  const targetKey = buildTableInviteTargetKey(params);
  const recipientId = normalizeUuid(recipientUserId);
  const tableId = normalizeUuid(params.tableId);
  const tournamentId = normalizeUuid(params.tournamentId);
  const clusterId = normalizeUuid(params.clusterId);
  const namesAGame =
    params.kind === 'lightning'
      ? Boolean(clusterId)
      : params.kind === 'tournament'
        ? Boolean(tournamentId || tableId)
        : Boolean(tableId);
  if (!targetKey || !recipientId || !namesAGame) {
    return {
      ok: false,
      reason: 'invalid_target',
      message: 'No Active Table Target Available For Invite.',
    };
  }

  const now = Date.now();
  const remaining = getTableInviteCooldownRemainingMs(recipientUserId, targetKey, now);
  if (remaining > 0) {
    return {
      ok: false,
      reason: 'cooldown',
      message: 'Invite Already Sent Recently.',
      retryAfterMs: remaining,
    };
  }

  const { data, error } = await supabase.rpc('fn_send_game_invite', {
    p_recipient_id: recipientId,
    p_kind: params.kind,
    p_table_id: tableId,
    p_tournament_id: tournamentId,
    p_cluster_id: clusterId,
    p_invite_code: normalizeInviteCode(params.inviteCode),
    p_invite_token: normalizeInviteToken(params.inviteToken),
  });

  if (error) {
    reportError(error, 'TableInviteService.sendInAppTableInvite');
    return {
      ok: false,
      reason: 'insert_failed',
      message: 'Could Not Send Invite Right Now. Please Try Again.',
    };
  }

  const answer = (data && typeof data === 'object' ? data : {}) as SendGameInviteAnswer;
  if (answer.ok === true && typeof answer.path === 'string' && answer.path.startsWith('/')) {
    pruneExpiredCooldowns(now);
    inviteCooldowns.set(cooldownKeyOf(recipientUserId, targetKey), now + TABLE_INVITE_COOLDOWN_MS);
    return { ok: true, actionUrl: answer.path, cooldownMs: TABLE_INVITE_COOLDOWN_MS };
  }

  const retryAfterMs =
    typeof answer.retry_after_seconds === 'number' && answer.retry_after_seconds > 0
      ? answer.retry_after_seconds * 1000
      : undefined;
  switch (answer.reason) {
    case 'self':
      return { ok: false, reason: 'self', message: 'You Cannot Invite Yourself To A Table.' };
    case 'not_allowed':
      return {
        ok: false,
        reason: 'not_allowed',
        message: 'Only Friends And Clubmates Can Be Invited To This Game.',
      };
    case 'rate_limited':
      return {
        ok: false,
        reason: 'rate_limited',
        message: 'Too Many Invites Sent. Try Again In A Few Minutes.',
        ...(retryAfterMs ? { retryAfterMs } : {}),
      };
    case 'not_found':
    case 'invalid_target':
      return {
        ok: false,
        reason: 'invalid_target',
        message: 'This Game Is No Longer Open For Invites.',
      };
    default:
      // sign_in_required, not_delivered or an answer this client cannot read:
      // never reported as sent.
      reportError(
        new Error(`fn_send_game_invite answered ${String(answer.reason ?? 'unreadable')}`),
        'TableInviteService.sendInAppTableInvite.refused'
      );
      return {
        ok: false,
        reason: 'insert_failed',
        message: 'Could Not Send Invite Right Now. Please Try Again.',
      };
  }
}

/**
 * Looks up the user's most recent active seat (`table_seats.left_at IS NULL`)
 * joined with its live `tables` row so surfaces like ProfilePage can send an
 * in-app table invite when the player is currently seated.
 */
export async function fetchUserActiveTableTarget(
  userId: string
): Promise<ActiveTableInviteTarget | null> {
  const cleanUserId = cleanText(userId);
  if (!cleanUserId) return null;

  const { data: seatRows, error } = await supabase
    .from('table_seats')
    .select(
      'table_id, joined_at, tables!table_seats_table_id_fkey(id, name, club_id, cluster_id, tournament_id, status)'
    )
    .eq('user_id', cleanUserId)
    .is('left_at', null)
    .order('joined_at', { ascending: false })
    .limit(5);

  if (error) {
    reportError(error, 'TableInviteService.fetchUserActiveTableTarget');
    return null;
  }

  if (!Array.isArray(seatRows) || seatRows.length === 0) return null;

  for (const row of seatRows) {
    const rawTable = (row as { tables?: unknown }).tables;
    const tableObj = (Array.isArray(rawTable) ? rawTable[0] : rawTable) as {
      id?: unknown;
      name?: unknown;
      club_id?: unknown;
      cluster_id?: unknown;
      tournament_id?: unknown;
      status?: unknown;
    } | null;

    if (!tableObj) continue;

    const status = cleanText(tableObj.status).toLowerCase();
    if (status && TERMINAL_TABLE_STATUSES.has(status)) continue;

    const tableId = cleanText(tableObj.id) || cleanText((row as { table_id?: unknown }).table_id);
    if (!tableId) continue;

    const tournamentId = cleanText(tableObj.tournament_id) || null;
    const clusterId = cleanText(tableObj.cluster_id) || null;
    const clubId = cleanText(tableObj.club_id) || null;
    const tableName = cleanText(tableObj.name) || 'Active Table';
    const kind: TableInviteKind = tournamentId ? 'tournament' : 'cash';

    return {
      kind,
      tableId,
      tableName,
      clubId,
      clusterId,
      tournamentId,
    };
  }

  return null;
}

/** Resolves an arena display name for a single player ID (safe fallback). */
export async function fetchInviteeDisplayName(userId: string): Promise<string> {
  const cleanUserId = cleanText(userId);
  if (!cleanUserId) return 'Friend';

  const { data, error } = await supabase
    .from('profiles')
    .select(`id, ${PLAYER_NAME_COLUMNS}`)
    .eq('id', cleanUserId)
    .maybeSingle();

  if (error) {
    reportError(error, 'TableInviteService.fetchInviteeDisplayName');
    return 'Friend';
  }

  return data ? playerDisplayName(data) : 'Friend';
}
