/**
 * THE PRICE BEHIND A FOLD-TO-RAISE CELL (Horse decisions lane, 2026-11-19).
 *
 * The street read keeps how often a player folds when his own bet or raise is raised (HorseOmahaStreetRead,
 * foldToRaise by street). It does not keep what those raises cost him to call, so a consumer that prices a raise
 * of another size has to assume the cell was measured at one reference price. This module keeps, beside each
 * fold-to-raise cell, the sum of the prices of the raises behind it and the count of raises that had a price, so
 * the cell's mean price is sum / opp.
 *
 * THE PRICE of one opportunity is what he had to add to call over the pot he would be calling into:
 * increment / (pot + call + increment), where increment is the raise-to less the wager he had made on the street,
 * pot is the chips on the table before the raise (his wager included) and call is the raiser's call of that wager
 * (the measurement behind omahaPricedSampledFoldAtPrice, archive sampledraise-01TLQer7J/fold-by-price.py). On the
 * record that is the amount he must add when the action returns to him over every chip in the pot at that moment;
 * the two are the same number when only the raiser acted in between, and when others called in between their
 * chips are in the pot he is offered too.
 *
 * The opportunity is the street read's own (streetReadHandIncrements, the foldToRaise branch): he had bet or
 * raised on the street, another player raised, and he acted; at most once per player per street per hand; the
 * same admission (voluntary, attributed, never forced). An opportunity whose price cannot be named (no pot size
 * on the record, nothing to add, a price outside (0, 1]) adds nothing here, so `opp` counts priced raises only
 * and sum / opp is a true mean whatever the street cell held before this record existed.
 *
 * Public actions and the public pot size only. Kept in its own record (horse_exact_profiles.street_counters_price,
 * migration 20261119192551; public.fn_horse_street_price_increments and fn_horse_street_price_add are the SQL
 * twins) so the street read's validation and its 34-number wire row are untouched. Carried into an Omaha
 * decision's own state (HorseMindSandbox.pooledStreetPrice, read frame v20) and answered by
 * HorseMind.omahaFoldToRaisePriceOf. Read by one consumer only (horse decisions stack 2): with the default-off
 * omahaReadIsByStreetAndTexture and omahaSampledRaiseIsPricedAtEverySize both on, the street read's fold-to-raise
 * cell carries this mean as its price (HorseOmahaReadByStreetRule, OmahaPricedCell.price); otherwise nothing reads it.
 */
import { learnablePublicAction, type ExploitHandAction } from './HorseOpponentExploit.js';
import {
  POSTFLOP_STREETS,
  STREET_READ_DECAY,
  type PostflopStreet,
} from './HorseOmahaStreetRead.js';

/** The priced raises behind one fold-to-raise cell: the sum of their prices and how many there were. */
export interface StreetPriceCell {
  sum: number;
  opp: number;
}
export interface StreetPriceCounters {
  foldToRaise: Record<PostflopStreet, StreetPriceCell>;
}
export function emptyStreetPrice(): StreetPriceCounters {
  return {
    foldToRaise: { flop: { sum: 0, opp: 0 }, turn: { sum: 0, opp: 0 }, river: { sum: 0, opp: 0 } },
  };
}

const VOLUNTARY: ReadonlySet<string> = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);
const aggressive = (a: ExploitHandAction): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);
const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/** An amount of the public record: a finite number under 1e12, else 0; never negative. */
const amountOf = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12 ? Math.max(0, v) : 0;

/** What one postflop action adds to the pot, given the player's total on the street so far: bet, raise and
 *  all-in amounts are street totals, a call is an increment, a fold or a check adds nothing. */
function increment(action: string, amount: number, prev: number): number {
  if (action === 'bet' || action === 'raise' || action === 'all_in')
    return Math.max(0, amount - prev);
  return action === 'call' ? amount : 0;
}

