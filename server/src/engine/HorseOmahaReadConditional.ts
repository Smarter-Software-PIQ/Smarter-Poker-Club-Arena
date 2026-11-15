/**
 * OMAHA READ-CONDITIONAL DEFENCE (2026-11-15, PLO Strategy lane).
 *
 * Owner, 2026-11-15 01:03 Chicago (PLO Strategy chat): the Horses play
 * differently against a maniac and against a tight player; fix the problem,
 * not particular calls or folds. Three PLO rules built on the owner's
 * complaints failed their declared league evaluations and ship OFF:
 *  - omahaBeatenMadeHandDefense (turn no-raise, scare-card check): Horses vs a
 *    loose-aggressive value seat PLO4 -23.73, PLO5 -16.17 bb/100;
 *  - omahaReraisedPotDiscipline (preflop 4-bet fold): vs that seat PLO5
 *    -11.95, but vs a light 4-bettor PLO4 +14.94;
 *  - omahaOnePairDiscipline.
 * Each rule is right against one kind of player and wrong against another.
 * This module is the read that tells the two apart, for two NEW opt-in
 * options (HorseDecideOpts, read `=== true`, default OFF). The failed options
 * and their modules are unchanged.
 *
 * omahaReraisedFoldVsTight: the preflop 4-bet fold of HorseOmahaReraisedPot
 *   (omahaReraisedPreflopCell, unchanged) applies only when the last preflop
 *   raiser is a MEASURED TIGHT RE-RAISER (tightReRaiser below). Against a
 *   measured wide re-raiser, a maniac or an unknown or presumed player the
 *   Horse plays as today.
 * omahaMadeHandDefenseVsValueLeader: the turn no-raise and the scare-card
 *   checks of HorseOmahaMadeHandDefense (omahaBeatenNoRaise, omahaBeatenNoBet,
 *   unchanged) apply only when every live opponent is a MEASURED VALUE LEADER
 *   (valueLeader below): his POSTFLOP play is value-heavy, whatever his
 *   preflop width (lane owner, 2026-11-15: the top PLO5 winner against the
 *   Horses is maniac-wide preflop but value-heavy postflop, bet when checked
 *   to 0.34, fold to a bet 0.47, river call 0.20, and is exactly the player
 *   this defence is for). Against a measured over-bluffer, a station or an
 *   unknown or presumed player the Horse plays as today.
 *
 * EVIDENCE (the decayed exploit counters every read uses, probe-adjusted, the
 * exact context's row; posteriors with EXPLOIT_PRIOR_STRENGTH pseudo
 * observations of the Horse mean of this game and table size):
 *  MEASURED  at least PRESUMPTION_PROOF_MIN_OPPS (15) decayed hands, and the
 *            Omaha presumption is not what supplies the read: on these
 *            counters presumedAggressorRead says 'evidenced' (his own read
 *            engages a maniac raise width) or 'disproved' (he credibly raises
 *            no more than the average Horse). A presumed read never counts.
 *  TIGHT RE-RAISER  measured; not a maniac (maniacRaiseWidth null) and his
 *            re-raise read not engaged high; at least
 *            OMAHA_TIGHT_RERAISE_MIN_OPPS decayed re-raise opportunities (he
 *            faced a single raise); his re-raise rate is credibly
 *            (EXPLOIT_CREDIBILITY, 0.9 one-sided) at or below the Horse mean.
 *            The Horse mean is about 4.7% at six-handed PLO4 and PLO5 and the
 *            envelope's low edge is 0, so this is the measurable form of "well
 *            below the Horses": a player re-raising at the Horse rate passes
 *            with probability about 0.6 and never clears 0.9; a player who has
 *            not re-raised in 12 or more decayed opportunities does. A recent
 *            re-raise burst (fast window, EXPLOIT_FAST_MIN_N opportunities,
 *            credibly above the Horse mean at EXPLOIT_FAST_OFF_CREDIBILITY)
 *            withdraws the read.
 *  VALUE LEADER  measured; at least OMAHA_VALUE_LEADER_MIN_OPPS decayed
 *            opportunities both checked to and facing a bet postflop; and
 *            postflop:
 *            - not over-bluffing: his bet-when-checked-to read is not engaged
 *              high, he is not a postflop maniac (isPostflopManiac), and his
 *              bet rate when checked to is NOT credibly (0.9) above the Horse
 *              mean; a recent betting burst (fast window credibly above the
 *              Horse mean at EXPLOIT_FAST_OFF_CREDIBILITY) withdraws the read;
 *            - value-heavy: he folds to a postflop bet at least as often as
 *              the average Horse (posterior mean at or above the Horse mean,
 *              not engaged low) and calls river bets no more often than the
 *              average Horse (posterior mean at or below the Horse mean, not
 *              engaged high): no station.
 *            Preflop width is not part of it.
 *
 * Pure: no state, no random draws, no telemetry.
 */
