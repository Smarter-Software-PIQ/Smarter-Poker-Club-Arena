import { cutFixed } from '../utils/format';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BETTING STRUCTURE (client mirror)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Client-side twin of server/src/engine/BettingStructure.ts, kept the same way
 * src/config/RakeConfig.ts mirrors the server copy. The SERVER is authoritative
 * for every wager; this exists so the UI draws the right controls — a slider for
 * no-limit and pot-limit, a single fixed-size button for limit — instead of
 * offering a range the server will then reject.
 *
 * This is a PARTIAL mirror on purpose: it carries only what the browser calls.
 * The first version also exported FIXED_LIMIT_MAX_WAGERS, isPotLimitVariant and
 * a structureBadge() helper for symmetry with the server module, and nothing
 * imported any of them — three dead exports shipped in the name of parity. The
 * cap count and the pot-limit test are enforced server-side, where the rule
 * actually lives; a client copy of a rule the client never asks is not parity,
 * it is a second place for the rule to go stale. Add a function here when a
 * component needs it, not before.
 *
 * Any change here must be made in the server module too.
 *
 * ── STAKES CONVENTION ────────────────────────────────────────────────────────
 * Every game, fixed limit included, is posted by its BLINDS (owner ruling,
 * November 14, 2026: "GAME LIMITS SHOULD BE .25/.50 .50/1.00 1/2 2/5 AND 5/10"
 * and "DISPLAYED AS 'FIXED LIMIT 1/2'"). A limit table storing small_blind 1 /
 * big_blind 2 reads "1/2"; its small bet is 2 (preflop and flop) and its big
 * bet 4 (turn and river), as fixedLimitBetSize says. Until that ruling a limit
 * game read by its bet sizes ("FLH 2/4" for blinds 1/2), so the 5/10-blind game
 * read 10/20 and looked above the 5/10 ceiling it actually sits on.
 * `stakesLabel()` is still the single place that decides how a table's stakes
 * read, so lobby rows, table headers and the create-table flow cannot disagree.
 */

export type BettingStructure = 'no_limit' | 'pot_limit' | 'fixed_limit';

const POT_LIMIT_VARIANTS = new Set(['plo4', 'plo5', 'plo6', 'plo8']);
const FIXED_LIMIT_VARIANTS = new Set(['flh', 'flo4', 'flo5', 'flo6', 'flo8']);

export function bettingStructureFor(variant?: string | null): BettingStructure {
  const v = (variant || '').toLowerCase();
  if (FIXED_LIMIT_VARIANTS.has(v)) return 'fixed_limit';
  if (POT_LIMIT_VARIANTS.has(v) || v.startsWith('plo')) return 'pot_limit';
  return 'no_limit';
}

export function isFixedLimitVariant(variant?: string | null): boolean {
  return bettingStructureFor(variant) === 'fixed_limit';
}

/**
 * The one legal wager for a fixed-limit street: the big blind (small bet) on
 * preflop and flop, twice it (big bet) on turn and river.
 */
export function fixedLimitBetSize(bigBlind: number, street?: string | null): number {
  const s = (street || 'preflop').toLowerCase();
  if (s === 'turn' || s === 'river' || s === 'showdown') return bigBlind * 2;
  return bigBlind;
}

/**
 * The number a stakes sort orders a cash game by: the LARGER figure its
 * stakesLabel prints, which is the big blind for every game since the owner
 * ruling of November 14, 2026 posted fixed limit by its blinds too. Dan
 * 2026-10-23 ("DISPLAY ALL THE 1/2 GAMES FIRST ... AND THEN DO THE .50/1.00
 * GAME SAME WAY") still holds: a "1/2" limit game sorts with every other "1/2".
 * `variant` is kept so callers need not change.
 */
export function stakesSortValue(bigBlind: number, _variant?: string | null): number {
  return Number(bigBlind) || 0;
}

/** How a table's stakes read to a player: its blinds, for every game. */
export function stakesLabel(
  smallBlind: number,
  bigBlind: number,
  _variant?: string | null
): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : cutFixed(n, 2));
  return `${fmt(smallBlind)}/${fmt(bigBlind)}`;
}
