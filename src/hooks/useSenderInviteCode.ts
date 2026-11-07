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

const ACTIVE = ['active', 'approved', 'automatic'];

async function clubForTable(tableId: string): Promise<string | null> {
  const { data } = await supabase.from('tables').select('club_id').eq('id', tableId).maybeSingle();
  return (data as { club_id?: string | null } | null)?.club_id ?? null;
}

async function ownActiveClub(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('club_members')
    .select('club_id, joined_at')
    .eq('user_id', userId)
    .in('status', ACTIVE)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
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

/** Resolve the sender's invite code for a hand on this table (null when there is none). */
export async function resolveSenderInviteCode(
  tableId: string | null | undefined,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null;
  try {
    const hostCode = tableId ? await codeFor(await clubForTable(tableId)) : null;
    return hostCode ?? (await codeFor(await ownActiveClub(userId)));
  } catch {
    return null;
  }
}

export function useSenderInviteCode(
  tableId: string | null | undefined,
  userId: string | null | undefined,
  enabled = true
): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !userId) {
      setCode(null);
      return;
    }
    let cancelled = false;
    void resolveSenderInviteCode(tableId, userId).then((c) => {
      if (!cancelled) setCode(c);
    });
    return () => {
      cancelled = true;
    };
  }, [tableId, userId, enabled]);
  return code;
}
