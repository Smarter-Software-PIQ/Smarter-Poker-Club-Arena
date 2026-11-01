import { supabase } from './supabase.js';
import {
  validOpponentProfile,
  type DurableOpponentProfile,
} from '../engine/HorseOpponentMemory.js';

export interface HorsePooledPublicBootstrap {
  availableAtMs: number;
  profiles: DurableOpponentProfile[];
}

/** The worker cache's capacity (pooledPublicProfiles.ts). */
export const HORSE_POOLED_BOOTSTRAP_CAPACITY = 32768;
/** One PostgREST page. */
export const HORSE_POOLED_BOOTSTRAP_PAGE = 1000;
/**
 * The whole boot read's budget. It runs beside the other boot loads, before
 * READY, and measured worker boots take about 35 s (engine /health
 * liveHorseDecision startedAt -> readyAt, 2026-10-31), so 30 s does not extend
 * readiness. The previous 5 s budget could not carry ~30 pages of ~1 MB each
 * from the engine host: from 2026-10-28 to 2026-10-31 every boot reported
 * horse_pooled_public_bootstrap_unavailable and none reported _loaded.
 */
export const HORSE_POOLED_BOOTSTRAP_BUDGET_MS = 30000;
/** A player holds at most variants x modes x sizes rows (9 x 2 x 3). */
const MAX_ROWS_PER_PLAYER = 54;

type Page = (
  afterUserId: string | null,
  signal: AbortSignal
) => Promise<{ data: unknown; error: unknown }>;

const readPage: Page = (afterUserId, signal) => {
  let query = supabase
    .from('horse_exploit_profiles')
    .select('user_id,variant,mode,size,counters,observed_hands,initialized')
    .gt('observed_hands', 0);
  if (afterUserId !== null) query = query.gt('user_id', afterUserId);
  return query
    .order('user_id')
    .order('variant')
    .order('mode')
    .order('size')
    .limit(HORSE_POOLED_BOOTSTRAP_PAGE)
    .abortSignal(signal) as unknown as Promise<{ data: unknown; error: unknown }>;
};

/**
 * One finite saved-only boot read before READY, not a turn request, history
 * backfill, initializer or watcher. A failed or inconsistent read supplies no
 * bootstrap; accepted-hand public updates can still warm the cache.
 *
 * KEYSET, NOT OFFSET (2026-10-31). Offset pages shift when a profile row is
 * inserted between two pages, so a live table returned a duplicate key and the
 * whole read was discarded. Each page now starts after the last COMPLETE
 * player: the trailing player of a full page is re-read whole by the next page
 * (a player has at most 54 rows, a page holds 1,000), so no row is skipped or
 * read twice. Rows with no observed hand carry no read and are not loaded.
 * More profiles than the cache holds keep the most-observed ones instead of
 * loading nothing.
 */
export async function readHorsePooledPublicBootstrap(
  page: Page = readPage,
  budgetMs = HORSE_POOLED_BOOTSTRAP_BUDGET_MS
): Promise<HorsePooledPublicBootstrap | null> {
  const profiles: DurableOpponentProfile[] = [];
  const seen = new Set<string>();
  const deadline = AbortSignal.timeout(budgetMs);
  let after: string | null = null;
  try {
    // Bounded: every full page advances past at least one complete player.
    for (let pages = 0; pages <= 2 + (4 * HORSE_POOLED_BOOTSTRAP_CAPACITY) / 50; pages++) {
      const { data, error } = await page(after, deadline);
      if (error || !Array.isArray(data) || data.length > HORSE_POOLED_BOOTSTRAP_PAGE) return null;
      const full = data.length === HORSE_POOLED_BOOTSTRAP_PAGE;
      const lastUser = full ? (data[data.length - 1] as { user_id?: unknown }).user_id : null;
      if (full && typeof lastUser !== 'string') return null;
      let kept = 0;
      for (const row of data) {
        if (!validOpponentProfile(row)) return null;
        // The trailing player of a full page may continue on the next page.
        if (full && row.user_id === lastUser) continue;
        if (after !== null && row.user_id <= after) return null;
        const key = JSON.stringify([row.user_id, row.variant, row.mode, row.size]);
        if (seen.has(key)) return null;
        seen.add(key);
        profiles.push(row);
        kept++;
      }
      if (!full) {
        if (profiles.length > HORSE_POOLED_BOOTSTRAP_CAPACITY) {
          profiles.sort(
            (a, b) =>
              b.observed_hands - a.observed_hands ||
              (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0) ||
              (a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0) ||
              (a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : 0) ||
              (a.size < b.size ? -1 : a.size > b.size ? 1 : 0)
          );
          profiles.length = HORSE_POOLED_BOOTSTRAP_CAPACITY;
        }
        return { availableAtMs: Date.now(), profiles };
      }
      // A full page whose only player is the trailing one cannot advance.
      if (kept === 0 || HORSE_POOLED_BOOTSTRAP_PAGE <= MAX_ROWS_PER_PLAYER) return null;
      after = profiles[profiles.length - 1]!.user_id;
    }
  } catch {
    /* unavailable remains distinct from an empty successful read */
  }
  return null;
}
