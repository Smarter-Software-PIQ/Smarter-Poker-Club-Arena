/**
 * THE RIVER BET IS PRICED ON HIS OWN FOLD RECORD (EMERG lane STAB-DEFENCE-5, PLO-OWNER lead-3, 2026-11-21; option
 * omahaRiverBetFoldIsHisRecord, default OFF, read `=== true`; scopable per game with horse.omahaGameScope).
 *
 * WHY. The two river bet rules (omahaRiverFirstToActBetIsPriced, omahaRiverCheckedToBetIsMeasured) price a bet with
 * the POPULATION's answer curve for every opponent alike: at the pot, three answers in four are folds. Against an
 * opponent who does not fold the river that price is wrong in one direction only: the candidate set bet the river
 * about twice as often into the calling-station probe and the added bets won far less per call (grade under
 * AMENDMENT-4, seeds 20261123 / 20261124: heads-up station +10.41 +- 8.11 bb/100, +1.28 SE: the guard that failed).
 *
 * WHAT IT DOES. Nothing by itself. With the option on, the answer curve those two rules price with is the
 * population's curve with its FOLD share multiplied by m, the opponent's own lifetime PUBLIC fold record at a river's
 * first wager over what the population folds at the same sizes, shrunk to the population by n / (n + k)
 * (HorseOmahaStrongHandCheck.omahaStrongHandCheckFoldMultiplier: k = 75.9 river answers, measured; the record is
 * OPPONENT-HUD's x.foldToBet cells through HorseMind's lifetime provider). The raise share of his continues is
 * unchanged. No record, no provider or any error: m = 1 and the population curve exactly (the same array object), so
 * the two rules decide as they do today.
 *
 * The value side follows from the same number and needs no rule: the rules take the Horse's equity against the hands
 * that CONTINUE, and a man who continues with more of his range continues with weaker hands, so a bet for value is
 * worth more against him and a bet that needs folds is worth less. Both directions, one multiplier, every opponent.
 *
 * ERROR. The fold share's standard error at a point becomes sqrt((m x se_pop)^2 + (fold_pop x se_m)^2): the bet must
 * still beat the check by more than the comparison's own error.
 *
 * No hand class, position, size band or fixed percentage; nothing keyed to an account, a person or a Horse; public
 * actions only. Pure: no random draw, no telemetry, no state.
 */
import {
  omahaStrongHandCheckFoldMultiplier,
  type OmahaStrongHandCheckRecords,
} from './HorseOmahaStrongHandCheck.js';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The shape both river rules' measured points share. */
export interface OmahaRiverBetAnswerPoint {
  share: number;
  cont: number;
  raise: number;
  foldSe: number;
  n: number;
}

export interface OmahaRiverBetFoldRecordCurve<P extends OmahaRiverBetAnswerPoint> {
  curve: readonly P[];
  /** his fold share over the population's after shrinkage (1 = no record) */
  m: number;
  /** n / (n + k) */
  weight: number;
}

/**
 * The population curve moved by his lifetime river fold record. With no usable record the SAME array is returned.
 */
export function omahaRiverBetFoldRecordCurve<P extends OmahaRiverBetAnswerPoint>(
  variant: string,
  population: readonly P[],
  records: OmahaStrongHandCheckRecords | null | undefined
): OmahaRiverBetFoldRecordCurve<P> {
  const same = { curve: population, m: 1, weight: 0 };
  try {
    const game = String(variant ?? '').toLowerCase();
    if (game !== 'plo4' && game !== 'plo5') return same;
    const f = omahaStrongHandCheckFoldMultiplier(game, 'river', records);
    if (!(f.weight > 0) || !fin(f.m) || !(f.m >= 0) || !fin(f.se)) return same;
    const curve = population.map((p) => {
      const foldPop = clamp(1 - p.cont, 0, 1);
      const cont = 1 - clamp(f.m * foldPop, 0, 1);
      return {
        ...p,
        cont,
        raise: p.cont > 0 ? clamp((p.raise * cont) / p.cont, 0, cont) : 0,
        foldSe: Math.sqrt((f.m * p.foldSe) ** 2 + (foldPop * f.se) ** 2),
      };
    });
    return { curve, m: f.m, weight: f.weight };
  } catch {
    return same;
  }
}