import type { ReadScope } from './HorseMind.js';
import {
  EXPLOIT_CREDIBILITY,
  EXPLOIT_FAST_MIN_N,
  EXPLOIT_FAST_OFF_CREDIBILITY,
  EXPLOIT_PRIOR_STRENGTH,
  EXPLOIT_SIDES,
  PRESUMPTION_PROOF_MIN_OPPS,
  betaCdf,
  exploitEnvelopeFor,
  isPostflopManiac,
  maniacRaiseWidth,
  presumedAggressorRead,
  statRead,
  type ExploitCounters,
  type ExploitStat,
  type ExploitStatRead,
  type OpponentExploitRead,
  OPPONENT_EXPLOIT_ENVELOPE_VERSION,
  OPPONENT_EXPLOIT_VERSION,
} from './HorseOpponentExploit.js';

/** Decayed hands before any read-conditional read exists (the presumption's own floor). */
export const OMAHA_READCOND_MIN_HANDS = PRESUMPTION_PROOF_MIN_OPPS;
/** Decayed re-raise opportunities (faced a single raise) before a tight re-raiser can be read. */
export const OMAHA_TIGHT_RERAISE_MIN_OPPS = 12;
/** One-sided credibility that he re-raises no more than the average Horse. */
export const OMAHA_TIGHT_RERAISE_CREDIBILITY = EXPLOIT_CREDIBILITY;
/** Decayed postflop opportunities (checked to, and facing a bet) before a value leader can be read. */
export const OMAHA_VALUE_LEADER_MIN_OPPS = 8;
/** One-sided credibility above the Horse mean bet-when-checked-to that makes an over-bluffer. */
export const OMAHA_VALUE_LEADER_OVERBLUFF_CREDIBILITY = EXPLOIT_CREDIBILITY;

export interface OmahaReadConditional {
  /** decayed hands behind the read */
  hands: number;
  /** his own evidence supplies the read (presumption evidenced or disproved) */
  measured: boolean;
  /** measured tight re-raiser: omahaReraisedFoldVsTight applies against him */
  tightReRaiser: boolean;
  /** measured value-heavy postflop: omahaMadeHandDefenseVsValueLeader applies against him */
  valueLeader: boolean;
  threeBet: ExploitStatRead;
  betCheckedTo: ExploitStatRead;
  foldToBet: ExploitStatRead;
  riverCall: ExploitStatRead;
}

const FIELDS: Readonly<
  Record<ExploitStat, readonly [keyof ExploitCounters, keyof ExploitCounters]>
