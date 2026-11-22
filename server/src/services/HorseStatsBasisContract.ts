import { supabase } from './supabase/client.js';
import { reportError } from './errorReporter.js';
import {
  HORSE_HOLE_CARDS_STATS_KEY,
  STATS_FACTS_GATED_KEYS,
  type StatsFactsGatedKey,
} from './supabase/handFacts.js';

/**
 * WHICH OPTIONAL STATS KEYS THE INSTALLED RETENTION BASIS ACCEPTS (review B1, 2026-11-19).
 *
 * smarter_private.horse_compact_stats_basis refuses any top-level stats_facts key it does not know, and the
 * hand_history retention path stops on the refusal (2026-10-25: the horse_rollups key stopped
 * sp_prune_hand_history for eleven days). So the engine attaches a new key only after the database says its
 * installed basis accepts it: public.horse_stats_basis_accepted_keys() (migration 20261120025753, service
 * role only) runs the basis on a minimal payload per candidate key and returns {contract: 1, accepted: [...]}.
 *
 * Asked once, outside the action clock, then refreshed in the background every REFRESH_MS: the answer in
 * hand is returned at once and the next one replaces it. Unknown (function absent, an error, a malformed
 * answer, no answer yet) is "not accepted": the key stays off. No polling on the hand path, no repair.
 */
export const HORSE_STATS_BASIS_REFRESH_MS = 10 * 60 * 1000;

let accepted: ReadonlySet<string> | undefined;
let askedAt = 0;
let inflight: Promise<ReadonlySet<string>> | undefined;

const NONE: ReadonlySet<string> = new Set();

function ask(): Promise<ReadonlySet<string>> {
  return (inflight ??= (async () => {
    try {
      const { data, error } = await supabase.rpc('horse_stats_basis_accepted_keys');
      const list = (data as { contract?: unknown; accepted?: unknown } | null)?.accepted;
      if (
        error ||
        (data as { contract?: unknown } | null)?.contract !== 1 ||
        !Array.isArray(list) ||
        !list.every((k) => typeof k === 'string')
      ) {
        reportError(
          new Error(error?.message ?? 'stats basis accepted keys are unavailable'),
          'HorseStatsBasisContract.gatedKeysOff'
        );
        return NONE;
      }
      // only the keys the engine knows: the database cannot widen what the engine sends
      return new Set(list.filter((k) => (STATS_FACTS_GATED_KEYS as readonly string[]).includes(k)));
    } catch (err) {
      reportError(err, 'HorseStatsBasisContract.gatedKeysOff');
      return NONE;
    } finally {
      askedAt = Date.now();
    }
  })().then((set) => {
    accepted = set;
    inflight = undefined;
    return set;
  }));
}

/** Whether the installed retention basis accepts `key`. Never throws. */
export async function statsBasisAccepts(key: StatsFactsGatedKey): Promise<boolean> {
  try {
    if (accepted === undefined) return (await ask()).has(key);
    if (Date.now() - askedAt >= HORSE_STATS_BASIS_REFRESH_MS) void ask();
    return accepted.has(key);
  } catch {
    return false;
  }
}

/** The Horse hole-card stats key (HORSE_HOLE_CARDS_STATS_KEY) may be sent; handFacts.ts attaches it only then. */
export function horseHoleCardsBasisContract(): Promise<boolean> {
  return statsBasisAccepts(HORSE_HOLE_CARDS_STATS_KEY);
}

/** Tests only: forget the answer. */
export function resetHorseStatsBasisContractForTests(): void {
  accepted = undefined;
  askedAt = 0;
  inflight = undefined;
}
