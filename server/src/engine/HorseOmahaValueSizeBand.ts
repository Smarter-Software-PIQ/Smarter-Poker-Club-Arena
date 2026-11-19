/**
 * omahaValueSizeIsUnreadable (WooWoo audit NUT-SIZE lane, 2026-11-19; default
 * OFF, read `=== true`). Owner 2026-11-18 23:00 Chicago: "HORSES NEED TO VARY
 * THERE BETS WITH THE NUTS, NOT FULL PUT EVERY TIME, BUT LIKE 80-95% POT, HE'S
 * FOLDING TO FULL POT SIZE BETS CAUSE HE SAID WHEN THEY DO THAT, THEY 100%
 * ALWAYS HAVE THE NUTS!"
 *
 * THE MEASUREMENT (A/repairs/NUT-SIZE/MEASUREMENT.md; PLO4/PLO5 cash, one
 * board, no bomb pot, a person seated, 2026-11-05..2026-11-19, 9,664 hands,
 * 11,741 Horse bets and raises after the flop). A Horse wager of 95% of the
 * pot-limit maximum or more (the full pot) was the exact nuts 55.0% of the
 * time (n 1,280) against 11.9% at 80-95% (n 2,091); on the river 57.5%
 * against 2.2%. 82% of the Horses' river nut wagers were the full pot. The
 * full pot is a size that tells.
 *
 * THE CELL. Only a PLO4/PLO5 postflop bet or raise that is already the full
 * pot (95% of the pot-limit increment or more), made with a nut-class hand
 * (the caller's test: omahaNutClassNow, or the exact river nuts), and only
 * when the pot-limit maximum is not the seat's whole stack. Such a wager
 * stays the full pot with the street's share OMAHA_VALUE_SIZE_FULL_POT_KEEP
 * and otherwise is sized to a uniform share of the pot increment in the
 * owner's band [0.80, 0.95]. Every other wager - every non-nut wager at the
 * full pot included - is left exactly as it is, so the full pot keeps the
 * hands that are not the nuts and is no longer nut-only.
 *
 * THE KEEP SHARE is the measured one, not a builder's guess: for each street
 * the share p of today's nut full-pot wagers left at the full pot such that
 * the nut share of the full pot equals the nut share of the band once the
 * rest move into the band (nuts at full N, others at full X, nuts in the
 * band Nb, others in the band Y; solve pN/(pN+X) = (Nb+(1-p)N)/(Nb+(1-p)N+Y)):
 * flop N 104, X 51, Nb 89, Y 956 -> 0.094 (nut share 16.1% both);
 * turn N 240, X 259, Nb 153, Y 574 -> 0.509 (32.0% / 32.1%);
 * river N 360, X 266, Nb 7, Y 312 -> 0.469 (38.8% both).
 *
 * THE DRAWS. Two uniform numbers from a stream of the cell's own, derived
 * from the decision's seeded strategy stream without advancing it
 * (HorseOmahaStrongHandSlowplayMix.omahaSlowplayUnit with this cell's own
 * salts): no other rule's draw moves; under a pinned seed the size replays.
 *
 * LEGAL BOUNDS. The size never goes above the pot-limit maximum or below the
 * legal minimum (a band that the minimum lies above leaves the wager as it
 * is), it is always smaller than the wager it replaces, and when the target
 * reaches the seat's whole stack the wager is left as it is (the all-in the
 * stack makes stays). The sized wager carries `valueSize: 'unreadable_band'`
 * so the table's commit guards (riverNutsRaise, fullPotNearPotWager) keep a
 * size that is still legal and still in the band on the fresh state
 * (omahaValueSizeBandHolds) instead of rounding it back up to the pot.
 *
 * One owner. This cell runs last in the wager_rules node, after
 * omahaNutClassValueSize (which makes the nut wager the full pot), after
 * riverNutsRaise / omahaCurrentNutsRaise / fullPotNearPotWager (which do the
 * same for the river nuts, the current nuts and any 90-100% wager) and after
 * omahaBetSizeByPublicState (which keeps a nut-class wager's size when
 * omahaNutClassValueSize is on). omahaSmallBetIsPriced never makes a nut-class
 * bet smaller and runs earlier in the node, so it does not see this size.
 * Those rules choose bet or check and the full pot; this cell only chooses
 * how much of the full pot. It never turns a check, a call, a fold or an
 * all-in into anything, and never makes a wager larger.
 *
 * Pure: no state, no telemetry, no opponent memory, no random draw of its
 * own. Tournaments, PLO6, hi-lo, more than one board and bomb pots are the
 * caller's scope test and are never reached.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { variantInfo } from './HorseEval.js';

/** The owner's band, 2026-11-18 23:00 Chicago ("LIKE 80-95% POT"), as shares of the pot-limit increment. */
export const OMAHA_VALUE_SIZE_BAND_LOW = 0.8;
export const OMAHA_VALUE_SIZE_BAND_HIGH = 0.95;
/** A wager of this share of the pot-limit increment or more is "the full pot" (the measurement's top bucket). */
export const OMAHA_VALUE_SIZE_FULL_POT_FROM = 0.95;
/** Measured keep shares by street (header; A/repairs/NUT-SIZE/MEASUREMENT.md, a2.out). */
export const OMAHA_VALUE_SIZE_FULL_POT_KEEP: Readonly<Record<'flop' | 'turn' | 'river', number>> =
  Object.freeze({ flop: 0.094, turn: 0.509, river: 0.469 });
