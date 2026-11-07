/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  THE HOUSE SHARE STILL DUE ON A GUARANTEED EVENT, READ ONCE FOR EVERY SURFACE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * fn_ca_tournament_prize_funding is the authority on what a guaranteed event
 * has collected and what the house still owes if the field closes now. This
 * hook was RewardsTab's private fetch (2026-11-06) and is now shared, because
 * on 2026-11-07 the same event read four ways: Rewards printed "Guaranteed
 * 1,856" under first place while the lobby panel's Projected column, the
 * table-side Prizes tab and the arena tournaments page priced the same place
 * on the places-only pool (1,196) and said nothing about the guarantee at
 * all. One fetch, one shape, one invalidation rule, so the four surfaces
 * cannot disagree on the same row again.
 *
 * Behaviour, kept exactly as RewardsTab had it:
 *   - nothing is fetched unless the event carries a guarantee;
 *   - every read runs under the request deadline and aborts the previous one;
 *   - a standings update re-reads (registrations move the pool);
 *   - the result is keyed on the tournament's pool columns, so a stale read
 *     for an older pool is never shown against a newer row;
 *   - an unreadable or mismatched answer is `null`, never zero (CLAUDE.md
 *     10.86: a signal that answers when it does not know).
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { runWithRequestDeadline } from '../utils/requestDeadline';
import { reportError } from '../utils/errorReporter';
import { subscribeTournamentStandings } from '../services/tournamentStandingsUpdates';

export interface TournamentPrizeFunding {
  key: string;
  collected: number;
  overlay: number;
  /** Gross player payments credited toward the buy-in guarantee. */
  grossCoverage: number | null;
  /** H = max(0, guarantee - gross): the house's whole obligation. */
  houseRequired: number | null;
  /** House / promo funding already posted, net of returns. */
  housePosted: number | null;
  /** What the house still adds at close: required minus already posted. */
  houseDue: number | null;
}

/** The tournament columns the funding read is keyed on and gated by. */
export interface TournamentPrizeFundingRow {
  prize_pool?: number | string | null;
  bounty_pool?: number | string | null;
  prize_pool_finalized?: boolean | null;
  guaranteed_prize?: number | string | null;
}

export function tournamentPrizeFundingKey(
  tournamentId: string | null | undefined,
  row: TournamentPrizeFundingRow | null | undefined
): string {
  return `${tournamentId}:${row?.prize_pool}:${row?.bounty_pool}:${row?.prize_pool_finalized}`;
}

/**
 * The funding read for this tournament row, or `null` while it is unknown,
 * unavailable, or still keyed to an older pool. `reportContext` names the
 * surface in the error report so a failed read is attributable.
 */
export function useTournamentPrizeFunding(
  tournamentId: string | null | undefined,
  row: TournamentPrizeFundingRow | null | undefined,
  reportContext = 'useTournamentPrizeFunding.prize_funding_load_failed'
): TournamentPrizeFunding | null {
  const guaranteedPrize = row?.guaranteed_prize;
  const fundingKey = tournamentPrizeFundingKey(tournamentId, row);
  const [funding, setFunding] = useState<TournamentPrizeFunding | null>(null);
  useEffect(() => {
    if (!tournamentId || !(Number(guaranteedPrize) > 0)) return;
    let cancelled = false;
    let active: AbortController | null = null;
    const load = async () => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      try {
        const { data, error } = await runWithRequestDeadline(
          (signal) =>
            supabase
              .rpc('fn_ca_tournament_prize_funding', {
                p_tournament_id: tournamentId,
              })
              .abortSignal(signal),
          { signal: controller.signal }
        );
        if (error) throw error;
        if (cancelled || controller.signal.aborted) return;
        if (
          !data ||
          data.tournament_id !== tournamentId ||
          !Number.isFinite(Number(data.collected)) ||
          !Number.isFinite(Number(data.overlay))
        ) {
          setFunding(null);
          return;
        }
        const optional = (v: unknown) =>
          v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
        setFunding({
          key: fundingKey,
          collected: Number(data.collected),
          overlay: Number(data.overlay),
          grossCoverage: optional(data.gross_coverage),
          houseRequired: optional(data.house_required),
          housePosted: optional(data.house_posted),
          houseDue: optional(data.house_due),
        });
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setFunding(null);
          reportError(error, reportContext);
        }
      }
    };
    const unsubscribe = subscribeTournamentStandings(tournamentId, () => void load());
    void load();
    return () => {
      cancelled = true;
      active?.abort();
      unsubscribe();
    };
  }, [tournamentId, fundingKey, guaranteedPrize, reportContext]);
  return funding?.key === fundingKey ? funding : null;
}
