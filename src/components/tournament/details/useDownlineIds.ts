/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  useDownlineIds — "which of these players are MINE?"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-08-25: "IF AN AGENT, SUPER AGENT, OR SUB AGENT HAS 'DOWNLINES' IN A
 * TOURNAMENT THEY SHOULD BE HIGHLIGHTED IN THE RANKINGS, TO EASILY SHOW THE
 * AGENT WHICH OF HIS PLAYERS ARE IN, AND HOW THEY ARE DOING."
 *
 * Dan 2026-11-06: "THE 'MINE ONLY' TAKES TOO LONG TO APPEAR ... KINGFISH
 * SHOULD ONLY BE SHOWN THE DOWNLINES INSIDE OF THE CLUB HES CURRENTLY INSIDE
 * OF, (SAME WITH AGENTS AND EVERYTHING ELSE) IT SHOULD ONLY SHOW THE CURRENT
 * CLUBS DOWNLINES THAT ARE STILL INSIDE THE CLUB."
 *
 * ONE CLUB, ONE CALL. The club is the one the viewer is inside (the caller
 * passes it: the route's `:clubId`, else the club they entered through). The
 * server reader `ca_tournament_my_downline_ids` checks that club belongs to the
 * tournament's scope, reads the viewer's role there, and returns user ids
 * only: every active member for owner / co-owner / admin, the recursive agent
 * subtree for super agent / agent / sub agent, nothing for a plain player.
 * Members who left the club and deleted profiles are never returned.
 *
 * What this replaced, and why it was slow: a walk over the whole union scope
 * that called the full roster reader (wallets, fees, hands, counts) for every
 * club the viewer staffed, page by page, and kept only user_id - about 16.6 s
 * for KingFish on a Midway Union event, measured 2026-11-07. It also unioned
 * every club's players, which is the scope bug above. The new read is 2-8 ms.
 *
 * Never publish a partial or stale set: a failure or a deadline draws no
 * highlight and no legend rather than a wrong claim.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { reportError } from '../../../utils/errorReporter';
import { runWithRequestDeadline } from '../../../utils/requestDeadline';

export interface DownlineResult {
  /** User ids beneath the viewer in the current club. Never the viewer. */
  downlineIds: Set<string>;
  /** True when the viewer has anyone beneath them in the current club. */
  carriesDownline: boolean;
  /** True while the first resolution is still in flight. */
  loading: boolean;
}

const EMPTY_IDS: Set<string> = new Set();

export function useDownlineIds(
  userId: string | undefined | null,
  tournamentId: string | undefined | null,
  viewerClubId: string | undefined | null
): DownlineResult {
  const [downlineIds, setDownlineIds] = useState<Set<string>>(EMPTY_IDS);
  const [loading, setLoading] = useState(false);
  const scopeKey = JSON.stringify([userId || null, tournamentId || null, viewerClubId || null]);
  const [snapshotScope, setSnapshotScope] = useState<string | null>(null);
  const enabled = Boolean(userId && tournamentId && viewerClubId);

  useEffect(() => {
    setSnapshotScope(scopeKey);
    setDownlineIds(EMPTY_IDS);
    // Nobody signed in, no tournament, or not inside a club: there is no
    // "mine" to ask about.
    if (!userId || !tournamentId || !viewerClubId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    (async () => {
      try {
        const { data, error } = await runWithRequestDeadline(
          (signal) =>
            supabase
              .rpc('ca_tournament_my_downline_ids', {
                p_tournament_id: tournamentId,
                p_club_id: viewerClubId,
              })
              .abortSignal(signal),
          { signal: controller.signal }
        );
        if (cancelled) return;
        if (error) throw error;
        if (!Array.isArray(data) || data.some((id) => typeof id !== 'string' || !id)) {
          throw new Error('The Downline Response Was Incomplete');
        }
        const collected = new Set<string>(data as string[]);
        collected.delete(userId);
        setDownlineIds(collected);
      } catch (err) {
        if (cancelled) return;
        reportError(err, 'useDownlineIds.resolve');
        setDownlineIds(EMPTY_IDS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [userId, tournamentId, viewerClubId, scopeKey]);

  // Effects run after paint; a new viewer/club must never see the old set.
  if (snapshotScope !== scopeKey) {
    return { downlineIds: EMPTY_IDS, carriesDownline: false, loading: enabled };
  }
  return { downlineIds, carriesDownline: downlineIds.size > 0, loading };
}

export default useDownlineIds;