> = {
  vpip: ['vpip', 'hands'],
  pfr: ['pfr', 'hands'],
  rfi: ['rfi', 'rfiOpp'],
  threeBet: ['threeBet', 'threeBetOpp'],
  foldTo3Bet: ['foldTo3Bet', 'foldTo3BetOpp'],
  betCheckedTo: ['betCheckedTo', 'betCheckedToOpp'],
  foldToBet: ['foldToBet', 'foldToBetOpp'],
  riverCall: ['riverCall', 'riverCallOpp'],
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/** P(rate <= x) on the shrunk Beta posterior statRead uses. */
function credibleAtOrBelow(s: number, n: number, mean: number, x: number): number {
  const opp = Math.max(0, n);
  const succ = Math.max(0, Math.min(opp, s));
  const k = EXPLOIT_PRIOR_STRENGTH;
  return betaCdf(x, mean * k + succ, (1 - mean) * k + (opp - succ));
}

/**
 * The read-conditional read of one Omaha opponent, or null when there is no
 * counter row, no Omaha scope or no envelope. `exploit` is the same
 * counters' high-side read (opponentExploitRead), null when nothing engaged.
 */
export function omahaReadConditional(
  counters: ExploitCounters | undefined,
  scope: ReadScope | null,
  variant: string | null | undefined,
  exploit: OpponentExploitRead | null
): OmahaReadConditional | null {
  if (!counters || !scope || !scope.startsWith('omaha:')) return null;
  const envelope = exploitEnvelopeFor(scope, variant);
  if (!envelope) return null;
  const hands = num(counters.hands);
  // The statistics as measured (the exploit read's own where it has them).
  const stat = (st: ExploitStat): ExploitStatRead => {
    const own = exploit?.stats[st];
    if (own) return own;
    const [s, o] = FIELDS[st];
    return statRead(num(counters[s]), num(counters[o]), envelope[st], EXPLOIT_SIDES[st]);
  };
  const stats = {} as Record<ExploitStat, ExploitStatRead>;
  for (const st of Object.keys(FIELDS) as ExploitStat[]) stats[st] = stat(st);
  const outcome = presumedAggressorRead(exploit, counters, scope, variant).outcome;
  const measured =
    hands >= OMAHA_READCOND_MIN_HANDS && (outcome === 'evidenced' || outcome === 'disproved');

  // TIGHT RE-RAISER
  const tbMean = envelope.threeBet.mean;
  const tbOpp = num(counters.threeBetOpp);
  const fTbOpp = num(counters.fThreeBetOpp);
  const reRaisingAgain =
    fTbOpp >= EXPLOIT_FAST_MIN_N &&
    1 - credibleAtOrBelow(num(counters.fThreeBet), fTbOpp, tbMean, tbMean) >=
      EXPLOIT_FAST_OFF_CREDIBILITY;
  const tightReRaiser =
    measured &&
    maniacRaiseWidth(exploit) === null &&
    stats.threeBet.engaged !== 'high' &&
    tbOpp >= OMAHA_TIGHT_RERAISE_MIN_OPPS &&
    credibleAtOrBelow(num(counters.threeBet), tbOpp, tbMean, tbMean) >=
      OMAHA_TIGHT_RERAISE_CREDIBILITY &&
    !reRaisingAgain;

  // VALUE LEADER (postflop only)
  const bctMean = envelope.betCheckedTo.mean;
  const bctOpp = num(counters.betCheckedToOpp);
  const fBctOpp = num(counters.fBetCheckedToOpp);
  const bettingAgain =
    fBctOpp >= EXPLOIT_FAST_MIN_N &&
    1 - credibleAtOrBelow(num(counters.fBetCheckedTo), fBctOpp, bctMean, bctMean) >=
      EXPLOIT_FAST_OFF_CREDIBILITY;
  const measuredRead: OpponentExploitRead = exploit ?? {
    version: OPPONENT_EXPLOIT_VERSION,
    envelope: OPPONENT_EXPLOIT_ENVELOPE_VERSION,
    scope,
    stats,
  };
  const overBluffs =
    stats.betCheckedTo.engaged === 'high' ||
    isPostflopManiac(measuredRead) ||
    1 - credibleAtOrBelow(num(counters.betCheckedTo), bctOpp, bctMean, bctMean) >=
      OMAHA_VALUE_LEADER_OVERBLUFF_CREDIBILITY ||
    bettingAgain;
  const valueHeavy =
    stats.foldToBet.engaged !== 'low' &&
    stats.foldToBet.mean >= envelope.foldToBet.mean &&
    stats.riverCall.engaged !== 'high' &&
    stats.riverCall.mean <= envelope.riverCall.mean;
  const valueLeader =
    measured &&
    bctOpp >= OMAHA_VALUE_LEADER_MIN_OPPS &&
    num(counters.foldToBetOpp) >= OMAHA_VALUE_LEADER_MIN_OPPS &&
    !overBluffs &&
    valueHeavy;

  return {
    hands,
    measured,
    tightReRaiser,
    valueLeader,
    threeBet: stats.threeBet,
    betCheckedTo: stats.betCheckedTo,
    foldToBet: stats.foldToBet,
    riverCall: stats.riverCall,
  };
}