/**
 * HIS CHECKS ARE READ THROUGH HIS OWN BET RECORD (PLO-OWNER lead-7 lane river-station, 2026-11-26; option
 * omahaRiverBetCheckIsHisRecord, default OFF, read `=== true`; scopable per game with horse.omahaGameScope).
 *
 * WHY (root cause of the PLO5 calling-station loss of the two river bet rules with omahaRiverBetFoldIsHisRecord and
 * omahaRiverBetFoldIsPeopleMeasured on: -4.86 +/- 1.16 bb/100, PLO5 heads-up, 16,000 deals, seed 11). Instrumented,
 * every bet the two rules added against the station reached a showdown (130); 122 were checked-to river bets at the
 * pot priced as VALUE with a called equity of 0.63, and they won 36 and lost 85: -763 bb, the whole loss (the 8
 * first-to-act bets: +1 bb). His fold record had already moved the curve to "he calls" (record weight 0.92, fold
 * 0.06): the fold side was priced right. The EQUITY was wrong. The card-impact range model (HorseOmahaCardImpact.ts)
 * reads every check of his as capping his range: after a check the top 0.7 x betCheckedTo of his holdings keeps
 * weight 0.35, with betCheckedTo the population's share of bets when checked to (0.477 in these two rules). That is
 * true of a player who bets the top of his range when he can; a player who never bets checks the nuts, and his
 * checks cap nothing. Priced like a regular's, the station's checks made a weak range out of an uncapped one, and
 * the rules bet medium hands "for value" into it.
 *
 * WHAT IT DOES. Nothing by itself. With the option on, the share the range model reads HIS CHECKS with (the top
 * 0.7 x share of his range a check makes less likely) and, first to act, his chance of betting after the Horse
 * checks, is moved by HIS OWN lifetime PUBLIC heads-up record of first wagers on unopened turn and river action
 * (OPPONENT-HUD's hudFirstWagerRecord through HorseMind.omahaStabDefenceRecordOf, the two streets pooled), shrunk to
 * PEOPLE's rate on the same counter:
 *     his = (bets + k x people) / (opps + k),   checkBetShare = clamp(betCheckedTo x his / people, 0, 1).
 * The model has one betCheckedTo for every street, so his one measured multiplier replaces the population's for
 * every check of his. His BETS are still read with betCheckedTo (the model's bet mask is a top share with a 0.25
 * floor: a tiny share would make a rare bettor's bet look like no information, the wrong way round). A player who
 * never bets unopened has checks that cap nothing and never stabs; one who bets more than people caps harder; with
 * no record the read is returned unchanged (the same object).
 *
 * PRIOR ANCHOR (owner order 2026-11-26: population figures from PEOPLE only; Horses removed by profiles.is_horse, the
 * stored HUD '*' rows not used): PLO4/PLO5 cash, heads-up, a player's first action on an unopened turn or river,
 * Nov 19 18:00Z - Nov 26 17:48Z 2026: PLO4 212 bets in 713 (turn 114 / 395, river 98 / 318), PLO5 989 in 2,684
 * (turn 617 / 1,591, river 372 / 1,093). k = p(1 - p) / tau^2 - 1 on people with at least 5 opportunities, games
 * and the two streets pooled: 23.2 (19 players; river-station/measure-unop.mjs on the plo-bluffs pull). The ratio
 * form keeps the rules' own betCheckedTo as the anchor for a player who bets like people.
 *
 * No hand class, position, size band or fixed percentage; nothing keyed to an account, a person or a Horse; public
 * actions only. Pure.
 */
export const OMAHA_PEOPLE_UNOPENED_BET_HU: Readonly<
  Record<'plo4' | 'plo5', Readonly<{ bets: number; opps: number }>>
> = Object.freeze({
  plo4: Object.freeze({ bets: 212, opps: 713 }),
  plo5: Object.freeze({ bets: 989, opps: 2684 }),
});
export const OMAHA_PEOPLE_UNOPENED_BET_PRIOR_OPPS = 23.2;

export interface OmahaUnopenedBetRecord {
  bets: number;
  opps: number;
}

/** His shrunk unopened bet rate over people's (turn and river pooled); ratio 1, weight 0 with no usable record. */
export function omahaUnopenedBetRatio(
  variant: string,
  records: ReadonlyArray<OmahaUnopenedBetRecord | null | undefined>
): { ratio: number; weight: number } {
  const none = { ratio: 1, weight: 0 };
  try {
    const game = String(variant ?? '').toLowerCase();
    if (game !== 'plo4' && game !== 'plo5') return none;
    let bets = 0;
    let opps = 0;
    for (const r of records) {
      if (!r || !fin(r.bets) || !fin(r.opps) || !(r.opps > 0) || r.bets < 0) continue;
      bets += Math.min(r.bets, r.opps);
      opps += r.opps;
    }
    if (!(opps > 0)) return none;
    const cell = OMAHA_PEOPLE_UNOPENED_BET_HU[game];
    const p = cell.bets / cell.opps;
    const k = OMAHA_PEOPLE_UNOPENED_BET_PRIOR_OPPS;
    const ratio = (bets + k * p) / (opps + k) / p;
    if (!fin(ratio) || !(ratio >= 0)) return none;
    return { ratio, weight: opps / (opps + k) };
  } catch {
    return none;
  }
}

/** The read with his own check share (checkBetShare); the SAME object with no usable record. */
export function omahaRiverBetCheckRead<R extends { betCheckedTo: number; checkBetShare?: number }>(
  variant: string,
  read: R,
  records: ReadonlyArray<OmahaUnopenedBetRecord | null | undefined>
): R {
  const f = omahaUnopenedBetRatio(variant, records);
  if (!(f.weight > 0) || !fin(read.betCheckedTo)) return read;
  return { ...read, checkBetShare: clamp(read.betCheckedTo * f.ratio, 0, 1) };
}
