/**
 * THE EQUILIBRIUM-ANCHORED BETTOR PRIOR (omahaFacingBetPriorIsEquilibriumAnchored; PLO-OWNER lead-7 2026-11-26;
 * audit-rootcause/REPORT.md section B and woowoo/REPORT.md gap 1). Pure arithmetic: no telemetry, no opponent
 * memory of its own (the caller passes the bettor's record), no random draw.
 *
 * WHY. omahaFacingBetEv prices a bettor as a value region plus a non-value share q. Its prior for q
 * (OMAHA_EV_PRIOR_BLUFF) was measured on a field, and the field under-bluffs big bets (turn 0.22, river 0.19 at
 * 0.7 pot and over, 0.15 / 0.08 for a raise). A defence fitted to bettors who do not bluff is exactly what a
 * bettor who does bluff takes money from.
 *
 * THE ANCHOR. With no record of this bettor, q is the BALANCED share for the price. On the river, and on a turn call
 * after which no river bet can follow, it is the share at which a hand that beats every one of his non-value hands
 * and none of his value hands breaks even on the call:
 *   b = paid / (winnable x (1 - rake) + paid)          (bet / (pot + 2 bet) before rake).
 * On a turn bet with a river bet still to come it is the two-street balanced share 1 - (1 - b)^2: a bettor balanced
 * on both streets holds value on the turn only (1 - b) of (1 - b) of the time (the turn bet and a river bet of the
 * same price). No constant is fitted: the price is the only input. (Measured check, not a fit: on the 790 audited
 * PLO4 turn decisions this share makes the Horses' own range fold 33.8% / 48.1% to bets of 0.4 to 0.7 pot / 0.7
 * pot and over, where a pure bluff breaks even at 34.9% / 47.8%; plo-defence/BUILD.md.)
 * On the river a hand with no share against his value region therefore never has a positive call: only a share
 * against value (a made hand inside or at the edge of his value region, a holding whose own cards remove his
 * strongest hands: the count is exact on the cards left) turns the call positive. On the turn the same count over
 * every river card puts draws to the nuts and hands that hold up against value first.
 *
 * HIS OWN RECORD. Only his own shown bets of this street, size and line move it (HorseOmahaBetRead's per-opponent
 * cell: shown, and how many were value): q = (N0 x q0 + (shown - value)) / (N0 + shown), N0 =
 * OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS. A bettor shown value every time is priced value-heavy as his sample grows;
 * one shown weak is priced weaker. No field rate, no public label and no other player's habit enters.
 * Identity never enters: the same arithmetic for every bettor.
 */
/** Pseudo-observations of the balanced share behind his own shown bets (OMAHA_EV_SIZE_READ_PRIOR). */
export const OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS = 8;
/** The share is kept inside these bounds whatever moves it (omahaEvBluffShare's own). */
export const OMAHA_EQUILIBRIUM_ANCHOR_MIN = 0.02;
export const OMAHA_EQUILIBRIUM_ANCHOR_MAX = 0.65;

export interface OmahaEquilibriumAnchorInput {
  /** chips the call puts in, and the chips it can win */
  paid: number;
  winnable: number;
  /** the deduction on the pot, as a fraction */
  rake: number;
  /** a turn bet with a river bet still to come (the call is not final and he keeps a stack to bet the river) */
  twoStreet: boolean;
  /** his own shown bets of this street, size and line, or null */
  record: { shown: number; value: number } | null;
}
export interface OmahaEquilibriumAnchorShare {
  /** the non-value share priced */
  share: number;
  /** the balanced share for this price, before his record */
  anchor: number;
  /** his shown bets read (0 with no record) */
  shown: number;
}

/** The balanced non-value share for this price: null when the price cannot be read. */
export function omahaEquilibriumAnchor(
  paid: number,
  winnable: number,
  rake: number,
  twoStreet: boolean
): number | null {
  if (!Number.isFinite(paid) || !Number.isFinite(winnable) || !(paid > 0) || !(winnable > 0))
    return null;
  const r = Number.isFinite(rake) ? Math.max(0, Math.min(0.2, rake)) : 0;
  const b = paid / (winnable * (1 - r) + paid);
  const q0 = twoStreet === true ? 1 - (1 - b) * (1 - b) : b;
  return Math.max(OMAHA_EQUILIBRIUM_ANCHOR_MIN, Math.min(OMAHA_EQUILIBRIUM_ANCHOR_MAX, q0));
}

/** The share priced against this bettor: the anchor, moved only by his own shown bets. */
export function omahaEquilibriumAnchoredShare(
  input: OmahaEquilibriumAnchorInput
): OmahaEquilibriumAnchorShare | null {
  const anchor = omahaEquilibriumAnchor(input.paid, input.winnable, input.rake, input.twoStreet);
  if (anchor === null) return null;
  const rec = input.record;
  const shown = rec && Number.isFinite(rec.shown) && rec.shown > 0 ? rec.shown : 0;
  if (!(shown > 0)) return { share: anchor, anchor, shown: 0 };
  const value = Math.max(0, Math.min(shown, Number.isFinite(rec!.value) ? rec!.value : 0));
  const q =
    (OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS * anchor + (shown - value)) /
    (OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS + shown);
  return {
    share: Math.max(OMAHA_EQUILIBRIUM_ANCHOR_MIN, Math.min(OMAHA_EQUILIBRIUM_ANCHOR_MAX, q)),
    anchor,
    shown,
  };
}
