/**
 * The mystery bounty pool a pending event holds right now, read live.
 *
 * NO PROJECTED PAYOUTS (Dan, 2026-11-07, verbatim): "NEVER EVER USE
 * 'PROJECTED PAYOUTS' ANYWHERE AND EVER. YOU ONLY USE ACTUAL REAL TIME
 * TOTALS!" Before the chests are sealed this hook used to build a projected
 * tier ladder and a projected chest count. It now returns only the actual
 * total: the mystery share of `tournaments.bounty_pool` as it stands this
 * moment, through the engine's own `mysteryPoolCents` split (the same cap on
 * flat knockouts already paid that `fn_mystery_bounty_seed` applies). The
 * bounties themselves are shown when the engine draws them.
 *
 * Enabled only while the chests have not been sealed. The existing tournament
 * event feed re-reads it as entries, rebuys and add-ons grow the pool.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { runWithRequestDeadline } from '../utils/requestDeadline';
import { reportError } from '../utils/errorReporter';
import { subscribeTournamentStandings } from '../services/tournamentStandingsUpdates';
import { mysteryPoolCents } from '../../server/src/tournament/mysteryBountyActivation';

const COLUMNS =
  'bounty_pool, bounty_pool_paid, mystery_bounty_pool_percent, mystery_bounty_regular_pool_percent';

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** The mystery share of the bounty pool as it stands, in cents of the event's unit grid. */
export function mysteryPoolSoFarCents(
  row: {
    bounty_pool?: unknown;
    bounty_pool_paid?: unknown;
    mystery_bounty_pool_percent?: unknown;
    mystery_bounty_regular_pool_percent?: unknown;
  },
  unitCents: number
): number {
  const moneyUnit = Math.floor(num(unitCents));
  if (!(moneyUnit > 0)) return 0;
  // Chests are whole chips, never fractions, exactly as the engine cuts them.
  const unit = Math.max(100, moneyUnit);
  const pct = (v: unknown) => (v === null || v === undefined ? null : num(v));
  return Math.max(
    0,
    mysteryPoolCents(
      Math.round(num(row.bounty_pool) * 100),
      pct(row.mystery_bounty_pool_percent),
      pct(row.mystery_bounty_regular_pool_percent),
      Math.round(num(row.bounty_pool_paid) * 100),
      unit
    )
  );
}

export function useMysteryBountyPoolSoFar(
  tournamentId: string | null | undefined,
  enabled: boolean,
  unitCents: number
): number | null {
  const scope = JSON.stringify([tournamentId, enabled, unitCents]);
  const [snapshot, setSnapshot] = useState<{ scope: string; poolCents: number | null } | null>(
    null
  );

  useEffect(() => {
    const setPool = (poolCents: number | null) => setSnapshot({ scope, poolCents });
    const controller = new AbortController();
    // A prior event's pool is never the next event's loading placeholder.
    setPool(null);
    if (!enabled || !tournamentId || !(unitCents > 0)) return;
    let alive = true;
    let inFlight = false;
    let queued = false;
    const load = async () => {
      if (!alive) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        const { data: row, error } = await runWithRequestDeadline(
          (signal) =>
            supabase
              .from('tournaments')
              .select(COLUMNS)
              .eq('id', tournamentId)
              .abortSignal(signal)
              .maybeSingle(),
          { signal: controller.signal }
        );
        if (error) throw error;
        if (!alive) return;
        setPool(row ? mysteryPoolSoFarCents(row as Record<string, unknown>, unitCents) : null);
      } catch (err) {
        if (alive) reportError(err, 'useMysteryBountyPoolSoFar.load');
      } finally {
        inFlight = false;
        if (alive && queued) {
          queued = false;
          void load();
        }
      }
    };
    const unsubscribe = subscribeTournamentStandings(tournamentId, () => void load());
    void load();
    return () => {
      alive = false;
      controller.abort();
      queued = false;
      unsubscribe();
    };
  }, [tournamentId, enabled, unitCents, scope]);

  return snapshot?.scope === scope ? snapshot.poolCents : null;
}

export default useMysteryBountyPoolSoFar;
