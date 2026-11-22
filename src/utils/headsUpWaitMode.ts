/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HEADS UP WAIT MODE — Pure URL Token & Persistence Helpers
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bridges the client's Heads-Up Sit N Go opponent choice ("Play Anyone" vs
 * "Specific Player") with the authoritative database state in
 * `public.heads_up_wait_holds` and the RPCs `fn_set_heads_up_wait_mode` /
 * `fn_check_heads_up_seat_invite`.
 */

import type { HeadsUpWaitMode } from '../components/table/HeadsUpWaitingModal';

export type HeadsUpWaitModeDb = 'play_anyone' | 'specific_player';

const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function toHeadsUpWaitModeDb(mode: HeadsUpWaitMode): HeadsUpWaitModeDb {
  return mode === 'specific' ? 'specific_player' : 'play_anyone';
}

export function fromHeadsUpWaitModeDb(raw: unknown): HeadsUpWaitMode | null {
  if (raw === 'specific_player') return 'specific';
  if (raw === 'play_anyone') return 'anyone';
  return null;
}

/** Validate and normalize a Heads-Up specific-player invite token. */
export function normalizeHeadsUpInviteToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return INVITE_TOKEN_RE.test(trimmed) ? trimmed : null;
}

/** Extract `?invite=<TOKEN>` from a router `location.search` string. */
export function parseHeadsUpInviteToken(search: string | null | undefined): string | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    return normalizeHeadsUpInviteToken(params.get('invite'));
  } catch {
    return null;
  }
}

/**
 * Append `?invite=<TOKEN>` (or `&invite=<TOKEN>` if the base URL already has
 * query parameters such as `?i=<CODE>`) without disturbing the path or hash.
 */
export function appendHeadsUpInviteToken(
  baseUrl: string,
  inviteToken: string | null | undefined
): string {
  const token = normalizeHeadsUpInviteToken(inviteToken);
  if (!token) return baseUrl;
  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set('invite', token);
    return parsed.toString();
  } catch {
    const [beforeHash, hash = ''] = baseUrl.split('#', 2);
    const sep = beforeHash.includes('?') ? '&' : '?';
    const hashSuffix = hash ? `#${hash}` : '';
    return `${beforeHash}${sep}invite=${encodeURIComponent(token)}${hashSuffix}`;
  }
}

export function parseHeadsUpHoldExpiresAtMs(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function isHeadsUpHoldActive(
  expiresAtMs: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  return typeof expiresAtMs === 'number' && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

/** Human-readable Title Case copy for `fn_set_heads_up_wait_mode` refusals. */
export function headsUpWaitModeErrorText(reason: string | undefined): string {
  const r = reason ?? '';
  if (/opponent_already_seated/.test(r)) return 'An Opponent Has Already Taken The Other Seat';
  if (/game_already_started/.test(r)) return 'This Game Has Already Started';
  if (/not_seated/.test(r)) return 'Take A Seat First To Set Waiting Mode';
  if (/not_a_heads_up_game/.test(r)) return 'Waiting Mode Is Only Available For Heads Up Games';
  if (/table_not_found|table_closed|game_not_found/.test(r)) return 'This Table Is No Longer Open';
  return 'Could Not Update Waiting Mode, Please Try Again';
}
