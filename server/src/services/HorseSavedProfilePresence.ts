import { SavedProfilePresenceCache } from '../engine/horseDecision/savedProfilePresence.js';
import { bindToProcessRoot } from './supabase/dataActorContext.js';

// 2026-11-24 (incident 1e532243): run this read-only presence probe at process
// root (service actor) so priming during tournament dealHand never takes
// FOR KEY SHARE on engine_tournament_leases or consumes EventDbBulkhead permits.
export const horseSavedProfilePresence = new SavedProfilePresenceCache(
  bindToProcessRoot(async (deal, ids) => {
    const { supabase } = await import('./supabase/client.js');
    const size = deal.roster.length <= 2 ? 'hu' : deal.roster.length <= 5 ? 'short' : 'full';
    const { data, error } = await supabase
      .rpc('fn_horse_saved_profile_presence', {
        p_user_ids: ids,
        p_variant: deal.variant,
        p_mode: deal.mode,
        p_size: size,
        p_domain: deal.domain,
      })
      .abortSignal(AbortSignal.timeout(1500));
    return error ? null : data;
  })
);
