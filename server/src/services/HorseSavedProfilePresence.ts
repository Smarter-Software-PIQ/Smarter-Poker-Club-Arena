import { SavedProfilePresenceCache } from '../engine/horseDecision/savedProfilePresence.js';

export const horseSavedProfilePresence = new SavedProfilePresenceCache(async (deal, ids) => {
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
});
