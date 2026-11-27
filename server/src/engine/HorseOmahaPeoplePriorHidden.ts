/**
 * HIDDEN BETS IN THE PEOPLE PRIOR (omahaPeoplePriorCountsHiddenBets; lead-8 lane OFA 2026-11-27). Pure lookup: no
 * telemetry, no memory, no draw.
 *
 * WHY. The people-only flop and turn cells (HorseOmahaFacingBetPeoplePrior.data.ts) are measured on bets whose cards
 * were SHOWN at showdown. Of a person's called flop / turn bets only 37-57% are shown: the rest he folded later in the
 * hand, mucked at the showdown, or won with no showdown (Oct 27 - Nov 27, l8-ofa/out/hidden.md). The folded and mucked
 * ones are the weak end and never enter the shown sample, so the cells over-state value and the Horse folds too much
 * (a first-encounter barreller folds the serving engine 61% on the turn vs a 45% break-even, OFE lane). Every called
 * river bettor is shown (461 of 461), so the river is unchanged.
 *
 * WHAT. The same fit, split per game and per cell where the composition differs (the flop by pot type: limped /
 * single-raised / re-raised, 3-bet pots being value-heavy; the turn by line: the flop checked through / he made the
 * flop wager / another player did), counts each hidden bet as non-value in both units (the price's value region and
 * the record's top-20% unit). A bet won with no showdown keeps the shown mix. Re-raised flop pots keep the shown-only
 * share (hidden bets reported, not counted; the reason is in the fit and l8-ofa/BUILD.md), and the bettor's record
 * stays shown-only there too (omahaPeoplePriorRecordCountsHidden). A thin split cell is NEVER replaced by
 * the pooled cell (the pooled flop sample is mostly re-raised pots, value-heavy): the caller blends the split cell's
 * own counts toward the equilibrium anchor by its n (omahaPeoplePriorBlend, 30 pseudo-bets); a split with no bets at
 * all is the anchor alone. No clamp on the output: a cell is a fit, not a rule.
 * Public events only (a fold and a muck are public; no card is read). People-only bettors; no identity input.
 */
import { OMAHA_PEOPLE_PRIOR_HIDDEN_DATA } from './HorseOmahaPeoplePriorHidden.data.js';

export type OmahaPeoplePriorFlopPot = 'limped' | 'single' | 'reraised';
export type OmahaPeoplePriorTurnLine = 'x' | 'b' | 'c';
/** The flag the people-prior cell readers take: the game and the split of this decision. */
export interface OmahaPeoplePriorHiddenKey {
  game: 'plo4' | 'plo5';
  /** flop: the pot type; turn: the line */
  split: OmahaPeoplePriorFlopPot | OmahaPeoplePriorTurnLine;
}

/** The hidden-corrected split cell (n = shown + hidden; n 0 and share null when the split has no bets), or null when
 *  no key is given or the street is not the flop or the turn (then the caller's pooled cell stands). */
export function omahaPeoplePriorHiddenCell(
  street: string,
  multiway: boolean,
  bucket: string,
  key: OmahaPeoplePriorHiddenKey | null | undefined
): { n: number; share: number | null; nonTop20: number | null } | null {
  if (!key || (street !== 'flop' && street !== 'turn')) return null;
  const b = bucket === 'over' ? 'big' : bucket;
  const c =
    OMAHA_PEOPLE_PRIOR_HIDDEN_DATA[
      `${street}|${key.game}|${multiway ? 'mw' : 'hu'}|${b}|${key.split}`
    ];
  const n = c ? c.shown + (c.hiddenCounted ? c.hidden : 0) : 0;
  if (!c || !(n > 0) || c.share === null || !Number.isFinite(c.share))
    return { n: 0, share: null, nonTop20: null };
  const nt = c.nonTop20 !== null && c.nonTop20 > 0 && c.nonTop20 < 1 ? c.nonTop20 : null;
  return { n, share: c.share, nonTop20: nt };
}

type Hist =
  | ReadonlyArray<{ stage?: unknown; seat?: number; action?: string; amount?: number }>
  | null
  | undefined;
const wager = (a: { action?: string; amount?: number }): boolean =>
  (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') && Number(a.amount) > 0;

/** The flop pot type from the public preflop actions, counted as the fit counts it: every bet / raise / all-in that
 *  lifts the level (the blinds only set it): 0 limped, 1 single-raised, 2 or more re-raised. */
export function omahaPeoplePriorFlopPotOf(history: Hist): OmahaPeoplePriorFlopPot {
  let level = 0;
  let raises = 0;
  const totals = new Map<number, number>();
  for (const a of history ?? []) {
    if (String(a?.stage) !== 'preflop' || a.seat === undefined || a.action === 'fold') continue;
    const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount as number) : 0;
    const before = totals.get(a.seat) ?? 0;
    if (a.action === 'call') totals.set(a.seat, before + amt);
    else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
      const now = Math.max(before, amt);
      totals.set(a.seat, now);
      if (now > level + 0.005) {
        raises++;
        level = now;
      }
    } else if (amt > level) level = amt; // blinds set the level
  }
  return raises === 0 ? 'limped' : raises === 1 ? 'single' : 'reraised';
}

/** The turn line of the bettor: he made a flop wager (b), another player did (c), or the flop checked through (x). */
export function omahaPeoplePriorTurnLineOf(
  history: Hist,
  bettorSeat: number
): OmahaPeoplePriorTurnLine {
  let other = false;
  for (const a of history ?? []) {
    if (String(a?.stage) !== 'flop' || !wager(a)) continue;
    if (a.seat === bettorSeat) return 'b';
    other = true;
  }
  return other ? 'c' : 'x';
}

/** Whether the bettor's own record counts his hidden bets for this key: exactly where the people cell does (a
 *  re-raised flop pot keeps the shown-only cell, so his record stays shown-only there too: the same unit). */
export function omahaPeoplePriorRecordCountsHidden(
  key: OmahaPeoplePriorHiddenKey | null | undefined
): boolean {
  return !!key && key.split !== 'reraised';
}

/** The key for this decision, or null outside PLO4 / PLO5. */
export function omahaPeoplePriorHiddenKeyOf(
  variant: string,
  street: string,
  history: Hist,
  bettorSeat: number
): OmahaPeoplePriorHiddenKey | null {
  const game = String(variant ?? '').toLowerCase();
  if (game !== 'plo4' && game !== 'plo5') return null;
  if (street === 'flop') return { game, split: omahaPeoplePriorFlopPotOf(history) };
  if (street === 'turn') return { game, split: omahaPeoplePriorTurnLineOf(history, bettorSeat) };
  return null;
}
