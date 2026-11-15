/**
 * HEADS-UP SMALL BLIND STEALS AGAINST A PROVEN TIGHT BIG BLIND (2026-11-15,
 * D6 of the heads-up serving policy, option huSmallBlindStealsVsTightBigBlind,
 * default OFF).
 *
 * The defect (Hand Analysis grade, 2026-11-15): heads-up no-limit hold'em has
 * no first-in consumer for a credibly tight big blind. Against a player who
 * folds his big blind about 91% of the time the small blind's first-in
 * decisions changed in 0 of 507 replayed decisions: the first-in block asks
 * only whether a maniac is behind.
 *
 * The read is the existing one, unchanged: the same decayed heads-up counters
 * opponentRead reads, the population envelope of this game and table size
 * (exploitEnvelopeFor) and the posterior the Omaha tight read uses
 * (credibleAtOrBelow, prior EXPLOIT_PRIOR_STRENGTH pseudo-observations of the
 * mean, EXPLOIT_CREDIBILITY one-sided). No threshold of the exploit read or of
 * the style read is changed or consulted here.
 *
 * A PROVEN TIGHT FOLDER: at least PRESUMPTION_PROOF_MIN_OPPS decayed hands;
 * VPIP credibly at or below HU_TIGHT_FOLDER_VPIP_SHARE of the population mean;
 * no preflop statistic engaged on the high side and no maniac width; the
 * recent (fast window) raise rate not credibly above the population mean.
 *
 * THE STEAL: heads-up, each player is the big blind in half the hands, so the
 * share of big blinds he continues with is at most HU_BIG_BLIND_HAND_SHARE_BOUND
 * times his VPIP (all of his voluntary hands in the big blind). His fold share
 * is therefore at least 1 - 2 x VPIP. When that worst case clears the
 * break-even of the largest heads-up open on folds alone (the open loses its
 * whole risk every time it is called), every hand is a profitable open and
 * every hand opens. Otherwise nothing changes. Widen-only: no size changes, no
 * jam, no limp, nothing facing a raise.
 *
 * Pure: no state, no random draws.
 */
import type { ReadScope } from './HorseMind.js';
import {
  EXPLOIT_FAST_MIN_N,
  EXPLOIT_FAST_OFF_CREDIBILITY,
  EXPLOIT_PRIOR_STRENGTH,
  PRESUMPTION_PROOF_MIN_OPPS,
  betaCdf,
  exploitEnvelopeFor,
  maniacRaiseWidth,
  type ExploitCounters,
  type OpponentExploitRead,
} from './HorseOpponentExploit.js';
import { credibleAtOrBelow } from './HorseOmahaTightOpponent.js';
import { NLH_OPEN_BANDS_CASH_ACTION, NLH_OPEN_BANDS_TOURNAMENT } from './HorseNlhOpenSize.js';

/** Decayed hands before a tight-folder read can exist (the disproof's own floor). */
export const HU_TIGHT_FOLDER_MIN_HANDS = PRESUMPTION_PROOF_MIN_OPPS;
/** A folder's VPIP must be credibly at or below this share of the population mean
 *  (the share the Omaha tight folder uses; not tuned here). */
export const HU_TIGHT_FOLDER_VPIP_SHARE = 0.6;
/** Heads-up, a player is the big blind in half the hands: his big-blind
 *  continue share is at most this multiple of his VPIP. */
export const HU_BIG_BLIND_HAND_SHARE_BOUND = 2;
/** Effective depth band, the heads-up defence family's own (HorseHuBbDefence). */
export const HU_STEAL_MIN_STACK_BB = 20;
export const HU_STEAL_MAX_STACK_BB = 150;
/** The open priced is the largest heads-up open the sizer can draw. */
export const HU_STEAL_CASH_OPEN_CEILING_BB = NLH_OPEN_BANDS_CASH_ACTION.heads_up[1];
export const HU_STEAL_TOURNAMENT_OPEN_CEILING_BB = NLH_OPEN_BANDS_TOURNAMENT.heads_up[1];

const PREFLOP_STATS = ['vpip', 'pfr', 'rfi', 'threeBet'] as const;

export interface HuTightFolderRead {
  hands: number;
  /** true when the player is a proven tight folder */
  folder: boolean;
  /** posterior VPIP mean */
  vpip: number;
}

export interface HuTightBigBlindSteal {
  /** the big blind's worst-case fold share, 1 - 2 x posterior VPIP */
  pFoldLower: number;
  /** the fold share the open needs to break even on folds alone */
  breakEven: number;
}

/**
 * The tight-folder read of one heads-up no-limit hold'em opponent from his
 * decayed counters in this scope, or null when there is nothing to judge.
 * `exploit` is the same player's high-side exploit read (null when nothing
 * engaged).
 */
export function huTightFolderRead(
  counters: ExploitCounters | undefined,
  scope: ReadScope | null,
  variant: string | null | undefined,
  exploit: OpponentExploitRead | null
): HuTightFolderRead | null {
  if (!counters || scope !== 'holdem:hu') return null;
  const hands = Math.max(0, Number(counters.hands ?? 0));
  if (!(hands >= HU_TIGHT_FOLDER_MIN_HANDS)) return null;
  const envelope = exploitEnvelopeFor(scope, variant);
  if (!envelope) return null;
  const vpipRead = credibleAtOrBelow(
    counters.vpip,
    hands,
    envelope.vpip.mean,
    HU_TIGHT_FOLDER_VPIP_SHARE * envelope.vpip.mean
  );
  const wide =
    maniacRaiseWidth(exploit) !== null ||
    PREFLOP_STATS.some((st) => exploit?.stats[st]?.engaged === 'high');
  const k = EXPLOIT_PRIOR_STRENGTH;
  const fHands = Math.max(0, Number(counters.fHands ?? 0));
  let raisingAgain = false;
  if (fHands >= EXPLOIT_FAST_MIN_N) {
    const fs = Math.max(0, Math.min(fHands, Number(counters.fPfr ?? 0)));
    raisingAgain =
      1 -
        betaCdf(
          envelope.pfr.mean,
          envelope.pfr.mean * k + fs,
          (1 - envelope.pfr.mean) * k + (fHands - fs)
        ) >=
      EXPLOIT_FAST_OFF_CREDIBILITY;
  }
  return {
    hands,
    folder: !wide && !raisingAgain && vpipRead.engaged === 'low',
    vpip: vpipRead.mean,
  };
}

/**
 * The steal, or null. `riskBB` is what the largest open costs the small blind
 * from here, `deadBB` the money already in the pot (blinds and antes).
 */
export function huTightBigBlindSteal(
  read: HuTightFolderRead | null,
  riskBB: number,
  deadBB: number
): HuTightBigBlindSteal | null {
  if (!read?.folder || !(riskBB > 0) || !(deadBB > 0)) return null;
  const pFoldLower = Math.max(0, 1 - HU_BIG_BLIND_HAND_SHARE_BOUND * read.vpip);
  const breakEven = riskBB / (riskBB + deadBB);
  if (!(pFoldLower > breakEven)) return null;
  return { pFoldLower, breakEven };
}
