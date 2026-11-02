/**
 * WHAT A RABBIT HUNT WILL COST, AND THE RUN-OUTS YOU ALREADY OWN (2026-11-02).
 *
 * fn_rabbit_hunt_charge_preview answers, read only, what the caller's NEXT
 * rabbit hunt would draw on, in exactly fn_consume_rabbit_hunt_v2's order:
 * Lifetime VIP (free), the soonest-expiring credit, the monthly VIP allowance
 * (100), another credit, then diamonds. The engine still decides and charges;
 * this only lets the player see the price before tapping.
 *
 * fn_rabbit_hunt_owned_runout returns the cards a player already bought for a
 * hand, kept after the shared saved run-out is pruned. Only the caller's own.
 */
import { supabase } from '../lib/supabase';

export type RabbitHuntChargePreview =
  | { source: 'lifetime_vip'; creditsLeft: number }
  | {
      source: 'credit';
      creditSource: string | null;
      creditExpiresAt: number | null;
      creditsLeft: number;
      isVip: boolean;
      vipRemaining: number | null;
    }
  | { source: 'vip_allowance'; vipRemaining: number; creditsLeft: number }
  | {
      source: 'diamonds';
      cost: number;
      balance: number;
      affordable: boolean;
      isVip: boolean;
      vipRemaining: number | null;
      creditsLeft: number;
    }
  | { source: 'signed_out' }
  | { source: 'error' };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseRabbitHuntChargePreview(data: unknown): RabbitHuntChargePreview {
  if (!data || typeof data !== 'object') return { source: 'error' };
  const row = data as Record<string, unknown>;
  const creditsLeft = num(row.credits_left) ?? 0;
  const vipRemaining = num(row.vip_remaining);
  switch (row.source) {
    case 'signed_out':
      return { source: 'signed_out' };
    case 'lifetime_vip':
      return { source: 'lifetime_vip', creditsLeft };
    case 'credit': {
      const expires =
        typeof row.credit_expires_at === 'string' ? Date.parse(row.credit_expires_at) : NaN;
      return {
        source: 'credit',
        creditSource: typeof row.credit_source === 'string' ? row.credit_source : null,
        creditExpiresAt: Number.isFinite(expires) ? expires : null,
        creditsLeft,
        isVip: row.is_vip === true,
        vipRemaining,
      };
    }
    case 'vip_allowance':
      return vipRemaining === null
        ? { source: 'error' }
        : { source: 'vip_allowance', vipRemaining, creditsLeft };
    case 'diamonds': {
      const cost = num(row.cost_diamonds);
      if (cost === null) return { source: 'error' };
      const balance = num(row.diamonds_balance) ?? 0;
      return {
        source: 'diamonds',
        cost,
        balance,
        affordable: row.affordable === true,
        isVip: row.is_vip === true,
        vipRemaining,
        creditsLeft,
      };
    }
    default:
      return { source: 'error' };
  }
}

export async function fetchRabbitHuntChargePreview(): Promise<RabbitHuntChargePreview> {
  try {
    const { data, error } = await supabase.rpc('fn_rabbit_hunt_charge_preview');
    if (error) return { source: 'error' };
    return parseRabbitHuntChargePreview(data);
  } catch {
    return { source: 'error' };
  }
}

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** The one line shown under a rabbit hunt button: what this tap will use. */
export function describeRabbitHuntCharge(p: RabbitHuntChargePreview | null): string | null {
  if (!p) return null;
  switch (p.source) {
    case 'lifetime_vip':
      return 'Free With Lifetime VIP';
    case 'credit':
      return p.creditExpiresAt !== null
        ? `Uses 1 Rabbit Hunt Credit (Expires ${shortDate(p.creditExpiresAt)})`
        : 'Uses 1 Rabbit Hunt Credit';
    case 'vip_allowance':
      return `Uses 1 VIP Rabbit Hunt (${p.vipRemaining} Left This Month)`;
    case 'diamonds':
      return p.affordable
        ? `Costs ${p.cost} Diamonds`
        : `Costs ${p.cost} Diamonds (You Have ${p.balance})`;
    default:
      return null;
  }
}

/** The live allowance line under the Auto Run Rabbit Hunt setting. */
export function describeAutoRunAllowance(p: RabbitHuntChargePreview | null): string | null {
  if (!p) return null;
  const credits = (n: number) => (n > 0 ? ` · ${n} Credit${n === 1 ? '' : 's'}` : '');
  switch (p.source) {
    case 'lifetime_vip':
      return 'Lifetime VIP: Unlimited Reveals';
    case 'vip_allowance':
      return `${p.vipRemaining} VIP Rabbit Hunts Left This Month${credits(p.creditsLeft)}`;
    case 'credit':
      return p.vipRemaining !== null
        ? `${p.vipRemaining} VIP Rabbit Hunts Left This Month${credits(p.creditsLeft)}`
        : `${p.creditsLeft} Credit${p.creditsLeft === 1 ? '' : 's'} Left`;
    case 'diamonds':
      return p.vipRemaining === 0
        ? `VIP Rabbit Hunts Used Up This Month. Next Reveals Cost ${p.cost} Diamonds`
        : `Next Reveals Cost ${p.cost} Diamonds`;
    default:
      return null;
  }
}

export interface OwnedRunout {
  cards: Array<{ rank: string; suit: string }>;
  boardLen: number;
  ownedAt: number;
}

export function parseOwnedRunout(data: unknown): OwnedRunout | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (row.owned !== true || !Array.isArray(row.cards) || row.cards.length === 0) return null;
  const cards = row.cards.filter(
    (c): c is { rank: string; suit: string } =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as { rank?: unknown }).rank === 'string' &&
      typeof (c as { suit?: unknown }).suit === 'string'
  );
  if (cards.length !== row.cards.length) return null;
  const ownedAt = Date.parse(String(row.owned_at ?? ''));
  return {
    cards,
    boardLen: num(row.board_len) ?? 0,
    ownedAt: Number.isFinite(ownedAt) ? ownedAt : 0,
  };
}

export async function fetchOwnedRunout(
  tableId: string,
  handNumber: number
): Promise<OwnedRunout | null> {
  try {
    const { data, error } = await supabase.rpc('fn_rabbit_hunt_owned_runout', {
      p_table_id: tableId,
      p_hand_number: handNumber,
    });
    if (error) return null;
    return parseOwnedRunout(data);
  } catch {
    return null;
  }
}
