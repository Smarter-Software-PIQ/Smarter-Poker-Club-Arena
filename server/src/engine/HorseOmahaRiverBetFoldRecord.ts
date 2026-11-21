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