/**
 * One completed hand -> each player's priced fold-to-raise opportunities by street. `potSize` is the hand's
 * public pot (hand_history.pot_size: every chip put in, uncalled bets returned taken off); the pot before the
 * flop is that less what the postflop streets added. Nothing when the pot size is not on the record.
 */
export function streetPriceHandIncrements(
  actions: unknown,
  potSize: unknown
): Map<string, StreetPriceCounters> {
  const out = new Map<string, StreetPriceCounters>();
  if (!Array.isArray(actions)) return out;
  if (typeof potSize !== 'number' || !Number.isFinite(potSize) || !(potSize > 0 && potSize < 1e12))
    return out;
  const postflop = (a: unknown): a is ExploitHandAction & { userId: string } =>
    plainObject(a) &&
    typeof a.userId === 'string' &&
    !!a.userId &&
    typeof a.action === 'string' &&
    (a.stage === 'flop' || a.stage === 'turn' || a.stage === 'river');
  // First pass: what the postflop streets added to the pot.
  let added = 0;
  {
    let stage: string | null = null;
    let street = new Map<string, number>();
    for (const a of actions) {
      if (!postflop(a)) continue;
      if (a.stage !== stage) {
        stage = a.stage;
        street = new Map();
      }
      const amount = amountOf(a.amount);
      if (a.action === 'return') {
        added -= amount;
        continue;
      }
      if (!VOLUNTARY.has(a.action)) continue;
      const prev = street.get(a.userId) ?? 0;
      const inc = increment(a.action, amount, prev);
      street.set(a.userId, prev + inc);
      added += inc;
    }
  }
  let pot = potSize - added;
  if (!(pot > 0)) return out;
  // Second pass: the street read's fold-to-raise opportunity, with the price it was offered at.
  let stage: string | null = null;
  let street = new Map<string, number>();
  let toMatch = 0;
  let bettor: string | null = null;
  let wagered = new Set<string>();
  const seen = new Set<string>();
  for (const a of actions) {
    if (!postflop(a)) continue;
    const id = a.userId;
    if (a.stage !== stage) {
      stage = a.stage;
      street = new Map();
      toMatch = 0;
      bettor = null;
      wagered = new Set();
    }
    const amount = amountOf(a.amount);
    if (a.action === 'return') {
      pot -= amount;
      continue;
    }
    if (!VOLUNTARY.has(a.action)) continue;
    const prev = street.get(id) ?? 0;
    if (learnablePublicAction(a)) {
      if (bettor !== null && bettor !== id && wagered.has(id) && !seen.has(`${stage}:${id}`)) {
        seen.add(`${stage}:${id}`);
        const toCall = toMatch - prev;
        const price = toCall > 0 && pot > 0 ? toCall / pot : 0;
        if (price > 0 && price <= 1) {
          let r = out.get(id);
          if (!r) out.set(id, (r = emptyStreetPrice()));
          const cell = r.foldToRaise[stage as PostflopStreet];
          cell.sum += price;
          cell.opp += 1;
        }
      }
      if (aggressive(a)) {
        bettor = id;
        wagered.add(id);
      }
    }
    const inc = increment(a.action, amount, prev);
    street.set(id, prev + inc);
    pot += inc;
    if (prev + inc > toMatch) toMatch = prev + inc;
  }
  return out;
}

