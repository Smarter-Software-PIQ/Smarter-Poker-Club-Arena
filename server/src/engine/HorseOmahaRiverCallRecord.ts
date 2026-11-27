/**
 * HIS CALLS ARE READ THROUGH HIS OWN FOLD RECORD (PLO-OWNER lead-7 lane river-call, 2026-11-26; option
 * omahaRiverCallRangeIsHisRecord, default OFF, read `=== true`; scopable per game with horse.omahaGameScope).
 *
 * WHY (the gap omahaRiverBetCheckIsHisRecord left). The card-impact range model of the two river bet rules
 * (HorseOmahaCardImpact.ts; omahaRiverFirstToActBetIsPriced, omahaRiverCheckedToBetIsMeasured) narrows an opponent's
 * range at every CALL of his on the flop and turn to the top pot-odds share of it (keep = pot / (pot + bet)): the
 * population's continuing range. A player who folds far less than people continues with much weaker hands, so after
 * his calls his range is wider and weaker than the model holds, and a medium-strength river bet for value is worth
 * more against him than the rules price: thin value against a calling station is missed.
 *
 * WHAT IT DOES. Nothing by itself. With the option on, every call step of his line keeps
 *     keep' = clamp(1 - m x (1 - keep), 0.05, 0.97)
 * of his range instead of keep, with m his own fold share over people's:
 *     E = sum over his cells of opps x people's fold in that cell (game, street, size),  q = E / O,
 *     his = (folds + k x q) / (O + k),   m = his / q,
 * his record being his lifetime PUBLIC heads-up first answers to a turn or river FIRST wager (OPPONENT-HUD's
 * x.foldToBet.small / .big cells through HorseMind.omahaStrongHandCheckRecordsOf; the two streets and the two sizes
 * pooled against people's rate for his own mix). The model has one continuing range per call, so his one measured
 * multiplier replaces the population's at every call of his (flop calls included). A player who never folds keeps
 * almost all of his range after a call (his calls cap nothing); one who folds more than people keeps less; with no
 * record the read is returned unchanged (the same object), so the model decides exactly as before. The answer curve
 * to the Horse's own river bet is untouched (that is omahaRiverBetFoldIsHisRecord).
 *
 * PRIOR ANCHOR (owner order 2026-11-26: population figures from PEOPLE only): people's fold in each cell and k are
 * the generated table HorseOmahaRiverCallRecordPeople.data.ts (server/scripts/omaha-river-call-record-people-fit.ts:
 * responders who are people only, public actions only, the HUD '*' rows not read; Nov 19 18:00Z to Nov 26 17:48Z
 * 2026). The ratio form keeps the model's own pot-odds keep (the equilibrium defence share) as the anchor for a
 * player who folds like people; his record dominates as it grows (weight O / (O + k)).
 *
 * No hand class, position, size band or fixed percentage; nothing keyed to an account, a person or a Horse; public
 * actions only. Pure.
 */
import {
  OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU,
  OMAHA_PEOPLE_FIRST_WAGER_FOLD_PRIOR_OPPS,
} from './HorseOmahaRiverCallRecordPeople.data.js';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export interface OmahaFirstWagerFoldCell {
  folds: number;
  opps: number;
}
/** One street of his record: OPPONENT-HUD's two size cells. */
export interface OmahaFirstWagerFoldRecord {
  foldSmall?: OmahaFirstWagerFoldCell | null;
  foldBig?: OmahaFirstWagerFoldCell | null;
}

/** His shrunk fold share over people's for his own mix; m 1, weight 0 with no usable record or outside PLO4/PLO5. */
export function omahaFirstWagerFoldRatio(
  variant: string,
  records: Readonly<Partial<Record<'turn' | 'river', OmahaFirstWagerFoldRecord | null | undefined>>>
): { m: number; weight: number } {
  const none = { m: 1, weight: 0 };
  try {
    const game = String(variant ?? '').toLowerCase();
    if (game !== 'plo4' && game !== 'plo5') return none;
    const people = OMAHA_PEOPLE_FIRST_WAGER_FOLD_HU[game];
    let folds = 0;
    let opps = 0;
    let expected = 0;
    for (const street of ['turn', 'river'] as const) {
      const r = records?.[street];
      if (!r) continue;
      for (const size of ['small', 'big'] as const) {
        const c = size === 'small' ? r.foldSmall : r.foldBig;
        if (!c || !fin(c.folds) || !fin(c.opps) || !(c.opps > 0) || c.folds < 0) continue;
        const p = people[street][size];
        folds += Math.min(c.folds, c.opps);
        opps += c.opps;
        expected += c.opps * (p.folds / p.opps);
      }
    }
    if (!(opps > 0) || !(expected > 0)) return none;
    const q = expected / opps;
    const k = OMAHA_PEOPLE_FIRST_WAGER_FOLD_PRIOR_OPPS;
    const m = (folds + k * q) / (opps + k) / q;
    if (!fin(m) || !(m >= 0)) return none;
    return { m, weight: opps / (opps + k) };
  } catch {
    return none;
  }
}

/** The read with his own call-step fold multiplier (callFoldRatio); the SAME object with no usable record. */
export function omahaRiverCallRead<R extends { callFoldRatio?: number }>(
  variant: string,
  read: R,
  records: Readonly<Partial<Record<'turn' | 'river', OmahaFirstWagerFoldRecord | null | undefined>>>
): R {
  const f = omahaFirstWagerFoldRatio(variant, records);
  if (!(f.weight > 0)) return read;
  return { ...read, callFoldRatio: f.m };
}

/** The keep of one call step with his multiplier; the keep itself when m is absent. */
export function omahaCallStepKeep(keep: number, m: number | undefined): number {
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return keep;
  return clamp(1 - m * (1 - keep), 0.05, 0.97);
}