export const OMAHA_VALUE_SIZE_KEEP_SALT = 0x7a1e5e1;
export const OMAHA_VALUE_SIZE_BAND_SALT = 0x7a1e5b2;

export type OmahaValueSizeChange = 'band' | 'full_pot_kept' | null;
export interface OmahaValueSizeResult {
  decision: HorseDecision;
  changed: OmahaValueSizeChange;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const BOARD_LEN: Readonly<Record<string, number>> = Object.freeze({ flop: 3, turn: 4, river: 5 });

/** Base (the street total the increment is added to) and the pot-limit increment of the wager. */
function wagerFrame(
  action: 'bet' | 'raise',
  gs: HorseGameStateV2
): { base: number; potIncrement: number } | null {
  if (!fin(gs.pot) || gs.pot <= 0 || !fin(gs.currentBet) || !fin(gs.toCall) || gs.toCall < 0)
    return null;
  const base = action === 'bet' ? 0 : gs.currentBet;
  const potIncrement = gs.pot + (action === 'raise' ? gs.toCall : 0);
  return potIncrement > 0 ? { base, potIncrement } : null;
}

/** Pot limit, one board, postflop, uncapped, the wager on the menu with finite bounds. */
function inShape(decision: HorseDecision, hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  if (decision.action !== 'bet' && decision.action !== 'raise') return false;
  const want = BOARD_LEN[gs.stage as string];
  if (want === undefined || (gs.communityCards ?? []).length !== want) return false;
  const vi = variantInfo(String(gs.gameVariant ?? 'nlh').toLowerCase());
  const structure =
    gs.bettingStructure ??
    (vi.isFixedLimit ? 'fixed_limit' : vi.isPotLimit ? 'pot_limit' : 'no_limit');
  return (
    structure === 'pot_limit' &&
    gs.stateSchemaVersion === 1 &&
    gs.wagersCapped !== true &&
    Array.isArray(gs.legalActions) &&
    gs.legalActions.includes(decision.action) &&
    fin(decision.amount) &&
    fin(gs.minRaiseTo) &&
    fin(gs.maxRaiseTo) &&
    gs.maxRaiseTo >= gs.minRaiseTo &&
    fin(hero.stack) &&
    fin(hero.bet) &&
    fin(gs.toCall) &&
    (decision.action === 'raise' ? gs.toCall > 0.005 : gs.toCall <= 0.005)
  );
}

/**
 * The cell. `nutClass` is the caller's nut-class test (asked only for a full-pot
 * wager); `keepUnit` and `bandUnit` are the two derived-stream draws in [0, 1).
 */
export function omahaValueSizeBand(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  draws: { keepUnit: number; bandUnit: number },
  nutClass: () => boolean
): OmahaValueSizeResult {
  const same: OmahaValueSizeResult = { decision, changed: null };
  try {
    if (!inShape(decision, hero, gs)) return same;
    const action = decision.action as 'bet' | 'raise';
    const frame = wagerFrame(action, gs);
    if (frame === null) return same;
    const amount = decision.amount as number;
    const increment = amount - frame.base;
    if (increment < frame.potIncrement * OMAHA_VALUE_SIZE_FULL_POT_FROM - 1e-6) return same;
    const total = round2(hero.bet + hero.stack);
    // The full pot is the whole stack (or more): the all-in the stack makes stays.
    if ((gs.maxRaiseTo as number) >= total - 0.005) return same;
    if (!nutClass()) return same;
    const keep = OMAHA_VALUE_SIZE_FULL_POT_KEEP[gs.stage as 'flop' | 'turn' | 'river'];
    if (!(draws.keepUnit >= keep)) return { decision, changed: 'full_pot_kept' };
    const unit = Math.min(Math.max(draws.bandUnit, 0), 1);
    const share =
      OMAHA_VALUE_SIZE_BAND_LOW + unit * (OMAHA_VALUE_SIZE_BAND_HIGH - OMAHA_VALUE_SIZE_BAND_LOW);
    let target = round2(frame.base + share * frame.potIncrement);
    const min = gs.minRaiseTo as number;
    const max = gs.maxRaiseTo as number;
    if (target < min) {
      // The legal minimum lies above the band: nothing in the band is legal.
      if (min - frame.base > frame.potIncrement * OMAHA_VALUE_SIZE_BAND_HIGH + 1e-6) return same;
      target = round2(min);
    }
    const lowEdge = round2(frame.base + frame.potIncrement * OMAHA_VALUE_SIZE_BAND_LOW);
    const highEdge = round2(frame.base + frame.potIncrement * OMAHA_VALUE_SIZE_BAND_HIGH);
    if (target < lowEdge) target = lowEdge;
    if (target > highEdge) target = highEdge;
    if (target < min - 1e-6 || target > max + 1e-6) return same;
    if (target >= total - 0.005) return same;
    if (!(target < amount - 0.005)) return same;
    return {
      decision: { ...decision, amount: target, valueSize: 'unreadable_band' },
      changed: 'band',
    };
  } catch {
    return same;
  }
}

/**
 * Commit guard: a wager this cell sized is kept by the table's final nut and
 * near-pot roundings only while it is still a legal bet or raise of the fresh
 * menu and still inside the band; otherwise those guards decide as before.
 */
export function omahaValueSizeBandHolds(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2
): boolean {
  try {
    if (decision.valueSize !== 'unreadable_band' || !inShape(decision, hero, gs)) return false;
    const frame = wagerFrame(decision.action as 'bet' | 'raise', gs);
    if (frame === null) return false;
    const amount = decision.amount as number;
    if (amount < (gs.minRaiseTo as number) - 1e-6 || amount > (gs.maxRaiseTo as number) + 1e-6)
      return false;
    if (amount >= hero.bet + hero.stack - 0.005) return false;
    // Half a cent either side of the band edges: amounts are cents.
    const tol = 0.006 / frame.potIncrement;
    const share = (amount - frame.base) / frame.potIncrement;
    return share >= OMAHA_VALUE_SIZE_BAND_LOW - tol && share <= OMAHA_VALUE_SIZE_BAND_HIGH + tol;
  } catch {
    return false;
  }
}
