/**
 * THE PEOPLE-MEASURED MULTIWAY FIELD (omahaMultiwayFieldIsPeopleMeasured; PLO-OWNER lead-7 2026-11-27,
 * plo-lead7-01TLQer8/plo4-audit/FINDINGS.md). Pure arithmetic: no telemetry, no opponent memory, no random draw.
 *
 * WHY. omahaFacingBetEv prices a turn or river call with other players in the hand by making the Horse beat each of
 * them too. A player who already called the bet is modelled as holding the strongest OMAHA_EV_CALLER_SHARE of
 * holdings (turn 0.45, river 0.35); a player still to act continues OMAHA_EV_BEHIND_SHARE (0.25) of the time with
 * the strongest 0.25. Both constants are stated, not measured on people. PEOPLE's own shown calls of a turn or river
 * bet lie, on average, where a uniform top region of 0.753 (turn, n 1,473) / 0.58 (river, n 752) of holdings would
 * lie (HorseOmahaFacingBetPeoplePrior.data.ts `caller`: cards a person showed at showdown, mucked = false), and
 * people still to act multiway continue 0.57 / 0.47 / 0.38 of the time on the turn by size (`fold`, mw). A field
 * priced as far stronger than the people in it folds hands that win: PLO4 cash, 7 days to Nov 26, the Horses fold
 * 79% of multiway turn bets (n 138) where people fold 52% (z 3.7), every fold the facing-bet verdict's.
 *
 * WHAT IT CHANGES. Only the field factor of that verdict, multiway (a caller or a player still to act), PLO4/PLO5
 * cash, turn and river:
 *   - a caller holds the strongest W of holdings, W = the people caller width of the street, blended with the
 *     equilibrium anchor 1 / (1 + s) (the share of his range a defender keeps against a bet of s pot) at
 *     OMAHA_MW_PEOPLE_FIELD_ANCHOR_N pseudo-calls; a bet under a quarter of the pot keeps the verdict's own
 *     interpolation toward 1;
 *   - a player still to act continues at C, the people multiway continue rate for the street and size, blended with
 *     the equilibrium share 1 - (s / (1 + s))^(1 / k) (k = the players left to answer, the Horse included: together
 *     they let a pure bluff break even) at the same weight; when he continues he holds the strongest W.
 * The bettor's range, the all-in share, the realization and the margin are untouched. The same arithmetic for
 * every opponent: no input reads whether a player is a person or a Horse, a name or an account; no unshown card.
 * The opponent memory keeps no showdown record of a player's calls by size (OMAHA_EV_CALLER_SHARE's own note), so
 * no per-player record moves W or C.
 */
import { OMAHA_FACING_BET_PEOPLE_PRIOR_DATA } from './HorseOmahaFacingBetPeoplePrior.data.js';
import { omahaBetSizeBucket } from './HorseOmahaFacingBetEv.js';

/** Pseudo-observations of the equilibrium anchor behind each people cell (OMAHA_PEOPLE_PRIOR_ANCHOR_BETS). */
export const OMAHA_MW_PEOPLE_FIELD_ANCHOR_N = 30;
export const OMAHA_MW_PEOPLE_FIELD_MIN = 0.05;
export const OMAHA_MW_PEOPLE_FIELD_MAX = 0.95;

export interface OmahaPeopleFieldInput {
  street: 'turn' | 'river';
  /** the bet as a share of the pot before it */
  potFrac: number;
  /** players still to act behind the Horse */
  behind: number;
}
export interface OmahaPeopleField {
  /** the share of holdings a caller (or a continuing player behind) holds: the strongest W */
  callerWidth: number;
  /** the rate a player still to act continues */
  behindContinue: number;
  /** the people cells read, for the record */
  peopleCallerN: number;
  peopleFoldN: number;
}

const clamp = (x: number): number =>
  Math.max(OMAHA_MW_PEOPLE_FIELD_MIN, Math.min(OMAHA_MW_PEOPLE_FIELD_MAX, x));

type Cell = { n: number; share: number | null };

/** The people multiway fold cell for this bet; 'over' falls back to 'big' when unmeasured. */
function foldCell(street: 'turn' | 'river', potFrac: number): Cell {
  const t = OMAHA_FACING_BET_PEOPLE_PRIOR_DATA.fold[street].mw as Record<string, Cell>;
  const b = omahaBetSizeBucket(potFrac);
  const c = t[b];
  if (c && c.n > 0 && c.share !== null) return c;
  const big = t.big;
  return big && big.n > 0 && big.share !== null ? big : { n: 0, share: null };
}

/** The people-measured field for a multiway turn or river bet: null when the spot cannot be read. */
export function omahaPeopleMultiwayField(input: OmahaPeopleFieldInput): OmahaPeopleField | null {
  if (input.street !== 'turn' && input.street !== 'river') return null;
  const s = input.potFrac;
  if (!Number.isFinite(s) || s <= 0) return null;
  const K = OMAHA_MW_PEOPLE_FIELD_ANCHOR_N;
  const caller = OMAHA_FACING_BET_PEOPLE_PRIOR_DATA.caller[input.street] as Cell;
  const anchorWidth = 1 / (1 + s);
  const cn = caller && caller.n > 0 && caller.share !== null ? caller.n : 0;
  const callerWidth = clamp(
    cn > 0 ? (cn * (caller.share as number) + K * anchorWidth) / (cn + K) : anchorWidth
  );
  const behind = Number.isFinite(input.behind) ? Math.max(0, Math.floor(input.behind)) : 0;
  const k = behind + 1;
  const anchorFold = (s / (1 + s)) ** (1 / k);
  const f = foldCell(input.street, s);
  const fn = f.n;
  const fold = fn > 0 ? (fn * (f.share as number) + K * anchorFold) / (fn + K) : anchorFold;
  return {
    callerWidth,
    behindContinue: clamp(1 - fold),
    peopleCallerN: cn,
    peopleFoldN: fn,
  };
}
