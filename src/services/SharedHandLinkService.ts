/**
 * SHORT SHARED-HAND LINKS (2026-11-06).
 *
 * A shared hand used to travel only as /replay?h=<payload>, 480-600
 * characters that messengers wrap or cut, that the sender cannot take back
 * and that nobody can tell was opened. A short link maps an 8-character token
 * to the SAME payload (migration 20261107021555, table ca_shared_hands):
 *
 *   reserve    the sender's token for this exact hand, made when the hand is
 *              opened so the Link tap never waits on the network
 *   markSent   the sender tapped Link or Share with it (fire and forget)
 *   open       anyone holding the link, signed in or not; reads only
 *   countView  a signed-in opener counts one view (fire and forget)
 *   revoke     the sender stops sharing; the next share gets a new token
 *
 * OPENING NEVER WRITES (2026-11-26, migration 20261126054024, issue #9828).
 * fn_ca_shared_hand_open is executable by anon, so it must not write: a
 * SECURITY DEFINER function a caller with no account can execute and that
 * writes is the one shape the live definer-exposure audit refuses outright.
 * The view count is its own door, fn_ca_shared_hand_count_view, which only
 * authenticated and service_role can execute. Club Arena has no server hop
 * in front of this page, so a signed-out visit is not counted.
 *
 * Any failure falls back to the long link, which needs no server at all.
 */
import { supabase } from '../lib/supabase';
import { publicOrigin } from '../lib/appBase';
import { normalizeInviteCode } from '../lib/inviteCode';
import { hasLocalSession } from '../lib/authUtils';
import type { ShareableHand, ShareableCard } from '../components/table/ShareHand';

export const SHARED_HAND_TOKEN_RE = /^[A-HJ-NP-Za-km-z2-9]{8}$/;

export function normalizeSharedHandToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return SHARED_HAND_TOKEN_RE.test(v) ? v : null;
}

/**
 * The address a short link is sent as: smarter.poker/h/<token>, the World Hub
 * page that draws the link preview (hand number, board, pot) for messaging
 * apps and sends a person straight on to /hub/club-arena/h/<token>, the route
 * that opens the hand. The arena route keeps working on its own, so a link
 * sent before this change still opens.
 */
export function shortHandUrl(token: string, origin?: string): string {
  return `${origin ?? publicOrigin()}/h/${token}`;
}

export interface SharedHandPreview {
  handNumber?: string;
  tableName?: string;
  stakes?: string;
  pot?: string;
  board?: string;
  senderName?: string;
  variant?: string;
}

const cardText = (c: ShareableCard | undefined | null): string | null => {
  if (!c) return null;
  const rank = String((c as { rank?: unknown }).rank ?? '').replace('10', 'T');
  const suit = String((c as { suit?: unknown }).suit ?? '')
    .charAt(0)
    .toLowerCase();
  return rank && suit ? `${rank}${suit}` : null;
};

/**
 * The few public facts a link preview draws: never a player's hole cards.
 * The board and the pot are what the whole table saw.
 */
export function previewFromShareable(hand: ShareableHand): SharedHandPreview {
  const board = [...(hand.flop?.cards ?? []), hand.turn?.card, hand.river?.card]
    .map(cardText)
    .filter((c): c is string => !!c)
    .join(' ');
  const hero = hand.players.find((p) => p.isHero);
  const pot = Number(hand.potTotal);
  return {
    handNumber: hand.handNumber == null ? undefined : String(hand.handNumber),
    tableName: hand.tableName || undefined,
    stakes: hand.stakes || undefined,
    pot:
      Number.isFinite(pot) && pot > 0
        ? pot.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : undefined,
    board: board || undefined,
    senderName: hero?.name || undefined,
    variant: hand.variant || undefined,
  };
}

export interface ReservedShortLink {
  token: string;
  sent: boolean;
  views: number;
}

export async function reserveSharedHand(
  payload: string,
  inviteCode: string | null,
  preview: SharedHandPreview
): Promise<ReservedShortLink | null> {
  const { data, error } = await supabase.rpc('fn_ca_shared_hand_reserve', {
    p_payload: payload,
    p_invite_code: normalizeInviteCode(inviteCode),
    p_preview: preview,
  });
  if (error) return null;
  const r = (data || {}) as { success?: boolean; token?: string; sent?: boolean; views?: number };
  const token = normalizeSharedHandToken(r.token);
  if (!r.success || !token) return null;
  return { token, sent: !!r.sent, views: Number(r.views) || 0 };
}

export async function markSharedHandSent(token: string): Promise<void> {
  await supabase.rpc('fn_ca_shared_hand_mark_sent', { p_token: token });
}

export async function revokeSharedHand(token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_ca_shared_hand_revoke', { p_token: token });
  return !error && !!(data as { success?: boolean } | null)?.success;
}

export type OpenedSharedHand =
  | { status: 'open'; payload: string; invite: string | null }
  | { status: 'revoked' }
  | { status: 'missing' }
  | { status: 'unreachable' };

/**
 * One view of an opened link, by a signed-in opener. The database skips the
 * sender's own opens, revoked links and deleted senders. Fire and forget: a
 * view that is not recorded never stands between anybody and the hand.
 */
export async function countSharedHandView(token: string): Promise<void> {
  const valid = normalizeSharedHandToken(token);
  if (!valid || !hasLocalSession()) return;
  try {
    await supabase.rpc('fn_ca_shared_hand_count_view', { p_token: valid });
  } catch {
    // Counting is bookkeeping, never part of opening the hand.
  }
}

/** Anyone holding the link. "unreachable" is its own answer, never "missing". */
export async function openSharedHand(token: string): Promise<OpenedSharedHand> {
  const valid = normalizeSharedHandToken(token);
  if (!valid) return { status: 'missing' };
  // A read: it records nothing, so a signed-out visitor can open it.
  const { data, error } = await supabase.rpc('fn_ca_shared_hand_open', { p_token: valid });
  if (error) return { status: 'unreachable' };
  const r = (data || {}) as {
    found?: boolean;
    revoked?: boolean;
    payload?: string;
    invite?: string | null;
  };
  if (!r.found) return { status: 'missing' };
  if (r.revoked) return { status: 'revoked' };
  if (typeof r.payload !== 'string' || !r.payload) return { status: 'missing' };
  void countSharedHandView(valid);
  return { status: 'open', payload: r.payload, invite: normalizeInviteCode(r.invite ?? null) };
}
