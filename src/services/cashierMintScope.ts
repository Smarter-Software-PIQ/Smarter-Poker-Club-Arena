import { supabase } from '../lib/supabase';

export type CashierMintScope = 'club' | 'union';

export async function readCashierMintScope(clubId: string): Promise<CashierMintScope | null> {
  try {
    const { data, error } = await supabase.rpc('fn_cashier_mint_scope', { p_club_id: clubId });
    return !error && (data === 'club' || data === 'union') ? data : null;
  } catch {
    return null;
  }
}