const STREET_KEYS: readonly PostflopStreet[] = POSTFLOP_STREETS;
const exactKeys = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  plainObject(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
/**
 * A stored record is usable only when it is exactly {foldToRaise: {flop, turn, river}}, each cell exactly
 * {sum, opp}, every number finite and non-negative and sum <= opp (a price is at most 1). The validation every
 * reader of horse_exact_profiles.street_counters_price applies; a record that fails is read as absent.
 */
export function validStreetPrice(r: unknown): r is StreetPriceCounters {
  if (!exactKeys(r, ['foldToRaise'])) return false;
  const group = r.foldToRaise;
  if (!exactKeys(group, STREET_KEYS)) return false;
  for (const s of STREET_KEYS) {
    const c = group[s];
    if (!exactKeys(c, ['sum', 'opp'])) return false;
    const { sum, opp } = c as unknown as StreetPriceCell;
    if (
      typeof sum !== 'number' ||
      typeof opp !== 'number' ||
      !Number.isFinite(sum) ||
      !Number.isFinite(opp) ||
      sum < 0 ||
      sum > opp + 1e-9
    )
      return false;
  }
  return true;
}
/** A detached copy of a valid record. */
export function copyStreetPrice(r: StreetPriceCounters): StreetPriceCounters {
  const out = emptyStreetPrice();
  for (const s of STREET_KEYS) {
    out.foldToRaise[s].sum = r.foldToRaise[s].sum;
    out.foldToRaise[s].opp = r.foldToRaise[s].opp;
  }
  return out;
}

/**
 * The TypeScript twin of public.fn_horse_street_price_add(base, delta): a cell that took a priced raise ages by
 * STREET_READ_DECAY (the street read's own half-life of 30 opportunities) and takes the hand's sum and count;
 * every other cell is unchanged. A hand with none returns the base itself (null stays null). A stored or supplied
 * value that is not a number, or is 1e12 or more in size, counts as 0. Neither argument is mutated.
 */
export function addStreetPriceEvidence(
  base: StreetPriceCounters | null | undefined,
  inc: StreetPriceCounters | null | undefined
): StreetPriceCounters | null {
  // A number is read only under 1e12 in size (the SQL twin casts to float8 only then, so a damaged stored
  // value can never raise inside the accepted-hand transaction); anything else counts as 0.
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12 ? v : 0;
  const cellOf = (r: unknown, s: PostflopStreet): StreetPriceCell => {
    const g = plainObject(r) && plainObject(r.foldToRaise) ? r.foldToRaise[s] : null;
    return plainObject(g) ? { sum: num(g.sum), opp: num(g.opp) } : { sum: 0, opp: 0 };
  };
  if (!plainObject(inc)) return base ?? null;
  const out = emptyStreetPrice();
  let learned = false;
  for (const s of STREET_KEYS) {
    const b = cellOf(base, s);
    const d = cellOf(inc, s);
    if (d.opp > 0) {
      learned = true;
      b.sum = b.sum * STREET_READ_DECAY + d.sum;
      b.opp = b.opp * STREET_READ_DECAY + d.opp;
    }
    out.foldToRaise[s] = b;
  }
  return learned ? out : (base ?? null);
}

/** One record on the read-frame wire: [sum, opp] of the flop, the turn and the river. */
export const STREET_PRICE_ROW_LENGTH = 6;
export function streetPriceRow(r: StreetPriceCounters): number[] {
  return STREET_KEYS.flatMap((s) => [r.foldToRaise[s].sum, r.foldToRaise[s].opp]);
}
/** The record a wire list carries, or null when the list is not a valid record. */
export function streetPriceFromRow(row: readonly number[]): StreetPriceCounters | null {
  if (!Array.isArray(row) || row.length !== STREET_PRICE_ROW_LENGTH) return null;
  const out = emptyStreetPrice();
  STREET_KEYS.forEach((s, i) => {
    out.foldToRaise[s].sum = row[2 * i];
    out.foldToRaise[s].opp = row[2 * i + 1];
  });
  return validStreetPrice(out) ? out : null;
}

/** The mean price of the priced raises behind one street's fold-to-raise cell and how many (aged) there were. */
export interface StreetPriceMean {
  price: number;
  opportunities: number;
}
/** sum / opp for one street, or null when the record is absent or not valid or the street holds no priced raise.
 *  Applies no threshold: `opportunities` is the sample. */
export function foldToRaisePrice(
  r: StreetPriceCounters | null | undefined,
  street: PostflopStreet
): StreetPriceMean | null {
  if (!r || !validStreetPrice(r)) return null;
  const c = r.foldToRaise[street];
  if (!(c.opp > 0) || !(c.sum > 0)) return null;
  return { price: Math.min(1, c.sum / c.opp), opportunities: c.opp };
}
