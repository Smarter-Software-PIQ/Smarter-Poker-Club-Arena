import { noteHorseDeepDiveRule } from './HorseDeepDiveReceipt.js';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * HORSE PREFLOP V7 — Position-Pair Preflop Mastery (2026-07-24)
 * ═══════════════════════════════════════════════════════════════════════════════
 * The V7 replacement for the V2 preflop layer. Everything downstream (V3 range
 * reads, V4 street IQ, V5 hand reading) inherits its edge from preflop range
 * quality, so this is the highest-leverage layer in the engine.
 *
 * What V2 did not have, V7 does:
 *  - POSITION-PAIR 3-BETTING: a button open is 3-bet far wider than an
 *    under-the-gun open; the blinds re-steal against late position.
 *  - 3-BET BLUFFS from the blinds and in position with the right mid hands.
 *  - 4-BET BLUFFS: V2's 4-bets were pure value and therefore exploitable.
 *  - BLIND-VS-BLIND play: SB opens wide vs a lone BB; BB defends wide and
 *    re-raises both for value and as a bluff.
 *  - SQUEEZE logic: raiser + caller(s) get squeezed for value AND as a bluff,
 *    with proper multi-caller sizing.
 *  - STACK-DEPTH awareness: deep stacks widen speculative suited/connected
 *    opens and cold calls; shallow stacks tighten them and open-jam more.
 *  - RESHOVE STACKS: 13-20bb jam over late opens instead of flatting.
 *  - TOURNAMENT RISK PREMIUM (ICM-lite): survival pressure raises every
 *    calling threshold and trims bluffs when chips lost hurt more than chips
 *    won help.
 *
 * PURE decision logic: no imports from HorseLogic (the caller computes hand
 * strength, position, and context and passes them in), so there are no
 * circular module dependencies. Returns an INTENT that HorseLogic legalizes
 * against the engine's own validateAction rules.
 *
 * NEVER refer to the horses as "bots" — they are HORSES only.
 */

import type { Card } from '../types.js';
import { potLimitRaiseTo } from './BettingStructure.js';
import { completePreflopCommitment } from './HorseContinuation.js';
import {
  classifyHoldemEpLimpCandidate,
  holdemClass,
  v85DepthWeight,
  type HoldemEpLimpKind,
} from './HorseGtoOpeningRanges.js';
import {
  V87_MULTIWAY_DEFENCE,
  v87LowStakesWeight,
  v87WidenDefence,
} from './HorseGtoDefenceRanges.js';
import { nlhOpenRaiseTo, nlhOpenSeat } from './HorseNlhOpenSize.js';
import type { HeroPriorPreflopAction } from './HorsePreflopOrbitState.js';
import { cashNlhThreeBetRaiseTo } from './HorseCashThreeBetSize.js';
import { huBbRequiredEquity } from './HorseHuBbDefence.js';
import { limpReraiseIsoBar } from './HorseLimpReraiseRead.js';
import {
  omahaTournamentFirstIn,
  type OmahaTournamentFirstInParams,
} from './HorseOmahaTournamentFirstIn.js';
import {
  v87OmahaCallBarBounds,
  v87OmahaColdCallTighten,
  v87PricedInMinStrength,
} from './HorseDeepDiveDiscipline.js';
import {
  tournamentMZone,
  tournamentNextLevelProjectionApplies,
  type TournamentMState,
  type TournamentPreflopPolicy,
} from './HorseTournamentPreflop.js';
import type { OmahaPressureShifts } from './HorseOmahaTournamentPressure.js';
import type { OmahaEliteClassRead } from './HorseHandClasses.js';

export type PreflopPosition = 'early' | 'middle' | 'late' | 'sb' | 'bb';

/** The actual facing-open branch; classification alone is not application. */
export interface PreflopAuthorityEvent {
  branch:
    | 'v46_class_flat'
    | 'v16_non_aa_flat'
    | 'value_trap'
    | 'premium_value'
    | 'strength_value'
    | 'squeeze_bluff'
    | 'three_bet_bluff'
    | 'v87_ep_limp_trap'
    | 'v87_ep_limp_suited_connector'
    | 'v87_ep_limp_reraise_value'
    | 'v87_ep_limp_reraise_bluff'
    | 'v87_ep_limp_call_iso';
  strength: number;
  threeBetThreshold: number;
  effectiveThreeBetThreshold: number;
  premiumValue: boolean;
  pressure: boolean;
}

export interface PreflopAuthorityReceipt {
  version: 1;
  scope: 'reference_preflop';
  events: readonly PreflopAuthorityEvent[];
  context: {
    raises: number;
    callers: number;
    toCall: number;
    stack: number;
    position: PreflopPosition;
    isOmaha: boolean;
    classNeverThreeBet: boolean;
  };
  intent: PreflopIntent;
  /** Direct V7 glue return, before later reference wrappers or policy owners. */
  referenceAction: string;
  referenceAmount?: number;
}

export interface PreflopIntent {
  a: 'fold' | 'check' | 'call' | 'jam' | 'raiseTo';
  /** raise-TO target for a === 'raiseTo' (pre-legalization) */
  to?: number;
  /** Telemetry receipt the caller fires (this module has no telemetry):
   *  'v74_nlh_open_size' = the open was drawn from the V74 band;
   *  'v76_retired_four_bet_bluff' = the V7 4-bet-bluff band would have
   *  fired and was retired. Never changes the action. */
  receipt?:
    | 'v74_nlh_open_size'
    | 'v76_retired_four_bet_bluff'
    | 'cash_nlh_three_bet_size'
    | 'plo_suited_aces_four_bet'
    | 'plo_suited_aces_four_bettor_continues'
    | 'hu_bb_defends_to_price'
    | 'v86_plo_elite_three_bet'
    | 'v86_plo_squeeze'
    | 'v86_plo_shallow_four_bet'
    | 'v86_plo_three_bettor_continues';
}

/** Layers that report through PreflopCtx.noteLayer (receipt only). */
export type PreflopLayerReceipt =
  | 'v60_cash_pressure_facing_open'
  | 'v60_cash_pressure_facing_open_superseded'
  | 'v60_cash_pressure_opener_vs_three_bet'
  | 'v87_deep_dive_discipline'
  | 'bluff_raise_refused_no_fold_equity_seen'
  | 'omaha_tournament_first_in';

/**
 * Dan 2026-11-06 (PLO5 1/2 Madness, hand 55704472): "I JUST WATCHED NOODLE NOT
 * RE RAISE PRE FLOP WITH SUITED ACES". The horse opened Ad Ac Kd 9d 3h, was
 * 3-bet pot by the small blind and flat called. The suited-aces anchor
 * (#7838) only reached the facing-an-open branch; facing a 3-bet the 4-bet
 * bar read the raw percentile, and a PLO5 AAxxx hand rates about 0.69 against
 * a bar near 0.87, so suited aces could never 4-bet. Now, in a high-only
 * pot-limit Omaha game, exactly two aces with an ace suited to another card
 * 4-bet the pot facing exactly one 3-bet, at every frequency (the same anchor
 * the 3-bet uses), when the call is not already a commitment (at most a
 * quarter of the stack; past that the commitment rules decide) and the
 * effective stack is at most OMAHA_SUITED_ACES_FOUR_BET_MAX_BB deep. A suited
 * aces raiser that is re-raised again continues at any price it can take
 * (required equity at most OMAHA_SUITED_ACES_CONTINUE_ODDS) instead of
 * folding the chips it just raised.
 */
export const OMAHA_SUITED_ACES_FOUR_BET_MAX_BB = 250;
export const OMAHA_SUITED_ACES_CONTINUE_ODDS = 0.45;

export interface PreflopCtx {
  /** Phase 6 total tournament atlas cell and exact M snapshot. */
  phase6?: { policy: TournamentPreflopPolicy; m: TournamentMState };
  /** V13: when false, keep the V11 price-in guard's original early-return
   *  shape (ablation only — see decidePreflopV7). Default true. */
  v13?: boolean;
  /** Projected fraction removed from the final contested cash award. */
  callDeductionFraction?: number;
  /** percentile hand strength 0..1 (variant-aware, jittered by caller) */
  strength: number;
  position: PreflopPosition;
  /** position of the LAST preflop raiser, if any */
  raiserPosition: PreflopPosition | null;
  /** number of raises so far this street */
  raises: number;
  /** callers before any raise */
  limpers: number;
  /** callers of the current raise */
  callers: number;
  /** live opponents not yet folded */
  oppsLeft: number;
  toCall: number;
  currentBet: number;
  /** Pot hero can actually win, excluding hero's not-yet-committed call. */
  contestablePot?: number;
  /** Full betting pot. Pot-limit raise ceilings and sizing continue to use it. */
  pot: number;
  bigBlind: number;
  stack: number;
  stackBB: number;
  /** style parameters (already modifier-scaled by the caller) */
  tightness: number;
  bluffFreq: number;
  aggression: number;
  slowplayFreq: number;
  sizingMultiplier: number;
  /** Cash NLH public seat/depth context, supplied by the live brain. */
  cashThreeBetSizing?: { inPosition: boolean; depthBB: number };
  isOmaha: boolean;
  isPotLimit: boolean;
  isFixedLimit?: boolean;
  /** tournament survival premium, 0 for cash (see HorseLogic.icmRisk) */
  riskAdd: number;
  /** V10: widen the isolation-raise range vs limpers in position (percentile
   *  points to loosen the open floor). 0 = off / legacy behavior. */
  isoWiden?: number;
  /** LIMP-RERAISE READ (flag limpReraiseIsoRead): the strongest shrunk
   *  limp-reraise rate among the limpers in front, present only when the read
   *  engages (HorseLimpReraiseRead). Absent = today's isolation. */
  limpReraiseRate?: number;
  /** V11 GAME MODE (Dan 2026-08-22): cash and tournaments are DIFFERENT games.
   *  Explicit mode from the table engine (tournament_id / game_type), never
   *  guessed from blind size. Absent = legacy behavior. */
  mode?: 'cash' | 'tournament';
  /** V11: an ante is in play — opens/steals widen (dead money in every pot). */
  anteInPlay?: boolean;
  /** V12: table format. Spins are 3-max hypers — every range widens hard
   *  (shallow, high blind pressure). NOT "winner-take-all": below 10x the
   *  tier pays one place, but 10x pays 80/20 and 25x and up pay 80/12/8, and
   *  that ladder is priced by `riskAdd` (HorseLogic.icmRisk), never here. */
  format?: 'cash' | 'mtt' | 'sng' | 'spin' | 'hu_sng';
  /** V12 ANTI-EXPLOIT: 0..1 — how hard the current raiser is TARGETING this
   *  horse specifically (HorseMind.targetingOf). A hunter's raises get less
   *  credit: the horse defends wider and fights back with more re-raises,
   *  which is exactly what makes the hunt unprofitable. */
  targeted?: number;
  /** V16 DEEP READS: the current raiser's observed fold-to-3-bet frequency
   *  (0..1), or null/undefined without a qualifying sample. A raiser who
   *  folds 70% to 3-bets gets 3-bet-bluffed relentlessly; one who never
   *  folds gets bluffed at all only with real equity. */
  raiserFoldTo3Bet?: number | null;
  /**
   * 2026-10-16 OPPONENT EXPLOIT (HorseOpponentExploit.preflopVsOpener): the
   * single raiser's own read, present ONLY when it is credibly outside the
   * horse envelope. Bars are on the strength scale. Undefined = every bar
   * below is exactly what it was (the neutrality contract).
   */
  exploitOpener?: {
    wide: boolean;
    threeBetBar: number | null;
    flatBar: number | null;
    bbFlatBar: number | null;
    noBluffThreeBet: boolean;
  };
  /**
   * 2026-10-24 V53 PRESSURE (HorseOpponentExploit.aggressiveOpenerPressure):
   * the single raiser is a credibly WIDE opener. Heads-up against them the
   * value 3-bet widens to these bars - in position the most - and the
   * rundown/broadway "take a flop" flats give way to the 3-bet. Undefined =
   * unchanged (the neutrality contract).
   */
  exploitPressure?: { ipThreeBetBar: number; oopThreeBetBar: number };
  /** 2026-10-16: the last re-raiser's read (preflopVsReRaiser), facing a
   *  3-bet or more. Undefined = unchanged. */
  exploitReRaiser?: { fourBetBar: number; callBar: number };
  /**
   * 2026-10-22 MANIAC PRESSURE (HorseOpponentExploit.maniacBehindOpenBar): a
   * maniac is still to act behind this unopened pot, so the open is raised
   * only with a hand that continues when the maniac comes over the top - a
   * hand opened to be folded is not opened. Undefined = unchanged.
   */
  maniacOpenBar?: number;
  /** 2026-10-22: a maniac raised, or is still to act: no bluff 3-bets,
   *  squeezes or 4-bet bluffs (a raise made to fold). Undefined = unchanged. */
  maniacNoBluff?: boolean;
  /** V76 (2026-11-01): the V7 4-bet-bluff band is retired at the source -
   *  the brain never GENERATES a sized 4-bet meant to fold (Dan 2026-10-31,
   *  rule 4: "STOP 4 BETTING POTS IF THEY ARE FOLDING"). Band hands fall to
   *  the call-or-fold read (the V73/V75 width where it applies), instead of
   *  being 4-bet and converted to a call at the final layer, which still
   *  stands as the fail-safe for every other path. Explicit false restores
   *  the band (historical corpora only). */
  retireFourBetBluffBand?: boolean;
  /** V82 (2026-11-05): two- and three-handed no-limit hold'em facing action
   *  reads the short-handed V70 jam-or-fold zone (<= 15bb) instead of the
   *  table-scaled M zone. True on every live decision; absent keeps the
   *  legacy jam-or-fold gate (the off arm). */
  facingOpenShortHandedZone?: boolean;
  /** FULL-RING FACING-ACTION ZONE (2026-11-07, flag facingOpenFullRingZone,
   *  default off): four or more dealt, no-limit hold'em FACING action (never
   *  the open) reads the same <= 15bb jam-or-fold zone V82 gave two- and
   *  three-handed tables instead of the table-scaled M zone (red M, up to
   *  22bb). Absent keeps the legacy gate. */
  facingOpenFullRingZone?: boolean;
  /** SHORT-STACK 3-BET DEFENCE (2026-11-07, flag vs3BetShortStack, default
   *  off): the opener facing one 3-bet whose V73 continue read says continue
   *  but whose call would commit more than the stack cap allows jams instead
   *  of folding (at 12-25bb effective the call is the stack). */
  vs3BetShortJam?: boolean;
  /** V77 (2026-11-02): the V70 open width (percent of 1,326 combos) of the
   *  seat that made the ONLY raise hero faces, dealt-census indexed and
   *  ante-aware. Supplied by HorseLogic for no-limit hold'em facing exactly
   *  one raise; its presence turns on the seat-aware jam tighten at the
   *  push/fold node (see V77 below). */
  openerOpenWidthPct?: number;
  /** HU BB DEFENDS TO ITS PRICE (2026-11-07, flag huBbDefendsToPrice,
   *  default off; HorseHuBbDefence): heads-up no-limit hold'em cash, hero the
   *  big blind facing the only open. `equity` is this class's all-in equity
   *  against the opener's measured range. Present only with the flag on and
   *  the spot in scope; a fold of the heads-up defence becomes a call when
   *  the realised equity covers the price. Absent = unchanged. */
  huBbPrice?: { equity: number };
  /** V20 M-ZONES (2026-08-27): ante cost of ONE ORBIT in BB units, already
   *  resolved for the table's ante style by AnteMath.anteOrbitCostBB (0 = no
   *  ante). NOT per-player: multiplying this by the seat count is the bug of
   *  2026-08-30.
   *  Undefined = layer off — every M computation degrades to legacy
   *  stackBB-only behavior. */
  anteOrbitBB?: number;
  /** ALL-IN-OR-FOLD table: the preflop menu is fold or shove, nothing else.
   *  The brain must KNOW this — see the AoF block for why coercing its answer
   *  downstream is not the same thing. */
  allInOrFold?: boolean;
  /** V20 M-ZONES: players dealt in (for the orbit cost and Harrington's
   *  effective-M table-size scaling). Undefined = layer off. */
  tableSize?: number;
  /** V21 DEEP-STACK DISCIPLINE: scale cash 4-bet/5-bet stack-off thresholds
   *  with depth past 120bb. Undefined/false = legacy behavior. */
  deepDiscipline?: boolean;
  /** PLO6-AUDIT-004 (2026-11-12): the VPIP floor multiplier already folded
   *  into `tightness` (HorseLogic.vpipFloorMul), a number in (0, 1) on a
   *  floored table where the seat is still steering up to its target. Given
   *  only when the deep stack-off correction is on. The floor exists to make
   *  a seat PLAY more hands; with this set, a deep Omaha seat's bar for
   *  putting its whole stack in facing a re-raise is read without the floor
   *  (the hand still continues by calling, which is what the floor counts).
   *  Undefined = unchanged. */
  vpipFloorMul?: number;
  /** V24: enable the Omaha price defense + risk-scaled survival premium.
   *  Undefined/false keeps the exact pre-V24 arithmetic (ablation). */
  ploPriceDefense?: boolean;
  /** V25: enable PLO TOURNAMENT play — the pot-limit commitment zone, the
   *  Omaha reshove, price-driven all-in calls, and the no-raise-fold rule.
   *  Undefined/false keeps the pre-V25 arithmetic (ablation). */
  ploTourney?: boolean;
  /** V24 BOUNTY (PKO / mystery): share of the prize pool sitting in bounties
   *  (0 = not a bounty event). A bounty is equity you collect by ELIMINATING
   *  someone, so it pays to play pots against players you cover. */
  bountyFactor?: number;
  /** V24 BOUNTY: hero covers the current raiser, so busting them collects
   *  their bounty and risks none of hero's own. Undefined = unknown. */
  coversRaiser?: boolean;
  /** V24 BOUNTY: the raiser is short enough that this pot can eliminate them
   *  outright (their stack is inside what is already committed + hero's
   *  call). The bounty is not just possible, it is LIVE this hand. */
  raiserBustable?: boolean;
  /** V23 BLIND CLOCK: minutes until the next blind level (undefined = unknown). */
  nextBlindInMin?: number;
  /** V23 BLIND CLOCK: next level's bb over the current bb (1/undefined = flat). */
  nextBlindMult?: number;
  /** V18 STRADDLE: the pot is straddled (2xBB posted blind, no
   *  ActionRecord). The unopened test and open sizing key off the straddle
   *  instead of the big blind. */
  straddled?: boolean;
  /** V18 SQUEEZE: hero opened, a caller came along, then the 3-bet - a
   *  squeeze. Squeeze ranges are polarized toward air, so the opener
   *  4-bets and calls wider. */
  squeezed?: boolean;
  /** V16 PLO POLARITY: hero holds a pair of aces (undefined = layer off).
   *  AAxx 3-bets below the generic percentile bar; a speculative rundown
   *  WITHOUT it flats at the margin instead of bloating the pot OOP. */
  omahaAA?: boolean;
  /** Real-card suited AA / double-suited KK anchor, not a percentile proxy.
   * Only selects value 3-bets versus one open; never a 4-bet stack-off. */
  omahaSuitedPremium?: 'aces' | 'kings';
  /** Dan 2026-11-06: high-only pot-limit Omaha suited aces also 4-bet facing
   *  one 3-bet, and continue when re-raised (see OMAHA_SUITED_ACES_FOUR_BET_MAX_BB).
   *  Undefined or false = off (hold'em, hi-lo, ablation). */
  omahaSuitedAcesFourBet?: boolean;
  /** V86 PLO4/5/6/8 & cross-variant elite preflop overhaul (default false unless supplied). */
  v86PloOverhaul?: boolean;
  /** V86 4/5/6-card + PLO8 elite structural class read. */
  omahaElite?: OmahaEliteClassRead;
  /** V86 deterministic per-Horse PLO 3-bet mix [0.22, 0.85]. */
  ploPersona3BetMix?: number;
  /** V86 deterministic spot hash roll [0, 1) (consumes zero RNG draws). */
  plo3BetRoll?: number;
  /** V86: confirmed IP LAG bully / observed maniac yet to act behind hero's unopened pot. */
  lagBullyIpBehind?: boolean;
  /** V86: observed extreme maniac (re-raising >=25% or opening >=75%) raised or sits behind. */
  observedExtremeManiac?: boolean;
  /** Exact Hold’em AA/KK, so score jitter cannot demote a value squeeze. */
  holdemPremiumPair?: boolean;
  /** Effective stack in big blinds against the deepest live opponent
   *  (2026-10-25 shove discipline). Undefined on legacy/offline callers. */
  effectiveStackBB?: number;
  /** FACING A CLOSED ALL-IN RE-RAISE (2026-11-08): the last raise hero faces
   *  was made all in and every other live opponent is all in too, so a call
   *  closes the betting and risks exactly `toCall`. The stack caps of the
   *  3-bet and 4-bet nodes exist to stop a light call being followed by more
   *  betting; here none can follow, so they do not veto the call and the
   *  price-aware strength bar decides alone. Supplied by HorseLogic from the
   *  public seat flags; never from who anybody is. Absent = legacy caps. */
  facingClosedAllIn?: boolean;
  /** True unless authoritative legalActions explicitly exclude raise and all_in
   *  (e.g. a short all-in raise that did not reopen betting after hero acted). */
  reopenAllowed?: boolean;
  /** Dan 2026-10-25 NLH tournament aggression; undefined = on. */
  tournamentAggression?: boolean;
  /** V74 no-limit open sizes (HorseNlhOpenSize, Dan 2026-10-31); undefined =
   *  on, false = the V28 ladder (the recorded corpora, and every variant that
   *  is not two-card full-deck no-limit hold'em). */
  nlhOpenSizes?: boolean;
  /** V85 (owner direction 2026-11-09): cash opens draw from the 2.5-4.5bb bands. */
  cashActionSizes?: boolean;
  /** Dan 2026-10-24 NLH cash pressure (3-bet and defend wider); undefined = on. */
  cashAggression?: boolean;
  /** Omaha high tournament: the hand's percentile among Omaha hands and,
   *  for league arms only, replacement shares. Undefined = the rule is off. */
  omahaTournamentFirstIn?: { percentile: number; params?: OmahaTournamentFirstInParams };
  /** Receipt callback (#8694): the caller fires the V60 cash pressure receipt
   *  named here when that layer moves a bar. This module has no telemetry. */
  noteLayer?: (layer: PreflopLayerReceipt) => void;
  noteAuthority?: (event: PreflopAuthorityEvent) => void;
  /** Short deck keeps its own calibration; the cash pressure layer skips it. */
  isShortDeck?: boolean;
  /** League calibration arm (2026-10-30): added to the tournament call bar
   *  facing a single open (no callers yet), so the marginal flats become
   *  folds while the 3-bet bar is untouched. Undefined = no change. */
  tournamentFlatBump?: number;
  /**
   * V70 GTO OPENING RANGES (2026-10-31, HorseGtoOpeningRanges): the open
   * decision of an unopened, unlimped no-limit hold'em pot reads the hand on
   * its seat's own reference order. `strength` is that order mapped onto the
   * holdemPreflopScore scale (same jitter as `strength`), `bar` the seat's
   * base open bar, `sbLimpFloor` the small blind's limp floor, `players`
   * behind hero. Undefined = the legacy open (the explicit off arm).
   */
  gtoOpen?: {
    strength: number;
    bar: number;
    sbLimpFloor: number;
    behind: number;
    /** Dedicated opening multiplier; legacy callers retain their style. */
    tightness?: number;
  };
  /**
   * V72 GTO DEFENCE BY OPENER (2026-10-31, HorseGtoDefenceRanges): facing one
   * no-limit hold'em open with nobody in, three or more dealt in. `strength`
   * is the hand on the (defender, opener seat) continue order (jitter as
   * `strength`), `continueBar` the continue bar, `valueBar` the value 3-bet
   * bar on the legacy ladder, `bluffProb` the balanced bluff 3-bet chance,
   * `defender` the defender class. Undefined = the legacy defence.
   */
  gtoDefend?: {
    strength: number;
    continueBar: number;
    valueBar: number;
    bluffProb: number;
    defender: 'bb' | 'sb' | 'ip';
    /** V85: the cash action base, which also answers an open that was called. */
    cashAction?: boolean;
  };
  /**
   * V73 THE OPENER FACING A 3-BET (2026-11-01, HorseGtoVs3BetRanges): hero
   * opened a no-limit hold'em pot, exactly one player re-raised and nobody
   * has called it, three or more dealt in, 25bb+ effective. `strength` is the
   * hand on the opener seat's continue order (jitter as `strength`),
   * `continueBar` the bar for calling or 4-betting, a share of the seat's own
   * open width. Undefined = the legacy fixed bar (the explicit off arm).
   */
  gtoVs3Bet?: { strength: number; continueBar: number };
  /** PRNG supplied by the caller (fast xorshift) */
  rand: () => number;
  /**
   * V34 (2026-09-02): hero is ON THE BUTTON. classifyPosition folds the
   * cutoff and the button into one 'late' bucket, and the two seats opened
   * the same 23% of hands - solver button ranges are nearly twice the
   * cutoff's, because the button is the only seat that never has to worry
   * about a player behind it. Undefined = unknown, treated as the cutoff.
   */
  isButton?: boolean;
  /**
   * V35 (2026-09-02): per-variant bar shifts (HorseVariantProfile). PLO opens
   * and defends wider but 3-bets narrower; 6+ wider still; fixed limit
   * widest. Undefined = hold'em (zero shift), which is also the ablation.
   */
  variantShift?: {
    open: number;
    threeBet: number;
    fourBet: number;
    coldCall: number;
    bbDefend: number;
  };
  /**
   * V46 (2026-09-05): the HAND CLASS shift, same units and same shape as
   * `variantShift`, from HorseHandClasses.handClassRead. V35 says how the
   * GAME plays; this says how THIS SHAPE plays inside it - AAxx double-suited
   * 3-bets, a rundown flats, AAA-x folds. Undefined = hold'em or the flag is
   * off, and every bar below is then byte-identical to V35.
   */
  classShift?: {
    open: number;
    threeBet: number;
    fourBet: number;
    coldCall: number;
    bbDefend: number;
  };
  /** V46: this class flats instead of 3-betting (rundowns, broadway, danglers). */
  classNeverThreeBet?: boolean;
  /** V46: the percentile is lying and the hand is a fold (trips, trash). */
  classFoldAlways?: boolean;
  /**
   * V37 (2026-09-02): satellite state from HorseLogic.satelliteRead.
   * locked = can fold to a seat; urgent = below the seat line with the
   * blinds coming; coversAll = every live opponent is covered by a margin.
   * Undefined = not a satellite (or the layer is ablated).
   */
  satellite?: { locked: boolean; urgent: boolean; coversAll: boolean };
  /** V37: 0..1 — hero covers the field (1) or the raiser (0.6) near an MTT
   *  bubble. Opens widen, 3-bet bluffs against covered raisers multiply. */
  bubblePressure?: number;
  /** V37: hero's OWN head bounty against the field mean (1 = average). A big
   *  head gets called wider — its fold equity is lower, so its bluffs are. */
  ownHeadBounty?: number;
  /**
   * V37 PREFLOP BLOCKERS (Dan 2026-09-02): "BLOCKER LOGIC IN CASH GAMES AND
   * TOURNAMENT PLAY, THAT WASN'T IMPLEMENTED ANYWHERE." Postflop the brain
   * has had nut-flush and top-straight blockers since V3; preflop it chose
   * its 3-bet and 4-bet bluffs by strength alone. An ace in the hand removes
   * half of AA and a quarter of AK from the raiser's continuing range — the
   * exact hands a bluff runs into — so ace-blocker hands are the preferred
   * bluff 3-bets and 4-bets; a king blocks KK/AK a little. In Omaha an ace
   * blocks the AAxx that anchors every PLO 3-bet range.
   */
  holdsAce?: boolean;
  holdsKing?: boolean;
  /**
   * V53 (2026-10-24): Omaha tournament pressure, from
   * HorseOmahaTournamentPressure.omahaTournamentPressure. Per-family strength
   * shifts priced by the modeled ICM cost of what each action puts at risk in
   * pot limit, compressed for the variant's equity spread and faded by M.
   * Present only in PLO4/5/6 tournaments with the v53PloTourneyIcm flag on;
   * where it is present, the bars it names drop the flat `riskAdd` premium
   * and take this shift instead. Undefined = every bar is exactly what it was.
   */
  ploIcm?: OmahaPressureShifts;
  /** Wave 1+2 unblocked preflop upgrades (default true when undefined; false only for Oct 16 corpus replay). */
  v86MultiStreetUnblocked?: boolean;
  v86UnblockedPreflop?: boolean;
  /** Hero's own prior voluntary action earlier in this preflop orbit. */
  heroPriorAction?: HeroPriorPreflopAction | 'all_in';
  /** Full-raise count excluding sub-min incomplete short-stack all-ins. */
  effectiveRaises?: number;
  /** True when the pot has an active Kill / Half-Kill blind with zero raises so far. */
  killPotUnopened?: boolean;
  /** True when the 3-bet hero faces was already cold-called by another player. */
  facingColdCalledThreeBet?: boolean;
  /** True when hero is BB/straddler/killer checking an unraised live option. */
  isOptionCheckAvailable?: boolean;
  /** Cash NLH 7-2 side-game playability shift (moves open/call bars only, never sizing). */
  sevenDeuceBonus?: number;
  /** PLO5/PLO6 bare single-suited/rainbow AA with disconnected low side cards <= 9. */
  omahaBareAcesDeep?: boolean;
  /** Number of Ace-high suited flush draws in PLO4/5/6. */
  omahaNutSuits?: number;
  /** True in PLO6 when hero holds 2-2-2 triple-suited structure. */
  omahaTripleSuited?: boolean;
  /** Count of redundant suit cards (>= 3 of one suit) self-blocking flush outs. */
  omahaSuitWaste?: number;
  /** Asymmetric ICM cover leverage (-1..+1): >0 when hero covers bubble/cliff stacks, <0 when covered. */
  coverBubblePressure?: number;
  /** Chip-equivalent PKO/KO/Mystery bounty pot overlay in BB units when hero covers raiser. */
  bountyOverlayBB?: number;
  /** V87 Hold'em Cash & Tournament Elite Strategy Overhaul (2026-11-10); default true. */
  v87HoldemOverhaul?: boolean;
  /** Hero's hole cards when supplied by the brain (card-exact EP trap & reshove wedges). */
  holeCards?: readonly Card[];
  /** Hero's seat index and dealer seat for pure zero-RNG deterministic mixes. */
  heroSeat?: number;
  dealerSeat?: number;
  /** True when hero already acted voluntarily earlier on this preflop street. */
  heroPreviouslyActed?: boolean;
  /** True when hero made the first open-raise on this preflop street. */
  heroWasInitialRaiser?: boolean;
  /** True when a straddle is posted on this hand (even after raises). */
  straddleActive?: boolean;
  /** True when `effectiveStackBB` was already normalized into straddle units by the caller. */
  effectiveStackNormalized?: boolean;
  /** Exact posted straddle size in table chips/Diamonds when `straddleActive` is true. */
  straddleUnitCoins?: number;
  /** Cash big blind normalized to dollar-equivalent chip units (`bb / 100` on Diamond cash tables). */
  cashStakeBB?: number;
  /** True when the last preflop raiser is already all-in (no further fold equity against them). */
  raiserIsAllIn?: boolean;
  /** True when every opponent still in the hand is all in: no raise can make
   *  anyone fold. False or absent when any live opponent still has chips, so
   *  an isolation raise over a short all-in keeps its fold equity against the
   *  players behind. Supplied by HorseLogic from the public seat flags. */
  everyOpponentAllIn?: boolean;
  /** V87 (2026-11-10): all-hands deep-dive Omaha selectivity and pricedIn trash floor. */
  v87DeepDiveDiscipline?: boolean;
  /** V87: Omaha hole-card count (4, 5, or 6) when `isOmaha === true`. */
  omahaHoleCount?: number;
  /** V87: true on Hi-Lo split variants (PLO8/FLO8), excluded from V87 Omaha rules. */
  omahaHiLo?: boolean;
  /** V87: true when the preflop raiser has a non-presumed wide/maniac read. */
  evidencedWideRaiser?: boolean;
}

const V87_PAIR_SUIT_PAIRS = ['cd', 'ch', 'cs', 'dh', 'ds', 'hs'] as const;
const V87_SUITS = ['c', 'd', 'h', 's'] as const;
const V87_SC_CLASSES = ['54s', '65s', '76s', '87s', '98s', 'T9s'] as const;

const V87_FOUR_BET_VALUE_SHOVE_CLASSES = new Set<string>([
  '77',
  '88',
  '99',
  'TT',
  'JJ',
  'QQ',
  'KK',
  'AA',
  'ATs',
  'AJs',
  'AQs',
  'AKs',
  'AKo',
  'KQs',
]);
const V87_FOUR_BET_BLUFF_SHOVE_CLASSES = new Set<string>(['A5s', 'A4s', 'A3s', 'A2s']);

const V87_TOURNEY_RESHOVE_VS_LATE = new Set<string>([
  '22',
  '33',
  '44',
  '55',
  '66',
  '77',
  '88',
  '99',
  'TT',
  'JJ',
  'QQ',
  'KK',
  'AA',
  'A2s',
  'A3s',
  'A4s',
  'A5s',
  'ATs',
  'AJs',
  'AQs',
  'AKs',
  'AKo',
  'AQo',
  'KQs',
  'QJs',
]);
const V87_TOURNEY_RESHOVE_VS_MIDDLE = new Set<string>([
  '55',
  '66',
  '77',
  '88',
  '99',
  'TT',
  'JJ',
  'QQ',
  'KK',
  'AA',
  'A4s',
  'A5s',
  'ATs',
  'AJs',
  'AQs',
  'AKs',
  'AKo',
  'AQo',
  'KQs',
]);

function v87Fmix32(h: number): number {
  let x = h >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

function v87StateHashU(ctx: PreflopCtx, salt: number): number {
  const bb = ctx.bigBlind > 0 ? ctx.bigBlind : 1;
  const seat = (ctx.heroSeat ?? 0) | 0;
  const dealer = (ctx.dealerSeat ?? 0) | 0;
  const stackUnits = Math.round(((ctx.stack ?? 0) / bb) * 4) | 0;
  const potUnits = Math.round(((ctx.pot ?? 0) / bb) * 4) | 0;
  const tableSize = (ctx.tableSize ?? Math.max(2, ctx.oppsLeft + 1)) | 0;
  let h = (salt ^ 0x9e3779b9) >>> 0;
  for (const v of [seat, dealer, stackUnits, potUnits, tableSize]) {
    h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
  }
  return v87Fmix32(h);
}

/**
 * Stratified 1D lattice rotation over exact two-card combos + public table
 * state. Consumes zero PRNG draws (`rand()` untouched), achieves exact
 * marginal uniformity across table states for any single combo, and achieves
 * near-zero-variance combo balance at any single fixed table state.
 */
function v87EpCandidateMixU(ctx: PreflopCtx, kind: HoldemEpLimpKind, salt: number): number {
  const cards = ctx.holeCards;
  const baseU = v87StateHashU(ctx, salt);
  if (!cards || cards.length !== 2) return baseU;
  const [c1, c2] = cards;
  const s1 = String(c1.suit)[0] ?? 'c';
  const s2 = String(c2.suit)[0] ?? 'd';
  if (kind === 'big_pair_trap') {
    const rankIdx = c1.rank === 'Q' ? 0 : c1.rank === 'K' ? 1 : 2;
    const sLo = s1 < s2 ? s1 : s2;
    const sHi = s1 < s2 ? s2 : s1;
    const spIdx = Math.max(
      0,
      V87_PAIR_SUIT_PAIRS.indexOf(`${sLo}${sHi}` as (typeof V87_PAIR_SUIT_PAIRS)[number])
    );
    const comboIdx = spIdx * 3 + rankIdx;
    return (comboIdx / 18 + baseU) % 1;
  }
  const cls = holdemClass(c1, c2) ?? '54s';
  const scIdx = Math.max(0, V87_SC_CLASSES.indexOf(cls as (typeof V87_SC_CLASSES)[number]));
  const suitIdx = Math.max(0, V87_SUITS.indexOf(s1 as (typeof V87_SUITS)[number]));
  const comboIdx = suitIdx * 6 + scIdx;
  return (comboIdx / 24 + baseU) % 1;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Open-raise strength floors by position (percentile space). */
/** No stack deeper than this plays jam-or-fold, however burnt its M is.
 *  Matches the cap the V20 reshove branches already use. */
/** AoF shove bar tightens above the depth where push/fold is already tuned. */
/**
 * A BLUFF RAISE NEEDS SOMEONE WHO CAN FOLD (2026-11-12, HVH2D-TRN-001 row 8).
 * A bluff 3-bet or squeeze is chosen for its fold equity. It has none when
 * the price to call is already the hero's whole stack (the "raise" is only a
 * call), or when every opponent still in the hand is all in (the hand is
 * shown down against all of them whatever the hero does). It keeps it when
 * any opponent still has chips: raising over a short all-in to fold the
 * players behind, or to build a side pot against a caller, is unchanged.
 * KJo called off 59 big blinds through the bluff branch against a player who
 * was all in for more than its stack.
 */
export function bluffRaiseCanFoldSomeone(
  toCall: number,
  stack: number,
  everyOpponentAllIn: boolean | undefined
): boolean {
  return toCall < stack && everyOpponentAllIn !== true;
}

/**
 * EVIDENCE ONLY (2026-11-12). The same test, with a receipt when it refuses.
 * It is the last condition of the squeeze bluff and the 3-bet bluff, so it is
 * reached only when every earlier condition held and the draw passed: a
 * refusal here is a bluff raise that would have been made and was stopped
 * because nobody could fold. The answer is bluffRaiseCanFoldSomeone's own,
 * and no random number is drawn here.
 */
function bluffRaiseHasFoldEquity(toCall: number, stack: number, ctx: PreflopCtx): boolean {
  const canFoldSomeone = bluffRaiseCanFoldSomeone(toCall, stack, ctx.everyOpponentAllIn);
  if (!canFoldSomeone) ctx.noteLayer?.('bluff_raise_refused_no_fold_equity_seen');
  return canFoldSomeone;
}

const AOF_TIGHTEN_PER_BB = 0.006;
const AOF_MAX_TIGHTEN = 0.3;

const PUSH_FOLD_MAX_BB = 22;
/** V70: two- and three-handed, the deepest folded-to stack that plays
 *  jam-or-fold (the push/fold charts' authority, GtoCharts). */
const V70_SHORT_HANDED_JAM_MAX_BB = 15;

/**
 * ═══ V34 (2026-09-02): THE SCALE IS NOT A PERCENTILE, SO READ THE TABLE ═══
 *
 * holdemPreflopScore is a hand-tuned ladder, and every other variant is mapped
 * ONTO it by quantile (HorseEval), so one number means the same hand rank in
 * every game — but the number is not "top X%". Measured over all 1,326
 * two-card combos, the share of hands AT OR ABOVE a bar is:
 *
 *     bar   0.62  0.58  0.55  0.52  0.48  0.46  0.42  0.40  0.34  0.30  0.27  0.24
 *     top   12%   13%   16%   18%   20%   21%   23%   25%   35%   39%   42%   48%
 *
 * Read against that table, the old opens were: UTG 12%, HJ 17%, CO 23% and
 * the BUTTON also 23% - the fleet opened the button like a cutoff and folded
 * it 77% of the time, while a 6-max solver opens the button ~45%. The blinds
 * then over-folded the steals nobody was making. Every bar below is now
 * chosen FROM the table against a solver target, and the button is its own
 * seat (PreflopCtx.isButton) instead of a second cutoff.
 *
 * Targets (6-max, 100bb, chip EV):  UTG ~15%, HJ ~20%, CO ~26%, BTN ~42%,
 * SB (folded to) ~40% raise plus a limp mix.  Full ring tightens UTG below
 * (see the tableSize adjustment where the bar is applied).
 */
/**
 * ═══ PLO PREFLOP SIZING IS POT-LIMIT SIZING (Dan, 2026-09-03, binding) ═══
 *
 * Dan: "horses min-raising in PLO is unacceptable ... a min-raise is NOT the
 * standard PLO opening raise." Measured against production on 2026-09-02 over
 * 40,232 PLO opens: the average open was 2.62x BB, 37.4% of opens were at or
 * under 2x BB, and only 11.7% were pot or bigger. The same day's NLH opens
 * averaged 2.87x with 26.8% min-raises - the POT-LIMIT games were opening
 * SMALLER than the no-limit game, which is backwards, and 786 of the 825
 * horses with five or more PLO opens did it. One shared code path, not a
 * persona dial.
 *
 * The path was the V28 open-size ladder below: `2.2 + rand()*0.8` big blinds,
 * trimmed to 2.05-2.40 with an ante and 2.0-2.4 at 25bb or less (its own
 * comment says "min-raise territory"), then multiplied by the persona's
 * sizingMultiplier, whose base runs down to 0.88 before style modifiers. That
 * is a no-limit ladder, and nothing in it had ever asked what betting
 * structure the game was played under. A 2x PLO open gives everyone behind an
 * unfoldable price, guarantees a multiway pot, and buys no fold equity.
 *
 * A pot-sized raise is the standard open, the standard 3-bet and the standard
 * 4-bet in Omaha, so under pot limit the CEILING is the target. The size comes
 * from `potLimitRaiseTo` - the engine's own pot-limit formula read off the
 * live pot - so it stays correct with antes, straddles, dead blinds and
 * limpers instead of being a multiple of the big blind that happens to be
 * right at 1/2 six-handed and wrong everywhere else.
 */

/**
 * The floor for a PLO OPEN, in big blinds (in a straddled pot, in straddles -
 * the unit the open is sized off). Dan: a min-raise open must be unreachable,
 * not merely rare. Nothing below this reaches the felt except the pot-limit
 * ceiling itself and an all-in for less, both of which are the largest legal
 * wager available.
 */
/** FACING A CLOSED ALL-IN RE-RAISE (2026-11-08): the stack caps of the 3-bet
 * and 4-bet nodes stop vetoing a call that closes an all-in only up to this
 * effective depth. The measured defect was 12-25bb (tournament openers folding
 * 89-95% to all-in 3-bets); deeper, the 35% cap is what keeps a style from
 * stacking off light (independent review of #10095: without it LAG calls a
 * 200bb jam with KQs, ATs, 99 and AQo), so it stays. */
export const CLOSED_ALL_IN_MAX_EFFECTIVE_BB = 40;
export const PLO_MIN_OPEN_BB = 3;

/**
 * How far below the pot a persona's sizing dial may shade a pot-limit raise.
 * Pot is correct; a shade under it exists only so the fleet is not sizing
 * every raise to the same cent, which is itself a tell. At 0.92 the band runs
 * 3.22-3.50bb for a first-in open from a non-blind seat, which sits inside
 * the 3.2-3.5x average Dan asked for; the floor above is the hard guarantee
 * underneath it, not the operating point, and it binds only where the pot is
 * genuinely smaller (the small blind, where a pot raise IS 3x).
 */
export const PLO_SIZE_MIN_FRACTION = 0.92;

/**
 * Size a pot-limit preflop raise. `potTo` is the pot-limit ceiling from
 * `potLimitRaiseTo`; `floorTo` is an absolute floor (the open floor above, or
 * 0 for a re-raise, where the min-raise rules already bind well above a
 * min-open). The result never exceeds the ceiling, so when the ceiling is
 * itself below the floor - a stack shorter than one pot raise - the largest
 * legal wager wins and `legalize` turns it into the all-in it is.
 */
export function ploRaiseTo(
  sizingMultiplier: number,
  potTo: number,
  rand: () => number,
  floorTo = 0
): number {
  const shade = Math.max(PLO_SIZE_MIN_FRACTION, Math.min(1, sizingMultiplier));
  const frac = shade + rand() * (1 - shade);
  return Math.min(potTo, Math.max(potTo * frac, floorTo));
}

const OPEN_THRESH: Record<PreflopPosition, number> = {
  early: 0.56, // ~15% (was 0.62 = 12%)
  middle: 0.48, // ~20% (was 0.54 = 17%)
  late: 0.4, // cutoff ~25% (was 0.42 = 23%); the button is set separately
  sb: 0.44, // V7: SB opens wider than V2's 0.50 — folds win the BB outright
  bb: 0.42,
};
/** V34: the button opens ~42% of hands (bar 0.27 on the table above). */
const OPEN_THRESH_BUTTON = 0.27;

/**
 * How wide the 3-bet gets against an open from each position. Late opens are
 * wide, so the re-raise gets wide; early opens are strong, so it stays tight.
 */
const THREEBET_VS: Record<PreflopPosition, number> = {
  early: 0.86,
  middle: 0.8,
  late: 0.74,
  sb: 0.72, // BB re-stealing vs a wide SB open
  bb: 0.8,
};

/** Cold-call floors vs an open from each position. */
const CALL_VS: Record<PreflopPosition, number> = {
  early: 0.58,
  middle: 0.54,
  late: 0.5,
  sb: 0.46,
  bb: 0.54,
};

/**
 * The floor for limping BEHIND another limper, set at the single-raise
 * calling threshold on purpose: a hand that cannot call a raise has no
 * business putting a chip in, because the only thing it can do next is fold.
 * See the no-open-limp note in the unopened branch.
 */
const LIMP_BEHIND_MIN = 0.5;

/**
 * V74: the bluff budget (bluffFreq x aggression) of a balanced horse with no
 * survival premium. A style's V74 bluff 3-bet frequency is the reference
 * chart's scaled by its own budget over this one.
 */
const BALANCED_BLUFF_BUDGET = 0.17;

/**
 * ── V13 (2026-08-23): THE PRICE-IN GUARD WAS EATING EVERY RAISE ────────────
 *
 * V11 added a guard so a horse can NEVER fold when the pot lays a price any
 * two cards beat. Its comment says exactly that — "before any strength
 * threshold can FOLD" — but it was written as `if (pricedIn) return call`,
 * placed above every branch in the function. A guard against folding became a
 * guard against acting.
 *
 * What that cost, at 1/2 with the pot including the live bet (it does):
 *   - BTN behind 3 limpers (pot 9, toCall 2, odds 0.182) -> forced CALL.
 *     The button limps behind with aces.
 *   - BB facing an open to 4 with three callers (pot 19, toCall 2, odds
 *     0.095) -> forced CALL. The single most profitable squeeze node in the
 *     game, hard-coded to a flat.
 *   - SB with one limper (odds 0.167) -> forced CALL.
 * It also pre-empted the push/fold block, so a <=12bb stack that should jam
 * called instead and surrendered all its fold equity, and it pre-empted the
 * whole unopened branch, which is where the V10 limp-isolation layer lives —
 * making that layer unreachable in exactly the multiway limped pots it was
 * built to attack.
 *
 * The fix restores the stated intent: compute the decision normally, then
 * substitute a call for a FOLD when the price forbids folding. Nothing else
 * about the guard changes.
 */
function preflopCallOdds(ctx: PreflopCtx, pot: number, call: number): number {
  const deduction =
    ctx.mode === 'cash' && Number.isFinite(ctx.callDeductionFraction)
      ? Math.max(0, Math.min(1, ctx.callDeductionFraction!))
      : 0;
  return call / Math.max(1e-9, (pot + call) * (1 - deduction));
}

/**
 * V77: how much the push/fold jam bar rises for an opener whose V70 open
 * width is `widthPct` (percent of 1,326). Zero at the 40% late reference,
 * 0.3 per unit of missing width, capped at 0.10 (~ a 10-12% early seat).
 */
export function v77JamSeatTighten(widthPct: number): number {
  return Math.min(0.1, Math.max(0, (0.4 - widthPct / 100) * 0.3));
}

export function decidePreflopV7(ctx: PreflopCtx): PreflopIntent {
  // ═══ V46 (2026-09-05) ═══ THE PERCENTILE IS LYING. Three or four of a rank
  // in an Omaha hand (AAA-x above all) rates high on the hold'em ladder and
  // is close to unplayable: the third card of the rank is dead, and the hand
  // makes one pair with no redraw. Same for a double-paired low rainbow hand.
  // No bar can express "the number you are reading is wrong", so this is a
  // gate in front of the bars, not another shift.
  //
  // A free look is still free: with nothing to call, checking the big blind
  // is not a decision anybody can exploit.
  if (ctx.classFoldAlways === true && ctx.toCall > 0) {
    return { a: 'fold' };
  }
  const out = completePreflopCommitment(decidePreflopV7Core(ctx), ctx);
  // ═══ OMAHA TOURNAMENT SHORT-HANDED FIRST-IN (Dan 2026-11-12) ═══
  // The commitment zone's unopened stack-off bar has no heads-up or
  // blind-versus-blind case, so short-handed the table walks the big blind.
  // HorseOmahaTournamentFirstIn.ts replaces the FOLD, and only the fold, in
  // the measured short-handed spots (see its header for the cause and limits).
  if (
    out.a === 'fold' &&
    ctx.omahaTournamentFirstIn !== undefined &&
    ctx.isOmaha &&
    !ctx.omahaHiLo &&
    ctx.mode === 'tournament'
  ) {
    const widened = omahaTournamentFirstIn(
      {
        percentile: ctx.omahaTournamentFirstIn.percentile,
        position: ctx.position,
        liveOpponents: ctx.oppsLeft,
        // Unknown table size (a league ablation arm only) must not read as
        // heads-up: NaN makes the rule stand aside.
        tableSize: ctx.tableSize ?? Number.NaN,
        effectiveStackBB: ctx.effectiveStackBB ?? ctx.stackBB,
        raises: ctx.raises,
        limpers: ctx.limpers,
        callers: ctx.callers,
        toCall: ctx.toCall,
        stack: ctx.stack,
        pot: ctx.pot,
        riskPremium: ctx.riskAdd,
        allInOrFold: ctx.allInOrFold === true,
        satelliteLocked: ctx.satellite?.locked === true,
      },
      ctx.omahaTournamentFirstIn.params
    );
    if (widened) {
      ctx.noteLayer?.('omaha_tournament_first_in');
      return widened;
    }
  }
  if (ctx.v13 === false) return out;
  if (out.a !== 'fold') return out;
  const stack = ctx.stack;
  const bb = ctx.bigBlind > 0 ? ctx.bigBlind : 1;
  const toCall = ctx.toCall;
  const effCall = Math.min(toCall, stack);
  if (effCall <= 0) return out;
  const pricePot = Number.isFinite(ctx.contestablePot)
    ? Math.max(0, ctx.contestablePot as number)
    : ctx.pot;
  const guardOdds = preflopCallOdds(ctx, pricePot, effCall);
  const isTourney = ctx.mode === 'tournament';
  const stackBB = stack / bb;
  const pricedIn =
    ctx.mode !== undefined &&
    (guardOdds <= 0.15 ||
      (effCall <= bb && guardOdds <= 0.22) ||
      (isTourney && stackBB <= 2 && guardOdds <= 0.34));
  if (!pricedIn) return out;

  // A generic any-two shortcut is not valid against multiple strong ranges.
  // The explicit Phase 6 multiway-all-in node owns this call-off, and its
  // fold may never be rewritten into a call by the legacy heads-up guard.
  if (ctx.phase6?.policy.branch === 'multiway_all_in') return out;

  // ── THE PRICE IS ONLY REAL WHEN THE CALL CLOSES THE ACTION ──────────────
  //
  // (Dan 2026-08-30.) V13 stopped this guard from eating raises. It went on
  // eating FOLDS in unopened pots, and with a big blind ante that is every
  // fold, because the ante alone makes the price look irresistible:
  //
  //     hand #3761806, blinds 75/150, big blind ante 1,200
  //     pot before the action 1,425, toCall 150
  //     guardOdds = 150 / (1425 + 150) = 0.095  ->  <= 0.15, priced in
  //
  // So every hand the range wanted to fold called instead. Six seats limped,
  // the big blind raised to 1,125, and five of the six folded. Measured over
  // 596 tournament hands: 852 open-limps against 214 open-raises (35% of all
  // unraised first actions), and of the 458 limps that later faced a raise,
  // 419 FOLDED - 91.5%.
  //
  // The arithmetic is not wrong, the premise is. Pot odds justify a call
  // when calling CLOSES the action. In an unopened pot it never does: the
  // big blind still has the option and everyone behind can raise, so the
  // horse is not being laid 9.5% on a showdown, it is paying to enter a pot
  // it will be blown out of. That is why the same guard is harmless in cash
  // (no ante: pot 1.5bb, toCall 1bb, odds 0.4 - never triggers) and ruinous
  // in an ante tournament.
  //
  // The one survivor is the call that ends the decision anyway: if calling
  // puts the stack in, there is no later fold to regret and no limp to
  // punish. That keeps the desperate <=2bb case the guard was widened for.
  const unblocked86 = ctx.v86MultiStreetUnblocked !== false && ctx.v86UnblockedPreflop !== false;
  const effRaisesForGuard =
    unblocked86 && typeof ctx.effectiveRaises === 'number' ? ctx.effectiveRaises : ctx.raises;
  const blindMoneyUnopenedForGuard =
    unblocked86 &&
    (((ctx.straddled === true || ctx.killPotUnopened === true) &&
      (typeof ctx.effectiveRaises === 'number' || ctx.currentBet <= bb * 8.5)) ||
      ctx.effectiveRaises === 0);
  const unopenedForGuard =
    effRaisesForGuard === 0 && (ctx.currentBet <= bb * 1.05 || blindMoneyUnopenedForGuard);
  const callIsAllIn = effCall >= stack * 0.99;
  if (unopenedForGuard && !callIsAllIn) return out;
  const effectiveStackBBForGuard = ctx.effectiveStackBB ?? stackBB;
  if (
    ctx.v87HoldemOverhaul !== false &&
    !ctx.isOmaha &&
    ctx.isFixedLimit !== true &&
    ctx.isShortDeck !== true &&
    ctx.anteInPlay === true &&
    toCall >= bb &&
    effectiveStackBBForGuard >= 14 &&
    ctx.raises >= 1 &&
    !callIsAllIn &&
    ctx.strength < 0.26
  ) {
    return out;
  }
  if (ctx.v87DeepDiveDiscipline === true && !callIsAllIn) {
    const minStr87 = v87PricedInMinStrength({
      isTourney,
      isOmaha: ctx.isOmaha === true,
      isHiLo: ctx.omahaHiLo === true,
      omahaHoleCount: ctx.omahaHoleCount,
      callers: ctx.callers,
      guardOdds,
      evidencedManiacRaiser: ctx.evidencedWideRaiser === true,
    });
    noteHorseDeepDiveRule('priced_in_floor', minStr87 > 0, minStr87 > 0 && ctx.strength < minStr87);
    if (minStr87 > 0 && ctx.strength < minStr87) {
      ctx.noteLayer?.('v87_deep_dive_discipline');
      return out;
    }
  }
  // The receipt says which band decided; the priced-in call still came from it.
  return out.receipt ? { a: 'call', receipt: out.receipt } : { a: 'call' };
}

function decidePreflopV7Core(ctx: PreflopCtx): PreflopIntent {
  const unblocked86 = ctx.v86MultiStreetUnblocked !== false && ctx.v86UnblockedPreflop !== false;
  const {
    strength: raw,
    position,
    raiserPosition,
    limpers,
    callers,
    toCall,
    currentBet,
    pot,
    bigBlind: bb,
    stack,
    stackBB,
    rand,
  } = ctx;
  const raises =
    unblocked86 && typeof ctx.effectiveRaises === 'number' ? ctx.effectiveRaises : ctx.raises;
  const pricePot = Number.isFinite(ctx.contestablePot)
    ? Math.max(0, ctx.contestablePot as number)
    : pot;

  // ═══ V24 ICM IS ABOUT RISKING A LIFE, NOT A BLIND (Dan 2026-08-28) ═══════
  // "I full potted 8 hands in a row and never got called once."
  //
  // riskAdd is the survival premium, and it was added to EVERY threshold at
  // full strength no matter how little the decision risked. Near the money it
  // reaches 0.12, which pushed the PLO call bar to t(0.54)+0.12 ~= 0.70: a
  // horse folded 70% of hands rather than call 3.5bb of a 100bb stack getting
  // better than 3:1. That is not ICM, it is a bug wearing ICM's name.
  //
  // ICM prices the chance of BUSTING. A call worth 3% of a stack cannot bust
  // anybody, so it earns almost none of the premium; a call that puts the
  // stack in earns all of it. Scaling by the fraction at risk is the whole
  // fix, and it leaves every jam/stack-off threshold exactly where it was
  // (those risk everything, so the multiplier is 1).
  const atRisk = stack > 0 ? Math.min(1, Math.max(0, toCall) / stack) : 1;
  // Square-root so meaningful-but-not-fatal prices still carry real weight:
  // 4% of stack -> 20% of the premium, 25% -> 50%, all-in -> 100%.
  // V28 AUDIT FIX: gate the sqrt price-scaling on the variant actually being
  // Omaha. The flag is named ploPriceDefense and was wired from v24PloDefense
  // with no isOmaha guard, so ablating "PLO price defense" silently moved
  // every NLH cold-call threshold too — no A/B of V24 measured what its name
  // says.
  const riskScaled =
    ctx.ploPriceDefense === true && ctx.isOmaha ? ctx.riskAdd * Math.sqrt(atRisk) : ctx.riskAdd;
  // Thresholds that decide whether to COMMIT keep the full premium; the
  // price-scaled one is for calls that merely continue.
  //
  // V28 AUDIT FIX: cap the bar at 0.965. clamp01 alone let a tight style push
  // a bar to exactly 1.0 — holdemPreflopScore tops out at 1.0 for AA, so a
  // grinder (tightness 1.12) could NEVER value-4-bet KK (0.98) or AKs (0.96),
  // and 4-bet AA only when the ±0.03 jitter landed high. A bar above the best
  // achievable hand is not "tight", it is a dead branch.
  const BAR_CAP = 0.965;
  const capBar = (x: number) => Math.min(BAR_CAP, clamp01(x));
  const t = (x: number) => capBar(x * ctx.tightness + ctx.riskAdd);
  const tCall = (x: number) => capBar(x * ctx.tightness + riskScaled);
  // V53: a bar priced by the action's own ICM cost instead of the flat
  // premium. Absent the read, exactly t() / tCall().
  const ploIcm = ctx.ploIcm;
  const t53 = (x: number, family: keyof OmahaPressureShifts): number =>
    ploIcm ? capBar(x * ctx.tightness + ploIcm[family]) : t(x);
  // No-limit hold'em only: the closed all-in exception and the 4-bet-node
  // tightness clamp were measured there and nowhere else.
  const noLimitHoldem = !ctx.isOmaha && ctx.isFixedLimit !== true && ctx.isShortDeck !== true;
  const v87 = ctx.v87HoldemOverhaul !== false;
  const v87HoleClass =
    v87 && ctx.holeCards && ctx.holeCards.length === 2
      ? holdemClass(ctx.holeCards[0], ctx.holeCards[1])
      : null;
  const v87EpCand =
    v87 && ctx.holeCards && ctx.holeCards.length === 2
      ? classifyHoldemEpLimpCandidate(ctx.holeCards[0], ctx.holeCards[1])
      : null;
  const straddleActiveCash =
    v87 && ctx.mode === 'cash' && (ctx.straddleActive === true || ctx.straddled === true);
  const straddleUnitCoins = straddleActiveCash
    ? ctx.straddleUnitCoins && ctx.straddleUnitCoins > bb * 1.05
      ? ctx.straddleUnitCoins
      : raises === 0 && currentBet > bb * 1.05
        ? currentBet
        : bb * 2
    : bb;
  const straddleRatio = bb > 0 ? straddleUnitCoins / bb : 1;
  const straddleEffectiveBB = straddleActiveCash
    ? ctx.effectiveStackNormalized === true && ctx.effectiveStackBB !== undefined
      ? ctx.effectiveStackBB
      : (ctx.effectiveStackBB ?? stackBB) / straddleRatio
    : (ctx.effectiveStackBB ?? stackBB);
  const closedAllInCall =
    ctx.facingClosedAllIn === true &&
    (noLimitHoldem || (unblocked86 && ctx.isOmaha)) &&
    (ctx.effectiveStackBB ?? Infinity) <= CLOSED_ALL_IN_MAX_EFFECTIVE_BB;
  const tCall53 = (x: number): number =>
    ploIcm ? capBar(x * ctx.tightness + ploIcm.call) : tCall(x);
  // V35: the game's own width. Zero for hold'em and for every ablation.
  const base35 = ctx.variantShift ?? { open: 0, threeBet: 0, fourBet: 0, coldCall: 0, bbDefend: 0 };
  // V46: the class shift rides on top of the variant shift, in the same
  // units, so every bar that already respects the game respects the shape.
  const cs46 = ctx.classShift;
  const vs35 = cs46
    ? {
        open: base35.open + cs46.open,
        threeBet: base35.threeBet + cs46.threeBet,
        fourBet: base35.fourBet + cs46.fourBet,
        coldCall: base35.coldCall + cs46.coldCall,
        bbDefend: base35.bbDefend + cs46.bbDefend,
      }
    : base35;
  const strength = raw;
  const phase6Shift = (key: keyof TournamentPreflopPolicy['shifts']): number =>
    ctx.phase6?.policy.shifts[key] ?? 0;
  // Preserve the established cash/legacy thresholds byte-for-behavior. Only
  // Phase 6 cells need a final cap after their additive atlas movement, so a
  // positive shift cannot create an unreachable (> strongest-hand) branch.
  const phase6CapBar = (x: number): number => (ctx.phase6 ? capBar(x) : x);
  // V37: a big bounty on hero's own head gets called wider, so every bluff
  // (3-bet, squeeze, 4-bet) buys less fold equity — trim the budget.
  const ownHead = Math.max(0, Math.min(3, ctx.ownHeadBounty ?? 1));
  const headTrim = ownHead > 1.5 ? Math.max(0.7, 1 - (ownHead - 1.5) * 0.2) : 1;
  const bluffBudget =
    ctx.bluffFreq *
    ctx.aggression *
    Math.max(0.4, 1 - 4 * (ploIcm ? ploIcm.bluffRisk : ctx.riskAdd)) *
    headTrim;
  // V37 blockers: an ace blocks the top of every continuing range; a king a
  // little. Applied to every bluff raise below (3-bet, squeeze, 4-bet).
  const blockerMult = ctx.holdsAce === true ? 1.3 : ctx.holdsKing === true ? 1.12 : 1;

  // ── V11 GAME MODE (Dan 2026-08-22) ──────────────────────────────────────
  const isTourney = ctx.mode === 'tournament';
  // Antes (tournaments, and any ante cash game) put dead money in every pot:
  // every open, steal, and jam range widens. Solver ante adjustments run
  // ~4-6 percentile points of extra width.
  // V12: spins stack a second widen on top — 3-max hypers play far wider
  // than full-ring MTT ranges at every stack depth. The widen is a function
  // of the STRUCTURE (three seats, shallow, 3-minute levels), which every
  // tier shares; the payout ladder above 10x arrives instead through
  // `ctx.riskAdd`, which tightens `t()` and shrinks `bluffBudget` above.
  const anteWiden = (ctx.anteInPlay ? 0.05 : 0) + (ctx.format === 'spin' ? 0.05 : 0);
  // ═══ TOURNAMENT AGGRESSION (Dan 2026-10-25) ═══════════════════════════
  // Real players called the tournament horses "the most passive scared
  // players they have ever played with". Measured over 48 hours of
  // human-seated NLH tournament hands: horses folded to a single open 82%
  // of the time (humans 52%), 3-bet 5.5% (humans 11.5%), folded to a 3-bet
  // 62%, the small blind folded 88-91% to an open and a <=25bb big blind
  // folded 53%. Every one of those is a stop sign for anyone who raises.
  // NLH tournaments only; Omaha and all-in-or-fold tables have their own
  // calibrations. The ICM premium (riskAdd) is untouched, so the bubble
  // still tightens exactly as before - this moves the baseline, not the
  // survival pressure.
  const v86 = ctx.v86PloOverhaul === true;
  const tAggro =
    ctx.tournamentAggression !== false && isTourney && !ctx.isOmaha && ctx.allInOrFold !== true;
  const tAggroPlo =
    v86 &&
    ctx.tournamentAggression !== false &&
    isTourney &&
    ctx.isOmaha &&
    ctx.allInOrFold !== true;
  // CASH PRESSURE (Dan 2026-10-24: "3BET AGGRESSIVE HUMANS MORE IN POSITION",
  // "MAKE THESE HORSES KILLERS ... cash and tournament play alike"). Measured
  // on 4 days of human-seated NLH cash hands (2026-10-26..29): facing a
  // single open the horses folded 78.6%, called 17.0% and 3-bet 4.4%
  // (humans 32.7 / 57.7 / 9.7); after opening they folded 61.8% to a 3-bet
  // (humans 32.0%). The tournament layer above moved those numbers in
  // tournaments only; this is the no-limit hold'em CASH counterpart, scoped
  // the same way (not Omaha, not all-in-or-fold, not pot limit). Heads-up
  // tables keep their own V11 defence.
  const cAggro =
    ctx.cashAggression !== false &&
    ctx.mode === 'cash' &&
    !ctx.isOmaha &&
    ctx.isShortDeck !== true &&
    !ctx.isPotLimit &&
    ctx.allInOrFold !== true;
  // True heads-up: exactly one live opponent and hero is in a blind. HU is a
  // different game — the SB/BTN opens ~75-85% and the BB defends the wide
  // majority of hands against it.
  // V28 AUDIT FIX (2026-08-29): `oppsLeft === 1` is NOT heads-up. In a full
  // ring where UTG opens and everyone folds to the BB, oppsLeft is 1 — and
  // this flag then defended the BB on a 70% range against an UNDER-THE-GUN
  // open, overriding CALL_VS.early (0.58) with t(0.30). True heads-up needs
  // the TABLE to be two-handed (tableSize carries dealt-in count when the
  // caller provides it), or the lone remaining opponent to be the SB — which
  // is genuine blind-vs-blind and deserves the wide defense.
  const headsUp =
    ctx.mode !== undefined &&
    ctx.oppsLeft === 1 &&
    (position === 'sb' || position === 'bb') &&
    ((ctx.tableSize ?? 2) <= 2 || raiserPosition === 'sb' || raiserPosition == null);

  // ── V11 PRICE-IN GUARD (Dan 2026-08-22, binding) ────────────────────────
  // "Folding in tournaments to less than 1 BB" — a horse must NEVER fold when
  // the pot is laying a price that any two cards beat. Any two live cards
  // clear ~25-30% equity, so when the pot odds require materially less than
  // that, folding burns chips no strategy can win back. Applies to every
  // branch below: checked FIRST, before any strength threshold can fold.
  const effCall = Math.min(toCall, stack);
  const guardOdds = effCall > 0 ? preflopCallOdds(ctx, pricePot, effCall) : 1;
  const pricedIn =
    ctx.mode !== undefined && // V11 on — ablation (mode absent) keeps legacy
    toCall > 0 &&
    (guardOdds <= 0.15 || // ~5.7:1 or better — never fold any two cards
      (effCall <= bb && guardOdds <= 0.22) || // under 1bb more at 3.5:1+
      // Tournament crumbs: with <=2bb behind, the blinds will eat the stack
      // anyway — take the flip instead of blinding out.
      (isTourney && stackBB <= 2 && guardOdds <= 0.34));
  // V13: the wrapper above applies this AFTER the decision, as a
  // fold-replacement. Keeping the old early return only for the ablation.
  if (pricedIn && ctx.v13 === false) return { a: 'call' };

  // Stack-depth texture: deep stacks reward speculative suited/connected
  // hands (implied odds); shallow stacks punish them.
  const depthLoosen = stackBB > 150 ? 0.02 : 0;
  const depthTighten = stackBB < 50 ? 0.03 : 0;

  // V18 STRADDLE: a straddled pot's current bet is the straddle (2xBB+) or kill
  // blind with zero raises - that is blind money, not an open. The whole unopened
  // branch (opens, limps, isolation) must own it, and open sizing keys off
  // the straddle/kill unit so a raise "to 3x" means 3x the active blind unit.
  const straddled =
    raises === 0 &&
    (unblocked86
      ? ((ctx.straddled === true || ctx.killPotUnopened === true) &&
          (typeof ctx.effectiveRaises === 'number' || currentBet <= bb * 8.5)) ||
        (ctx.effectiveRaises === 0 && currentBet > bb * 1.05)
      : ctx.straddled === true && currentBet <= bb * 2.2);
  const openUnit = straddled ? Math.max(currentBet, bb) : bb;
  const unopened =
    (raises === 0 && currentBet <= bb * 1.05) ||
    straddled ||
    (unblocked86 && ctx.isOptionCheckAvailable === true && raises === 0 && toCall === 0);

  // ═══ V20 M-ZONES (2026-08-27) ═══
  // stackBB is blind-blind arithmetic; the number that decides tournament
  // life is M — orbits of survival left: stack / (blinds + antes per orbit).
  // With a full ante a "12bb" stack is an M of ~5, already deep in Harrington
  // orange, and the old stackBB-only gate treated it like a cash short stack.
  // Effective M scales by table size over 10 (short tables burn orbits
  // faster). Layer off (anteBB undefined) = legacy behavior everywhere.
  const players20 = ctx.tableSize ?? Math.max(2, ctx.oppsLeft + 1);
  // `anteOrbitBB` is the ante cost of a WHOLE ORBIT, already resolved by
  // AnteMath for the table's ante style. It used to be a per-player figure
  // multiplied by the seat count right here, which read a big-blind-ante
  // structure as seat-count times too expensive and made a 39bb stack look
  // like an M of 3 — every tournament became jam-or-fold.
  const orbitBB20 = 1.5 + Math.max(0, ctx.anteOrbitBB ?? 0);
  const phase6M = ctx.phase6?.m;
  let phase6DecisionZone = phase6M?.zone;
  const mzOn = isTourney && (ctx.anteOrbitBB !== undefined || phase6M !== undefined);
  let effM = phase6M
    ? phase6M.effectiveM
    : mzOn
      ? (stackBB / orbitBB20) * Math.min(1, players20 / 10)
      : Infinity;
  /** stackBB as the NEXT level will see it — see the blind clock below. */
  let effStackBB = stackBB;
  // ═══ V23 BLIND CLOCK (2026-08-28) ═══ the M that matters is the one the
  // NEXT level gives you. Within three minutes of a level that raises the
  // blinds, play the shrunken M now — the fold that "waits for a better
  // spot" is choosing to jam a 40% shorter stack two hands later.
  if (
    mzOn &&
    effM !== Infinity &&
    tournamentNextLevelProjectionApplies(ctx.nextBlindInMin, ctx.nextBlindMult)
  ) {
    effM = phase6M ? Math.min(effM, phase6M.projectedEffectiveM) : effM / (ctx.nextBlindMult ?? 1);
    // ...and the DEPTH moves with it. A 30bb stack two minutes from a level
    // that doubles the blinds is a 15bb stack, and the push/fold depth cap
    // has to be read in the same currency as the M it guards, or the cap
    // silently repeals the blind clock.
    effStackBB = phase6M ? phase6M.projectedStackBB : stackBB / (ctx.nextBlindMult ?? 1);
    if (phase6M) phase6DecisionZone = tournamentMZone(effM, phase6M.zone);
  }
  const v20Wired = ctx.anteOrbitBB !== undefined || phase6M !== undefined;
  const phase6Red =
    phase6M != null && (phase6DecisionZone === 'dead' || phase6DecisionZone === 'red');
  const phase6OrangeOrWorse =
    phase6M != null &&
    (phase6DecisionZone === 'dead' ||
      phase6DecisionZone === 'red' ||
      phase6DecisionZone === 'orange');

  // ═══ V25 PLO TOURNAMENTS ARE NOT PUSH/FOLD (Dan 2026-08-28) ═════════════
  // THE STRUCTURAL FACT the brain did not model: POT LIMIT MEANS YOU CANNOT
  // SHOVE. A preflop pot-sized raise is ~3.5bb, so an "all-in" is legal only
  // at roughly 3.5bb or less. Every M-zone jam gate above is holdem thinking:
  // a 12bb PLO stack that "jams" actually raises 3.5bb and sits there with
  // 8.5bb behind, facing a 3-bet it never planned for. legalize() quietly
  // clamps the intent, so the horse acted on a plan the game does not allow.
  //
  // What short-stack PLO really is: a COMMITMENT decision. Raising pot with
  // a stack this shallow means the rest is going in, so the only question is
  // whether the hand is one you will stack off with - and having decided
  // that, you must never fold to the re-raise you invited. That is the
  // difference between a PLO tournament regular and a holdem player using
  // holdem rules in the wrong game.
  //
  // commitRatio = what one pot-sized raise costs as a share of the stack.
  // At >= 0.25 the raise IS the commitment, whatever the bb count says: a
  // 3.5bb pot raise is a quarter of a 14bb stack, and raising a quarter of
  // your tournament life and then folding is the worst line in poker. (The
  // first cut used 0.35, which put a 12bb stack OUTSIDE the zone - and the
  // test caught the 12bb stack limp-calling junk through the deep-stack
  // fallback instead, which is precisely the hole this layer exists to fill.)
  const ploT = ctx.isOmaha && isTourney && ctx.ploTourney === true;
  // A pot raise from an unopened pot is ~3.5bb; facing a raise it is
  // roughly 3*currentBet + pot (the pot-limit formula), which is what the
  // engine's own legalize() will clamp to.
  const potRaiseCost = unopened
    ? bb * 3.5
    : Math.min(stack, 3 * currentBet + Math.max(0, pot - currentBet));
  const commitRatio = stack > 0 ? potRaiseCost / stack : 1;
  /**
   * The EXACT pot-limit raise-to ceiling for this decision. `potRaiseCost`
   * above is an approximation that feeds the commitment-zone THRESHOLDS, and
   * it is deliberately left alone - moving a threshold is a strategy change
   * and needs league evidence. This is the number every pot-limit raise is
   * SIZED to, which is a correctness question, not a strategy one.
   */
  const potRaiseTo = potLimitRaiseTo(pot, currentBet, toCall);
  /**
   * ═══ V34 (2026-09-02): A COMMITMENT ZONE IS ABOUT RAISING, NOT CALLING ═══
   *
   * The zone was one gate for both shapes of decision, and at 0.25 it
   * swallowed the entire mid-stack tournament: with 24bb behind, a pot
   * re-raise over a 2.2x open costs ~8bb (34% of the stack), so every PLO
   * blind at 20-30bb was routed into "pot it or fold" and the CALL - the play
   * the big blind makes with most of its range at 3.4:1 - did not exist.
   * Measured before this change, PLO4/6/8 tournament at 25bb, BB facing a
   * button open: fold 82-86%, raise 14-18%, CALL 0%. The V24 price defense
   * that the single-raise branch carries for exactly this spot was never
   * reached.
   *
   * Opening a pot keeps the 0.25 gate: first in, limping is banned anyway, so
   * raise-or-fold is the only menu and the bar just has to be a stack-off
   * bar. FACING a raise, the zone applies only when the pot re-raise really
   * is the stack (>= 45% of it) or the call alone is a quarter of the stack;
   * everything shallower falls through to the price-aware branches below,
   * which still reshove the right hands (V25 Omaha reshove, <= 25bb).
   */
  const ploCommitZone =
    ploT &&
    (unopened
      ? commitRatio >= 0.25
      : commitRatio >= 0.45 || (stack > 0 && Math.min(toCall, stack) / stack >= 0.25));
  // Already-invested commitment: chips in the middle this hand as a share of
  // everything hero started with. Past ~30% a fold surrenders a stake big
  // enough that folding is worse than the worst call.
  const investedShare = stack + toCall > 0 ? (currentBet - toCall) / (stack + currentBet) : 0;

  // ═══ ALL-IN-OR-FOLD (2026-08-30) ══════════════════════════════════════
  // At an AoF table the preflop menu is fold or shove. The engine enforced
  // that by COERCING the horse's answer — "any non-fold intent becomes the
  // all-in" — while the brain went on choosing from a normal menu. So every
  // hand it would have opened for 2.5bb, and every hand it would have called
  // a raise with, was silently converted into a shove of the entire stack.
  // Its OPENING range became its SHOVING range.
  //
  // Same shape as the big blind ante bug fixed earlier today: the brain does
  // not know a rule, and a downstream layer rewrites its answer into
  // something strategically wrong. A coercion cannot fix a range.
  //
  // The thresholds are the push/fold block's own, deliberately, so AoF does
  // not invent a second set of numbers — plus one depth term, because a shove
  // risks the whole stack to win the blinds and that price rises with depth.
  // It is anchored at 12bb, where the push/fold numbers are already tuned, so
  // a short AoF table behaves exactly as push/fold does today.
  //
  // The downstream coercion stays as the legality guarantee. This makes it a
  // no-op instead of a strategy.
  if (ctx.allInOrFold === true) {
    const aofDepth = Math.min(AOF_MAX_TIGHTEN, Math.max(0, stackBB - 12) * AOF_TIGHTEN_PER_BB);
    if (unopened) {
      let bar = position === 'late' || position === 'sb' ? 0.5 : 0.6;
      if (ctx.isOmaha) bar += 0.08;
      if (isTourney) {
        bar -= anteWiden + (stackBB <= 7 ? 0.08 : 0.03);
        if (mzOn && effM < 5) bar -= effM < 3 ? 0.1 : 0.05;
      }
      bar += phase6Shift('jam');
      bar += aofDepth;
      if (strength >= t(bar)) return { a: 'jam' };
      if (toCall === 0) return { a: 'check' };
      return { a: 'fold' };
    }
    // Calling a shove buys no fold equity, so it needs the hand outright.
    let callBar = raises >= 2 ? 0.85 : 0.72;
    if (ctx.mode !== undefined && guardOdds <= 0.35) callBar -= 0.12;
    if (isTourney) callBar -= anteWiden * 0.5;
    if (v20Wired && callers >= 1) callBar += Math.min(0.1, callers * 0.05);
    if (mzOn && effM >= 5) callBar += ctx.riskAdd;
    if (ctx.isOmaha) callBar += 0.03;
    callBar += aofDepth;
    callBar += phase6Shift('call');
    if (strength >= t(callBar)) return { a: 'jam' };
    if (toCall === 0) return { a: 'check' };
    return { a: 'fold' };
  }

  // ═══ V37 SATELLITE (Dan 2026-09-02) ═══════════════════════════════════
  // A LOCKED seat: the ticket is the same whether hero finishes first or
  // K-th, so no pot is worth a meaningful share of the stack — aces included,
  // against a covering all-in. The one aggression that survives is the free
  // kind: an open-jam into a table hero covers by a margin, where the players
  // who want a seat cannot call. Everything else checks or folds.
  if (ctx.satellite?.locked) {
    const share = stack > 0 ? Math.min(toCall, stack) / stack : 1;
    if (toCall > 0 && share >= 0.12) return { a: 'fold' };
    if (unopened) {
      if (ctx.satellite.coversAll && strength >= t(0.45 - anteWiden)) return { a: 'jam' };
      if (toCall === 0) return { a: 'check' };
      return { a: 'fold' };
    }
    if (toCall === 0) return { a: 'check' };
    return { a: 'fold' };
  }
  // Below the seat line with the blinds coming: chips are the ticket, and the
  // stacks that are locked cannot call. Every jam and reshove bar widens.
  const satUrgent = ctx.satellite?.urgent === true ? 0.08 : 0;

  // ── Short stacks: push/fold and reshove stacks ──
  // V20: the gate is M-based in tournaments (red zone M<5 and most of
  // orange enter jam-or-fold even when stackBB reads above 12), and Omaha
  // short stacks finally HAVE a jam-or-fold posture instead of falling
  // through to deep-stack pot-limit logic.
  // ═══ V25 PLO COMMITMENT ZONE ═══ raise-or-fold, and having raised, commit.
  if (ploCommitZone) {
    if (unopened) {
      // The raise IS the stack, so the bar is a STACK-OFF bar, not an open.
      // Late position and a burnt M widen it exactly as the NLH gate does;
      // Omaha starts tighter because four cards make everyone's range wide,
      // so the fold equity a holdem shove buys is simply not there.
      let commitBar = position === 'late' || position === 'sb' ? 0.56 : 0.64;
      commitBar -= anteWiden;
      if (mzOn && effM < 5) commitBar -= effM < 3 ? 0.1 : 0.05;
      // The shallower the stack relative to one pot raise, the closer this is
      // to a true shove and the wider it should be.
      if (commitRatio >= 0.75) commitBar -= 0.06;
      if (strength >= t53(commitBar, 'commitOpen')) {
        // Sized as a pot raise; the engine clamps it, and at this depth that
        // clamp IS the all-in.
        // Sized as a pot raise off the live pot; the engine clamps it, and
        // at this depth that clamp IS the all-in. (Was `bb * 3.5`, which is
        // the pot only in an ante-free, straddle-free, limper-free 1/2 game.)
        return { a: 'raiseTo', to: potRaiseTo };
      }
      if (toCall === 0) return { a: 'check' };
      return { a: 'fold' };
    }
    // Facing action. In PLO the all-in call is far more price-driven than in
    // holdem: equities compress (the worst four cards still hold ~30% against
    // the best, where the worst two hold ~12%), so being "crushed" is rare
    // and the pot odds carry most of the decision.
    let callOff = raises >= 2 ? 0.8 : 0.66;
    if (guardOdds <= 0.4) callOff -= (0.4 - guardOdds) * 1.2; // 3:1 -> -0.18
    if (callers >= 1) callOff += Math.min(0.08, callers * 0.04);
    // V53 prices this call-off's survival cost itself (commitCall below).
    if (mzOn && effM >= 5 && !ploIcm) callOff += ctx.riskAdd * 0.5;
    // CHIPS ALREADY IN ARE NOT A FRESH DECISION. When hero raised and got
    // re-raised, this branch was pricing the call as if the money in the
    // middle belonged to somebody else - and folded a third of a stack it
    // had voluntarily committed a moment earlier. That is the raise-fold
    // this layer is named after, and it hid inside the layer itself until a
    // test drove the sequence end to end.
    if (investedShare >= 0.28) callOff -= 0.18;
    if (strength >= t53(Math.max(0.34, callOff), 'commitCall')) {
      return { a: 'raiseTo', to: potRaiseTo };
    }
    if (toCall === 0) return { a: 'check' };
    return { a: 'fold' };
  }

  // PUSH/FOLD IS A SHORT-STACK STRATEGY, AT ANY M (2026-08-30). The M-zone
  // disjunct below used to carry no depth cap at all, so a table with a large
  // ante could put a stack of ANY size into jam-or-fold. Both later jam
  // branches were written with `stackBB <= 22` and comments saying exactly
  // why ("so a big-ante deep stack does not jam 30 blinds") — this, the gate
  // that decides whether the WHOLE strategy is jam-or-fold, was the one
  // without it.
  //
  // Measured in production before the fix, over 40 minutes of tournaments:
  //     open jams              416,   182 of them deeper than 25bb (max 72bb)
  //     3-bets                 254,   85.4% of them all-in (max 184bb)
  // Cash, where the ante bug could not reach, ran 3.7% and 0.0%.
  //
  // 22bb is not a new number: it is the one the sibling branches already
  // chose for this exact failure, and inventing a second convention here
  // would be worse than reusing theirs.
  // V70: folded to a no-limit hold'em seat, the GTO open owns every stack
  // the jam-or-fold zones do not. Where they do (push/fold <= 12bb, the
  // red and orange M zones up to 22bb) the structure is kept exactly as it
  // was: replacing the orange-zone shove of the opening range with a small
  // open measured +1.9 +/- 1.6 bb/100 in the 20bb mirror but -8.7 +/- 2.9
  // against the human-calibrated field over four seeds (the population
  // over-folds to the shove), so it is a follow-up, not part of this change.
  const legacyPushFold =
    !ctx.isOmaha &&
    (stackBB <= 12 || (mzOn && (phase6M ? phase6Red : effM < 6) && effStackBB <= PUSH_FOLD_MAX_BB));
  const legacyOrangeJam =
    mzOn && (phase6M ? phase6OrangeOrWorse : effM < 10) && stackBB <= 22 && !ctx.isOmaha;
  //
  // Two- and three-handed the M zones are not a depth read at all: the
  // effective-M table scaling (players / 10) puts a heads-up 40bb stack at
  // M 5, so every heads-up and spin stack under 22bb played jam-or-fold and
  // the live heads-up small blind folded half its buttons (46% opened over
  // 7,692 decisions on 2026-10-31). There the jam-or-fold zone is the
  // push/fold charts' own, <= 15bb (12bb without the M layer), and every
  // deeper stack opens.
  const v70ShortHanded = (ctx.tableSize ?? 6) <= 3;
  const v70JamZone = v70ShortHanded
    ? stackBB <= 12 || (mzOn && effStackBB <= V70_SHORT_HANDED_JAM_MAX_BB)
    : legacyPushFold || legacyOrangeJam;
  const v70LimpersAllowed =
    limpers === 0 ||
    (v87 &&
      ctx.mode === 'cash' &&
      ctx.cashActionSizes !== false &&
      straddleEffectiveBB > 50 &&
      limpers >= 1 &&
      limpers <= 2);
  const v70Open =
    ctx.gtoOpen !== undefined && !ctx.isOmaha && unopened && v70LimpersAllowed && !v70JamZone;
  // V82 facing action too: two- and three-handed no-limit hold'em, the
  // jam-or-fold zone is the short-handed one above, not the table-scaled M
  // read, so a 20bb spin or heads-up stack can flat an open instead of only
  // jamming or folding. Short deck and fixed limit keep the legacy gate, as
  // they keep it for the open (V70 answers no-limit hold'em only).
  const v70HoldemShortHanded =
    ctx.facingOpenShortHandedZone === true &&
    v70ShortHanded &&
    !ctx.isOmaha &&
    ctx.isShortDeck !== true &&
    ctx.isFixedLimit !== true;
  // V82 DEPTH IS THE STACK THE HAND STARTED WITH (2026-11-08). The V82 band
  // is 15 to 22bb counted as the stack behind plus the chips hero already
  // has in this street, both ends inclusive; `stackBB` is only the chips
  // behind, so a big blind that began the hand with 15.0-16.0bb read 14-15bb
  // and `<= 15` put it back into jam-or-fold. Live on 40bc2467 (2026-11-07):
  // three-handed BB 15-18bb facing one sized open continued 12.7% (n 370,
  // mostly exactly 15.00bb); replayed, hands 84dd1c83, 64d4e91b, 76089692,
  // 5263c30c and heads-up 5ea10c41 all folded at the push/fold node, on
  // 92e26a9f and 40bc2467 alike. Facing action only: the unopened V70 open
  // keeps v70JamZone exactly. The blind-clock projection (effStackBB) scales
  // the hand-start depth the same way it scales the stack behind.
  const v82HandStartBB = stackBB + Math.max(0, currentBet - toCall) / bb;
  const v82DepthScale = stackBB > 0 ? effStackBB / stackBB : 1;
  const v82FacingJamZone =
    v82HandStartBB <= 12 || (mzOn && v82HandStartBB * v82DepthScale < V70_SHORT_HANDED_JAM_MAX_BB);
  // FULL-RING FACING-ACTION ZONE (2026-11-07, default off): four or more
  // dealt, facing action, the same <= 15bb zone. The table-scaled M put a
  // 20bb six-handed (M 4.8) and four-handed (M 3.2) big-blind-ante stack in
  // jam-or-fold facing a 2.5bb open: measured through HorseLogic.decide
  // (tournament Hybrid persona), the big blind folded 88.6% to a button
  // min-raise at 6-max and 4-max 20bb against 27% at 9-max, where the same
  // stack reads M 7.2. The open (the orange-zone shove, an owner decision)
  // is untouched: this reads only spots that are not unopened.
  const fullRingFacing =
    ctx.facingOpenFullRingZone === true &&
    !v70ShortHanded &&
    !unopened &&
    !ctx.isOmaha &&
    ctx.isShortDeck !== true &&
    ctx.isFixedLimit !== true;
  const facingZone84 = stackBB <= 12 || (mzOn && effStackBB <= V70_SHORT_HANDED_JAM_MAX_BB);
  const pushFoldNlh =
    (v70HoldemShortHanded
      ? unopened
        ? v70JamZone
        : v82FacingJamZone
      : fullRingFacing
        ? facingZone84
        : legacyPushFold) && !v70Open;
  // V25: the old Omaha gate (<=8bb / M<4) is superseded by the commitment
  // zone above, which triggers on the pot-limit arithmetic rather than a bb
  // count. It stays for the ablation path (ploTourney off).
  const pushFoldOmaha = ctx.isOmaha && !ploT && mzOn && (stackBB <= 8 || effM < 4);
  if (pushFoldNlh || pushFoldOmaha) {
    if (unopened) {
      // V11: tournament jam ranges follow push/fold math — wider from late
      // seats, wider still with antes, and wider as the stack shrinks (a 5bb
      // stack jams far more than a 12bb stack).
      // V20: Omaha jam-or-fold runs tighter (equities cluster, domination
      // decides) and the red zone widens NLH jams by how burnt the M is.
      let jamThresh = position === 'late' || position === 'sb' ? 0.5 : 0.6;
      if (ctx.isOmaha) jamThresh += 0.08;
      if (isTourney) {
        jamThresh -= anteWiden + (stackBB <= 7 ? 0.08 : 0.03) + satUrgent;
        if (mzOn && effM < 5) jamThresh -= effM < 3 ? 0.1 : 0.05;
      }
      jamThresh += phase6Shift('jam');
      if (strength >= t(jamThresh)) return { a: 'jam' };
      if (toCall === 0) return { a: 'check' };
      // V11: never open-limp/call off a push/fold stack — jam or fold.
      //
      // The line that used to sit here did the opposite of what that sentence
      // says: `!isTourney && toCall <= bb && strength >= 0.3` OPEN-LIMPED a
      // cash push/fold stack with any hand of strength 0.3. It is unreachable
      // in practice today - measured across 7 hands x 6 seats x 2 depths, a
      // <=12bb cash stack jams or folds every time, because the jam bar
      // catches everything at 0.3 or better first - but a rule that reads
      // "never" must not carry its own exception, and the surrounding
      // thresholds move.
      return { a: 'fold' };
    }
    // Facing action short-stacked: jam on real strength; the threshold eases
    // as the price improves (calling a shove getting 2:1 is not calling a
    // shove getting even money).
    let jamCallThresh = raises >= 2 ? 0.85 : 0.72;
    if (ctx.mode !== undefined && guardOdds <= 0.35) jamCallThresh -= 0.12;
    if (isTourney) jamCallThresh -= anteWiden * 0.5;
    // V20: every caller already in is another range hero must beat, and a
    // tournament life is worth more than the chip price — the flat t()
    // premium underprices a full call-off, so it is paid AGAIN here — but
    // only while there is a life left to protect: a red-zone stack (M<5) is
    // already dead money walking and takes its flips.
    if (v20Wired && callers >= 1) jamCallThresh += Math.min(0.1, callers * 0.05);
    if (mzOn && effM >= 5) jamCallThresh += ctx.riskAdd;
    if (ctx.isOmaha) jamCallThresh += 0.03;
    jamCallThresh += phase6Shift('call');
    // ═══ V77 SEAT-AWARE SHORT-STACK JAMS (2026-11-02, Burls via Dan:
    // "JAMMING ALL IN TOO MUCH, THEY AREN'T CONSIDERING THE UTG OR EARLY
    // POSITION OPENERS") ═══ This node jammed over an under-the-gun open on
    // exactly the bar it jammed over a button open (24 h of production:
    // 6.8% of facing-one-open spots jammed over an early open vs 8.1% over
    // a late one at <=15bb — nearly flat). The bar was calibrated against
    // the WIDEST (late) opening range; a seat that opens fewer hands holds
    // proportionally more of the hands that dominate hero's marginal jams,
    // so the bar rises with the share of the late reference width the
    // opener's seat does NOT open — the V70 per-seat width itself
    // (HorseGtoVs3BetRanges.openWidth), dealt-census indexed and
    // ante-aware, never a frequency target. At a ~12% under-the-gun width
    // the tighten is ~0.084, landing the <=12-15bb bar at ~0.80 — the same
    // early bar the Phase 6 reshove node already uses at 20bb. Tighten
    // only: a 40%+ (button/blind) width keeps today's bar exactly. Facing
    // a 3-bet or more (raises >= 2), the first-in jam (V71/V27), the shove
    // caps (HorseTournamentShoveDiscipline) and Omaha are untouched.
    if (!ctx.isOmaha && raises === 1 && ctx.openerOpenWidthPct !== undefined) {
      jamCallThresh += v77JamSeatTighten(ctx.openerOpenWidthPct);
    }
    if (
      v87 &&
      isTourney &&
      !ctx.isOmaha &&
      (ctx.bountyFactor ?? 0) > 0 &&
      ctx.coversRaiser === true
    ) {
      const bfJam = Math.max(0, Math.min(1, ctx.bountyFactor ?? 0));
      jamCallThresh -=
        Math.min(0.07, bfJam * 0.15) +
        (ctx.raiserBustable === true ? Math.min(0.05, bfJam * 0.1) : 0);
    }
    if (strength >= t(jamCallThresh)) return { a: 'jam' };
    if (toCall === 0) return { a: 'check' };
    if (!isTourney && toCall <= bb && strength >= 0.3) return { a: 'call' };
    return { a: 'fold' };
  }
  // ═══ V87 FACING ISO-RAISE AFTER HERO LIMPED (2026-11-10) ═══════════════
  if (
    v87 &&
    noLimitHoldem &&
    !ctx.isPotLimit &&
    raises === 1 &&
    toCall > 0 &&
    ctx.heroPreviouslyActed === true &&
    ctx.heroWasInitialRaiser !== true &&
    v87EpCand !== null
  ) {
    const ipIso = position === 'late' || (raiserPosition === 'sb' && position === 'bb');
    const raiseIsoTo = (): PreflopIntent => {
      if (
        ctx.mode === 'cash' &&
        ctx.cashThreeBetSizing &&
        !ctx.isOmaha &&
        !ctx.isPotLimit &&
        !ctx.isFixedLimit &&
        !ctx.isShortDeck
      ) {
        return {
          a: 'raiseTo',
          receipt: 'cash_nlh_three_bet_size',
          to: cashNlhThreeBetRaiseTo({
            ...ctx.cashThreeBetSizing,
            openTo: currentBet,
            bigBlind: bb,
            callers,
            rand,
          }),
        };
      }
      return {
        a: 'raiseTo',
        to: currentBet * (ipIso ? 3.2 : 3.6) * ctx.sizingMultiplier,
      };
    };
    const recordLimpIsoAuthority = (
      branch: 'v87_ep_limp_reraise_value' | 'v87_ep_limp_reraise_bluff' | 'v87_ep_limp_call_iso',
      premiumValue: boolean
    ) =>
      ctx.noteAuthority?.({
        branch,
        strength,
        threeBetThreshold: 0.75,
        effectiveThreeBetThreshold: 0.75,
        premiumValue,
        pressure: false,
      });

    if (v87EpCand === 'big_pair_trap') {
      recordLimpIsoAuthority('v87_ep_limp_reraise_value', true);
      if (ctx.facingClosedAllIn === true || ctx.reopenAllowed === false) {
        return toCall >= stack ? { a: 'jam' } : { a: 'call' };
      }
      if (straddleEffectiveBB <= 28) return { a: 'jam' };
      return raiseIsoTo();
    }
    const effCoins = Math.min(stack, straddleEffectiveBB * straddleUnitCoins);
    const maxFlatIsoCoins = Math.min(
      effCoins * 0.1,
      straddleUnitCoins * (4.25 + Math.min(callers, 2) * 1.0)
    );
    if (
      ctx.raiserIsAllIn !== true &&
      ctx.facingClosedAllIn !== true &&
      straddleEffectiveBB >= 28 &&
      ctx.riskAdd < 0.08 &&
      toCall <= maxFlatIsoCoins
    ) {
      const uIso = v87EpCandidateMixU(ctx, 'suited_connector', 0x87150b);
      if (
        ctx.reopenAllowed !== false &&
        straddleEffectiveBB >= 45 &&
        ctx.maniacNoBluff !== true &&
        callers <= 1 &&
        ctx.riskAdd < 0.05 &&
        toCall <= straddleUnitCoins * 4.5 &&
        uIso < 0.22
      ) {
        const bluffTarget = raiseIsoTo();
        const bluffTargetCoins =
          bluffTarget.a === 'raiseTo' ? (bluffTarget.to ?? Infinity) : Infinity;
        if (bluffTargetCoins <= effCoins * 0.34) {
          recordLimpIsoAuthority('v87_ep_limp_reraise_bluff', false);
          return bluffTarget;
        }
      }
      recordLimpIsoAuthority('v87_ep_limp_call_iso', false);
      return { a: 'call' };
    }
  }
  // ═══ V87 TOURNAMENT 16-26BB 3-BET RESHOVE WEDGES (2026-11-10) ══════════
  if (
    v87 &&
    isTourney &&
    noLimitHoldem &&
    !ctx.isPotLimit &&
    (ctx.tableSize ?? 6) > 2 &&
    raises === 1 &&
    callers === 0 &&
    toCall > 0 &&
    effStackBB >= 16 &&
    effStackBB <= 26 &&
    ctx.satellite?.locked !== true &&
    v87HoleClass !== null
  ) {
    const vsStealWedge =
      (raiserPosition === 'late' || raiserPosition === 'sb') &&
      V87_TOURNEY_RESHOVE_VS_LATE.has(v87HoleClass);
    const vsMiddleWedge =
      raiserPosition === 'middle' && V87_TOURNEY_RESHOVE_VS_MIDDLE.has(v87HoleClass);
    const heavyIcmCovered = (ctx.bubblePressure ?? 0) === 0 && ctx.riskAdd >= 0.09;
    const survivesIcm = !heavyIcmCovered || V87_TOURNEY_RESHOVE_VS_MIDDLE.has(v87HoleClass);
    if ((vsStealWedge || vsMiddleWedge) && survivesIcm) {
      return { a: 'jam' };
    }
  }
  if (ctx.phase6?.policy.branch === 'reshove' && isTourney && !ctx.isOmaha && raises === 1) {
    // Phase 6 unified reshove node. The callers add dead money but also
    // another range to clear. Depth pressure is continuous rather than a hard
    // 25bb cliff, while the classifier's hysteretic M zone prevents one chip
    // from swapping the whole action family.
    const base = raiserPosition === 'early' ? 0.8 : raiserPosition === 'middle' ? 0.73 : 0.66;
    const depthPenalty = Math.min(0.35, Math.max(0, stackBB - 20) * 0.025);
    const reshoveBar =
      base +
      depthPenalty +
      Math.max(0, callers - 1) * 0.025 -
      anteWiden -
      satUrgent +
      phase6Shift('jam');
    if (strength >= t(reshoveBar)) return { a: 'jam' };
  }
  if (
    ctx.phase6?.policy.branch !== 'reshove' &&
    stackBB <= 20 &&
    !ctx.isOmaha &&
    raises === 1 &&
    callers === 0 &&
    raiserPosition === 'late' &&
    strength >= t(0.62 - anteWiden - satUrgent + phase6Shift('jam'))
  ) {
    // V7 RESHOVE: 13-20bb over a late-position open — jam, don't flat.
    // V11: antes widen the reshove (dead money + first-in fold equity).
    return { a: 'jam' };
  }
  // ═══ V25 OMAHA RESHOVE ═══ what this actually adds, stated honestly after
  // a test proved the first claim wrong: the generic 3-bet below ALREADY
  // fires on a late open at 0.74, so this is not "a stack with no move".
  // Two real contributions:
  //   1. SIZING. The generic 3-bet multiplies currentBet by 2.2-2.6, which
  //      pot limit then clamps - so the horse asks for a number the game
  //      refuses and takes whatever it is given. A pot-sized re-raise is the
  //      largest legal raise, which at this depth is also the committing one.
  //   2. A slightly wider band, and a MIDDLE-position open included at 0.78
  //      where the generic bar is 0.80.
  // Deliberately tight either way: a PLO 3-bet gets called far more often
  // than a holdem one, so this needs real equity rather than fold equity.
  if (
    ploT &&
    stackBB <= 25 &&
    raises === 1 &&
    callers === 0 &&
    (raiserPosition === 'late' || raiserPosition === 'middle') &&
    strength >= t53((raiserPosition === 'late' ? 0.72 : 0.78) - anteWiden, 'threeBet')
  ) {
    return { a: 'raiseTo', to: potRaiseTo };
  }

  // V20 YELLOW ZONE RESHOVE: at M<12 the reshove is the whole playbook —
  // flatting an open leaves a stack that can only check-fold. Extend it to
  // middle-position opens on a stronger band (their range is tighter, so the
  // reshove needs more hand), capped at 22bb so a big-ante deep stack does
  // not jam 30 blinds.
  if (
    ctx.phase6?.policy.branch !== 'reshove' &&
    mzOn &&
    effM < 12 &&
    stackBB <= 22 &&
    !ctx.isOmaha &&
    raises === 1 &&
    callers === 0 &&
    raiserPosition === 'middle' &&
    strength >= t(0.7 - anteWiden + phase6Shift('jam'))
  ) {
    return { a: 'jam' };
  }

  // ── Unopened pot (or limpers only) ──
  if (unopened) {
    // V34: the button is its own seat; and 'early' at a full ring is three
    // seats deep (UTG, UTG+1, UTG+2), where a solver opens ~11-13%, not the
    // 6-max lojack's ~15%. tableSize carries the dealt-in count when the
    // M-zone layer is wired (it always is live).
    const baseOpen =
      position === 'late' && ctx.isButton === true ? OPEN_THRESH_BUTTON : OPEN_THRESH[position];
    const fullRingEarly = position === 'early' && (ctx.tableSize ?? 6) >= 8 ? 0.06 : 0;
    let openThresh: number;
    if (v70Open) {
      // V70: the seat's own base bar (its target share, ante tables wider),
      // scaled by its opening multiplier and the ICM premium. The hybrid
      // retains reference widths without changing other style thresholds. Antes,
      // the full-ring early seats, depth and the tournament widen are inside
      // the targets; the spin structure, the Phase 6 cell and the bubble
      // widen below still move it. An ante-free tournament under 50bb keeps
      // the old depth tighten: measured against the human-calibrated field,
      // the 40bb no-ante MTT card ran -1.17 +/- 0.61 bb/100 without it over
      // four seeds and -0.35 +/- 0.53 with it.
      openThresh =
        capBar(ctx.gtoOpen!.bar * (ctx.gtoOpen!.tightness ?? ctx.tightness) + ctx.riskAdd) -
        (ctx.format === 'spin' ? 0.05 : 0) +
        (limpers > 0 ? 0.02 * limpers : 0) +
        vs35.open +
        phase6Shift('open') +
        (isTourney && !ctx.anteInPlay ? depthTighten : 0);
    } else {
      openThresh = t53(baseOpen + fullRingEarly, 'open') + Math.min(limpers, 3) * 0.03;
      openThresh += depthTighten - depthLoosen - anteWiden + vs35.open;
      openThresh += phase6Shift('open');
      // TOURNAMENT AGGRESSION: every seat opens a little wider, the cutoff and
      // button wider still, and the small blind (one player left to beat, an
      // ante in the pot) far wider.
      if (tAggro) openThresh -= position === 'sb' ? 0.08 : position === 'late' ? 0.03 : 0.02;
      else if (tAggroPlo)
        openThresh -= position === 'sb' ? 0.06 : position === 'late' ? 0.03 : 0.015;
    }
    // V37: the captain steals wider near the bubble — the field cannot call.
    const bpOpen = Math.max(0, Math.min(1, ctx.bubblePressure ?? 0));
    openThresh -=
      (v87 && isTourney && noLimitHoldem && ctx.satellite?.locked !== true ? 0.105 : 0.06) * bpOpen;
    if (
      v87 &&
      isTourney &&
      noLimitHoldem &&
      (ctx.bountyFactor ?? 0) > 0 &&
      ctx.coversRaiser === true
    ) {
      openThresh -= Math.min(0.04, Math.max(0, ctx.bountyFactor ?? 0) * 0.08);
    }
    if (unblocked86) {
      if (typeof ctx.coverBubblePressure === 'number' && ctx.coverBubblePressure !== 0) {
        openThresh -= 0.05 * Math.max(-1, Math.min(1, ctx.coverBubblePressure));
      }
      if (
        !isTourney &&
        !ctx.isOmaha &&
        typeof ctx.sevenDeuceBonus === 'number' &&
        ctx.sevenDeuceBonus > 0
      ) {
        openThresh -= Math.min(0.42, ctx.sevenDeuceBonus);
      }
    }
    // V10 LIMP ISOLATION: weak limpers are the softest spot in cash poker.
    // Rather than only tightening (and sizing up) against them, ATTACK in
    // position — widen the raise floor so more hands isolate the limp(s). The
    // per-limper size bump below already punishes them.
    const isoW = ctx.isoWiden ?? 0;
    const limpReraiser = limpers >= 1 && ctx.limpReraiseRate !== undefined;
    if (v87 && noLimitHoldem) {
      if (
        isoW > 0 &&
        limpers >= 1 &&
        !limpReraiser &&
        (position === 'late' || position === 'middle' || position === 'early')
      ) {
        const posIsoScale = position === 'early' ? 0.42 : 1;
        if (v70Open) {
          openThresh -= isoW * posIsoScale * 0.5;
        } else {
          openThresh -= isoW * posIsoScale + Math.min(limpers - 1, 2) * 0.01;
        }
      }
    } else if (
      isoW > 0 &&
      limpers >= 1 &&
      !limpReraiser &&
      (position === 'late' ||
        position === 'middle' ||
        (v86 && ctx.isOmaha && ctx.omahaElite?.canThreeBet === true))
    ) {
      openThresh -= isoW + Math.min(limpers - 1, 2) * 0.01;
    }
    // LIMP-RERAISE READ: a limper seen to limp-reraise is isolated only with
    // hands that stand his re-raise (HorseLimpReraiseRead).
    if (limpReraiser) openThresh = limpReraiseIsoBar(openThresh, ctx.limpReraiseRate!);

    // Blind-vs-blind: heads-up SB vs BB plays much wider.
    // V11: TRUE heads-up (a 2-handed game, not just blinds left in a ring
    // hand) plays wider still — the SB/BTN opens the large majority of hands.
    const bvb = position === 'sb' && ctx.oppsLeft === 1;
    // V34: `headsUp` is true in an unopened pot at ANY table size
    // (raiserPosition is null first-in), so a full-ring small blind folded
    // to opened 76% like a heads-up button. A ring SB against one big blind
    // raises ~40% and limps a band below that (the mix right after this);
    // only a genuinely two-handed table opens the 0.24 range.
    const trueHu = headsUp && (ctx.tableSize ?? 2) <= 2;
    if (bvb && !v70Open) {
      openThresh =
        t53(trueHu ? 0.24 : 0.3, 'open') +
        depthTighten -
        anteWiden +
        vs35.open +
        phase6Shift('open');
    }
    openThresh = phase6CapBar(openThresh);
    // MANIAC PRESSURE: never open a hand that has to fold to the maniac's
    // re-raise. Not tightness-shifted: the bar is the continuing share
    // against the maniac's measured width, already a price.
    if (ctx.maniacOpenBar !== undefined) openThresh = Math.max(openThresh, ctx.maniacOpenBar);
    // V86 EP/MP MANIAC-BEHIND TIGHTENING: opening marginal single-suited / dangler
    // Omaha hands from UTG/MP/HJ with a confirmed IP maniac or LAG bully yet to act
    // invites bloated OOP pots with dominated suits. Enter with double-suited or
    // nut-suit connected playability instead.
    const confirmedIpManiacBehind =
      ctx.lagBullyIpBehind === true ||
      (ctx.lagBullyIpBehind === undefined && ctx.maniacOpenBar !== undefined);
    if (
      v86 &&
      ctx.isOmaha &&
      (position === 'early' ||
        position === 'middle' ||
        (position === 'late' && ctx.maniacOpenBar !== undefined)) &&
      confirmedIpManiacBehind
    ) {
      const eliteOpen = ctx.omahaElite;
      const linearOpenPlayable =
        eliteOpen !== undefined &&
        (eliteOpen.cls === 'aa_ds' ||
          eliteOpen.cls === 'kk_ds' ||
          eliteOpen.cls === 'plo8_scoop' ||
          eliteOpen.cls === 'broadway_conn_ds' ||
          eliteOpen.cls === 'rundown_ds' ||
          eliteOpen.cls === 'ax_nut_suited' ||
          eliteOpen.cleanSuits >= 2 ||
          (eliteOpen.hasNutAceSuit && eliteOpen.connectedWindowSpan <= 4));
      if (!linearOpenPlayable && (eliteOpen === undefined || eliteOpen.cleanSuits < 2)) {
        openThresh = Math.max(openThresh + 0.08, position === 'early' ? 0.66 : 0.6);
      }
    }

    // ═══ V87 EP OPEN-LIMP TRAP & SUITED-CONNECTOR LIMP MIX (2026-11-10) ═══
    // Owner direction: mix early-position open-limps with QQ/KK/AA (to trap
    // aggressive iso-raisers with a 100% limp-3-bet) and 54s-T9s (for balanced
    // board coverage that defends against standard iso-raises) in both Hold'em
    // cash games and Hold'em tournaments. Pure deterministic hash; zero PRNG
    // draws consumed.
    const dealtCount87 = ctx.tableSize ?? Math.max(2, ctx.oppsLeft + 1);
    if (
      v87 &&
      v87EpCand !== null &&
      noLimitHoldem &&
      !ctx.isPotLimit &&
      raises === 0 &&
      limpers === 0 &&
      toCall > 0 &&
      position === 'early' &&
      dealtCount87 >= 6 &&
      !straddled &&
      ctx.straddleActive !== true &&
      !v70JamZone &&
      ((ctx.mode === 'cash' && ctx.cashActionSizes !== false && straddleEffectiveBB >= 55) ||
        (isTourney && effStackBB >= 35))
    ) {
      if (v87EpCand === 'big_pair_trap') {
        const uTrap = v87EpCandidateMixU(ctx, 'big_pair_trap', 0x87e911);
        if (uTrap < 3 / 18) {
          ctx.noteAuthority?.({
            branch: 'v87_ep_limp_trap',
            strength,
            threeBetThreshold: openThresh,
            effectiveThreeBetThreshold: openThresh,
            premiumValue: true,
            pressure: false,
          });
          return { a: 'call' };
        }
      } else if (ctx.maniacOpenBar === undefined) {
        const uSc = v87EpCandidateMixU(ctx, 'suited_connector', 0x87e95c);
        if (uSc < 0.2) {
          ctx.noteAuthority?.({
            branch: 'v87_ep_limp_suited_connector',
            strength,
            threeBetThreshold: openThresh,
            effectiveThreeBetThreshold: openThresh,
            premiumValue: false,
            pressure: false,
          });
          return { a: 'call' };
        }
      }
    }

    // V70: the open reads the hand on this seat's order (see gtoOpen).
    // V87: maniacOpenBar is calibrated in raw holdemPreflopScore units; from
    // early/middle OOP seats with a confirmed maniac yet to act, tighten out
    // weak dominated Rag-Ace / suited-7 / low-connector opens that brick and fold.
    const openStrength = v70Open ? ctx.gtoOpen!.strength : strength;
    const nlhManiacFloor =
      noLimitHoldem &&
      ctx.maniacOpenBar !== undefined &&
      (position === 'early' || position === 'middle')
        ? ctx.maniacOpenBar + (position === 'early' ? 0.08 : 0.04)
        : ctx.maniacOpenBar;
    const maniacBarOk = !v87 || nlhManiacFloor === undefined || strength >= nlhManiacFloor;
    if (openStrength >= openThresh && maniacBarOk) {
      // V20 ORANGE ZONE (M 6-10): there is no raise-fold — a standard open
      // is a third of the stack, and folding it to a reshove afterward is
      // the worst line short-stack poker offers. The opening range OPEN-JAMS
      // instead. NLH only, capped at 22bb so a big-ante 30bb stack does not
      // start jamming its whole opening range.
      if (legacyOrangeJam && !v70Open) {
        return { a: 'jam' };
      }
      // V37: below the seat line, an open at any depth that jam-or-fold does
      // not already own is a jam too — a raise-fold is a seat given away.
      if (satUrgent > 0 && stackBB <= 30 && !ctx.isOmaha) return { a: 'jam' };
      // Trap mix with true premiums (cheap to see a flop disguised).
      //
      // `limpers >= 1` added 2026-08-30: an open-limp with aces is still an
      // open-limp. It surrenders the dead money the same way, and on screen
      // it teaches every watching player that limping is normal here. Over-
      // limping a monster BEHIND other limpers is a real trap and survives;
      // opening the pot by calling does not.
      if (
        limpers >= 1 &&
        strength > 0.93 &&
        rand() < ctx.slowplayFreq * 0.4 &&
        !(unblocked86 && ctx.isOmaha) &&
        (!unblocked86 || position === 'late' || ctx.isButton === true) &&
        toCall <= openUnit
      ) {
        if (toCall === 0) return { a: 'check' };
        return { a: 'call' };
      }
      // ═══ POT LIMIT OPENS POT (Dan 2026-09-03) ═══ The sizer below is a
      // NO-LIMIT sizer — see the PLO_MIN_OPEN_BB header for the 40,232-open
      // measurement that found it running the pot-limit games. Under pot
      // limit the open is the pot, floored so a min-raise open cannot be
      // produced at all. `potRaiseTo` already carries the straddle, the
      // antes, the dead blinds and one pot's worth per limper, so none of
      // the no-limit sizer's adjustments have anything left to add.
      if (ctx.isPotLimit) {
        return {
          a: 'raiseTo',
          to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand, PLO_MIN_OPEN_BB * openUnit),
        };
      }
      // ═══ NLH OPEN SIZES (Dan 2026-10-31, BINDING) ═══ "OPENING RANGES
      // SHOULD BE RANDOMLY DONE, MIN RAISE TO 2.5-4X OPENING RANGES. NOT
      // ALWAYS THE MINIMUM RAISE POSSIBLE". The V28 ladder that stood here
      // (2.2-3.0bb, 2.05-2.40 with an ante, -0.15 late, x a 0.88-1.12 dial)
      // landed a large share of its draws under the 2bb minimum, and the
      // whole-chip snap in legalize floored every 2.0-2.99bb draw at a
      // 1-chip big blind to a min-raise. HorseNlhOpenSize now draws the open
      // from a band chosen by seat, table, format, depth and antes (with the
      // short-stack ceilings). The draw never reads the cards: open size is
      // not a tell.
      // V18: in a straddled pot the open is sized off the straddle.
      if (ctx.nlhOpenSizes === false) {
        // The explicit off arm: the V28 ladder exactly as it stood, kept only
        // so the recorded corpora keep meaning what they meant.
        let baseOpen = 2.2 + rand() * 0.8;
        if (ctx.anteInPlay) baseOpen = 2.05 + rand() * 0.35;
        else if (stackBB <= 25) baseOpen = 2.0 + rand() * 0.4;
        else if (ctx.mode === 'cash' && stackBB > 150) baseOpen = 2.5 + rand() * 0.8;
        if (position === 'late') baseOpen -= 0.15;
        else if (v70Open && bvb && !trueHu && !ctx.anteInPlay && stackBB > 25) {
          baseOpen = 2.8 + rand() * 0.4;
        }
        return { a: 'raiseTo', to: (baseOpen + limpers * 1.0) * ctx.sizingMultiplier * openUnit };
      }
      return {
        a: 'raiseTo',
        receipt: 'v74_nlh_open_size',
        to: nlhOpenRaiseTo({
          seat: nlhOpenSeat({ position, isButton: ctx.isButton, trueHeadsUp: trueHu }),
          depthBB: straddleActiveCash
            ? Math.min(stackBB / straddleRatio, straddleEffectiveBB)
            : Math.min(stackBB, ctx.effectiveStackBB ?? stackBB),
          tournament: isTourney,
          anteInPlay: ctx.anteInPlay === true,
          tableSize: ctx.tableSize ?? 6,
          cashAction: ctx.cashActionSizes === true,
          openUnit,
          bigBlind: bb,
          limpers,
          sizingMultiplier: ctx.sizingMultiplier,
          rand,
        }),
      };
    }
    // BvB limp mix from the SB with playable-but-not-open hands.
    // V70: the band is read on the small blind's own order, down to its floor.
    const sbLimpFloor = v70Open ? ctx.gtoOpen!.sbLimpFloor : 0.22;
    if (bvb && toCall > 0 && toCall <= openUnit && openStrength >= sbLimpFloor && rand() < 0.75) {
      return { a: 'call' };
    }
    if (toCall === 0) return { a: 'check' };

    // ── NO OPEN-LIMP: first in, it is raise or fold (Dan 2026-08-30) ───────
    //
    // Two branches used to call here. One limped anything within 0.12 of the
    // opening bar 70% of the time; the other limped ANY hand of strength
    // >= 0.3 for up to 1.5bb, from any position, unconditionally. Neither
    // asked whether a single player had actually limped first, so both
    // OPENED pots by calling - the play that fed the 91.5% limp-fold rate
    // measured above the price-in guard.
    //
    // Limping BEHIND survives, because real players do it, under two rules
    // that make it honest:
    //   - somebody must have limped first, so this can never open a pot; and
    //   - the hand must be able to CONTINUE against a raise. Anything weaker
    //     is limping in order to fold, which is the whole disease.
    // Because a hand at or above the opening bar RAISES, the surviving band
    // is [LIMP_BEHIND_MIN, openThresh) - empty in late position until several
    // limpers widen it. Late position isolating limpers instead of joining
    // them is correct, and the V10 isolation layer above already does it.
    const omahaLimpDiscipline87 =
      ctx.v87DeepDiveDiscipline === true &&
      ctx.isOmaha === true &&
      !ctx.omahaHiLo &&
      ((ctx.omahaHoleCount ?? 4) >= 6 || limpers >= 2);
    const omahaLimpTighten87 = omahaLimpDiscipline87
      ? (ctx.omahaHoleCount === 6 ? 0.07 : ctx.omahaHoleCount === 5 ? 0.04 : 0) +
        Math.min(2, Math.max(0, limpers - 1)) * 0.02
      : 0;
    if (ctx.v87DeepDiveDiscipline === true)
      noteHorseDeepDiveRule('limp_bar', omahaLimpDiscipline87, omahaLimpDiscipline87);
    const canLimpBehind =
      limpers >= 1 &&
      strength >= phase6CapBar(LIMP_BEHIND_MIN + omahaLimpTighten87 + phase6Shift('call'));
    const limpable = strength >= openThresh - (omahaLimpDiscipline87 ? 0.06 : 0.12);
    // V28 AUDIT FIX: `|| position === 'sb'` short-circuited the strength test
    // entirely — the SB completed with ANY two cards 70% of the time and was
    // play-visible as "the small blind never folds". The SB still completes
    // wider than other seats, but from a real range. It is now also subject
    // to the limpers-first rule: with the pot unopened, the small blind has
    // the big blind still to act behind it, so completing is an open-limp
    // like any other.
    const sbCompletable =
      position === 'sb' && strength >= openThresh - (omahaLimpDiscipline87 ? 0.14 : 0.22);
    if (canLimpBehind && toCall <= openUnit && (limpable || sbCompletable) && rand() < 0.7) {
      return { a: 'call' };
    }
    if (
      omahaLimpDiscipline87 &&
      limpers >= 1 &&
      toCall <= openUnit &&
      strength >= phase6CapBar(LIMP_BEHIND_MIN + phase6Shift('call')) &&
      (strength >= openThresh - 0.12 || (position === 'sb' && strength >= openThresh - 0.22))
    ) {
      ctx.noteLayer?.('v87_deep_dive_discipline');
    }
    return { a: 'fold' };
  }

  // ── Facing a single raise ──
  if (raises === 1) {
    const vs = raiserPosition ?? 'middle';
    // V72: one open, nobody in, hold'em - the defence is the (defender,
    // opener seat) reference base from HorseGtoDefenceRanges, and every layer
    // below moves it the way it moved the bucketed base.
    // V85: on a cash table the same base also answers an open that has been
    // called (squeeze, overcall, the multiway big blind).
    const def72Base =
      ctx.gtoDefend !== undefined &&
      (callers === 0 || ctx.gtoDefend.cashAction === true || (unblocked86 && callers >= 1)) &&
      !ctx.isOmaha
        ? ctx.gtoDefend
        : null;
    // V87 MULTIWAY LOW-STAKES DEFENCE (owner direction 2026-11-10 22:48
    // Chicago, HorseGtoDefenceRanges.V87_MULTIWAY_DEFENCE): wider flats,
    // wider overcalls behind a caller and more 3-bets against one open, on
    // the same (defender, opener seat) order. Cash tapers with the V85 depth
    // weight (50bb or less exactly the prior bars) and widens most at a big
    // blind of 2 or less; tournaments take a reduced share from 30bb up.
    // Pure arithmetic on the bars: no draw is added or removed here.
    const def87Weight = (() => {
      if (
        !v87 ||
        !noLimitHoldem ||
        def72Base === null ||
        headsUp ||
        ctx.maniacOpenBar !== undefined ||
        ctx.maniacNoBluff === true ||
        ctx.exploitOpener?.noBluffThreeBet === true
      ) {
        return 0;
      }
      if (ctx.mode === 'cash') {
        return def72Base.cashAction === true ? v85DepthWeight(straddleEffectiveBB) : 0;
      }
      if (isTourney && ctx.satellite === undefined) {
        const eff = ctx.effectiveStackBB ?? stackBB;
        return V87_MULTIWAY_DEFENCE.tournamentWeight * Math.max(0, Math.min(1, (eff - 30) / 15));
      }
      return 0;
    })();
    const def72 =
      def72Base !== null && def87Weight > 0
        ? {
            ...def72Base,
            ...v87WidenDefence(def72Base, {
              defender: def72Base.defender,
              callers,
              lowStakes: ctx.mode === 'cash' ? v87LowStakesWeight(ctx.cashStakeBB ?? bb) : 0,
              weight: def87Weight,
              dealt: ctx.tableSize ?? 6,
            }),
          }
        : def72Base;
    const def85 = def72 !== null && (def72.cashAction === true || (unblocked86 && callers >= 1));
    let threeBetThresh =
      t53((def72 ? def72.valueBar : THREEBET_VS[vs]) - (ctx.aggression - 1) * 0.08, 'threeBet') +
      vs35.threeBet +
      phase6Shift('threeBet');
    // V24: a CALL of a single raise continues the hand, it does not commit
    // the stack - so it carries the price-scaled survival premium (tCall),
    // not the full one. See the note on riskScaled above.
    let callThresh =
      tCall53(def72 ? def72.continueBar : CALL_VS[vs]) +
      // V85: the multiway width is already the base's (wider for the big
      // blind, a shade narrower for an overcall).
      (def85 ? 0 : callers * 0.025) +
      depthTighten -
      depthLoosen +
      vs35.coldCall +
      phase6Shift('call');

    // Blinds facing a LATE steal prefer 3-bet-or-fold over cold-calling
    // out of position: shift part of the call band into the 3-bet.
    // (V74: inside the per-seat reference base.)
    const blindVsSteal = (position === 'sb' || position === 'bb') && vs === 'late';
    if (blindVsSteal && !def72) {
      threeBetThresh =
        t53(0.7 - (ctx.aggression - 1) * 0.08, 'threeBet') +
        vs35.threeBet +
        phase6Shift('threeBet');
      callThresh += position === 'sb' ? 0.05 : 0;
    }
    // V11 HEADS-UP DEFENSE: the SB/BTN opens most hands HU, so the BB defends
    // the wide majority — folding 50%+ of hands to a HU open is pure surrender.
    // (V74 owns blind against blind at three or more dealt in.)
    if (headsUp && position === 'bb' && !def72) {
      threeBetThresh =
        t53(0.64 - (ctx.aggression - 1) * 0.08, 'threeBet') +
        vs35.threeBet +
        phase6Shift('threeBet');
      callThresh = t53(0.3, 'call') + vs35.bbDefend + phase6Shift('call');
    }
    // V11 TOURNAMENT MID-STACK (16-25bb): flatting raises OOP torches stack
    // utility — shift the marginal-call band into 3-bet-or-fold.
    if (isTourney && stackBB > 12 && stackBB <= 25 && !ctx.isOmaha && !headsUp) {
      threeBetThresh = Math.min(threeBetThresh, t(0.72 - anteWiden));
      callThresh += 0.05;
    }
    // League calibration arm (2026-10-30, tournament flats of an open measured
    // -8.7 bb a hand on 54 human-seated hands): tighten the flat of a single
    // open by a stated amount; the 3-bet bar does not move.
    if (
      isTourney &&
      callers === 0 &&
      !ctx.isOmaha &&
      typeof ctx.tournamentFlatBump === 'number' &&
      ctx.tournamentFlatBump > 0 &&
      ctx.tournamentFlatBump <= 0.2
    ) {
      callThresh += ctx.tournamentFlatBump;
    }
    // V12 ANTI-EXPLOIT: this raiser is hunting the horse — their opens carry
    // less real strength than the position suggests, so re-raise more and
    // defend wider until the hunt stops paying.
    const hunted = Math.max(0, Math.min(1, ctx.targeted ?? 0));
    if (hunted > 0) {
      threeBetThresh -= 0.05 * hunted;
      callThresh -= 0.04 * hunted;
    }
    // 2026-10-16 OPPONENT EXPLOIT: this opener's raises are priced by what
    // THEY raise, not by their seat. Against a wide opener the value 3-bet
    // and the flat both widen to the top of their actual range; against a
    // credible nit the 3-bet narrows. Absent read = no change at all.
    const vsOpener = ctx.exploitOpener;
    if (vsOpener) {
      if (vsOpener.threeBetBar !== null) {
        const bar = t53(vsOpener.threeBetBar, 'threeBet');
        threeBetThresh = vsOpener.wide
          ? Math.min(threeBetThresh, bar)
          : Math.max(threeBetThresh, bar);
      }
      const flat = position === 'bb' ? vsOpener.bbFlatBar : vsOpener.flatBar;
      if (flat !== null) callThresh = Math.min(callThresh, tCall53(flat));
    }
    if (
      ctx.v87DeepDiveDiscipline === true &&
      ctx.isOmaha === true &&
      !ctx.omahaHiLo &&
      ctx.evidencedWideRaiser !== true
    ) {
      const bump87 = v87OmahaColdCallTighten(ctx.omahaHoleCount, position, callers, stackBB);
      noteHorseDeepDiveRule('cold_call_bar', bump87 > 0, bump87 > 0);
      if (bump87 > 0) {
        callThresh += bump87;
        ctx.noteLayer?.('v87_deep_dive_discipline');
      }
    }
    const noBluff3 = vsOpener?.noBluffThreeBet === true;
    // 2026-10-24 V53 PRESSURE: heads-up against a credibly wide opener, the
    // top of the flatting range 3-bets instead (measured: horses that 3-bet
    // WooWoo won 61 of 101 such pots, horses that flatted won 176 of 420).
    // Hero is in position unless hero is a blind facing a non-blind opener.
    const pressure = callers === 0 ? ctx.exploitPressure : undefined;
    const pressureIp = position !== 'sb' && (position !== 'bb' || vs === 'sb');
    if (pressure) {
      threeBetThresh = Math.min(
        threeBetThresh,
        t(pressureIp ? pressure.ipThreeBetBar : pressure.oopThreeBetBar)
      );
      if (unblocked86 && !pressureIp && ctx.isOmaha) {
        callThresh += 0.03;
      }
    }
    // TOURNAMENT AGGRESSION: re-raise ranges stated as hand shares (the
    // holdemPreflopScore scale: 0.5 = top 19.8%, 0.62 ~ 11.5%, 0.65 = 10.9%),
    // against the opener's real width. A steal is re-stolen hard from the
    // small blind, widely from the button and big blind; early opens a
    // little wider than before. t() still carries the ICM premium.
    if (tAggro) {
      const steal = vs === 'late' || vs === 'sb';
      const aggroBar =
        position === 'sb'
          ? steal
            ? 0.5
            : 0.66
          : position === 'bb'
            ? steal
              ? 0.62
              : 0.7
            : position === 'late'
              ? steal
                ? 0.65
                : 0.72
              : null;
      // V74: these bars were this layer's per-bucket 3-bet WIDTHS and the
      // per-seat reference base replaces them, except against a steal (a
      // late or small-blind open), where Dan's tournament re-steal stays a
      // floor under the base: measured on the MTT 25bb mirror over three
      // seeds, -0.80 +/- 0.53 bb/100 without it and -0.12 +/- 0.47 with it.
      // The re-steal volume and the flat widening below stay as deviations.
      if (def72) {
        if (aggroBar !== null && steal) {
          // At six/full-ring NLH, shift the strongest calls into re-steals.
          // SB already has the wide 3-bet-or-fold band; keep it. The same
          // survival premium still prices every candidate through t().
          const actionShift =
            (ctx.tableSize === 6 || ctx.tableSize === 9) && position !== 'sb' ? 0.02 : 0;
          threeBetThresh = Math.min(threeBetThresh, t(aggroBar - actionShift));
        }
      } else if (aggroBar !== null) threeBetThresh = Math.min(threeBetThresh, t(aggroBar));
      else threeBetThresh -= 0.03;
      if (position === 'late' && stackBB >= 25) callThresh -= 0.03;
    } else if (tAggroPlo && (vs === 'late' || vs === 'sb')) {
      threeBetThresh -= 0.04;
      if (position === 'late' || position === 'bb') callThresh -= 0.02;
    }
    // CASH PRESSURE: value 3-bet bars as hand shares against the opener's
    // width (same scale as the tournament bars above: 0.56 ~ top 15%,
    // 0.64 ~ 11%, 0.70 ~ 9%, 0.76 ~ 6%). The blinds re-steal a late open
    // rather than flat it out of position; the button and cutoff 3-bet a
    // late open from the top 11%, a middle open from the top 9% and an
    // early open from the top 6%. The exploit, pressure and heads-up layers
    // above keep every bar they already lowered.
    if (cAggro && !headsUp && callers === 0) {
      const steal = vs === 'late' || vs === 'sb';
      const cashBar =
        position === 'sb'
          ? steal
            ? 0.56
            : 0.7
          : position === 'bb'
            ? steal
              ? 0.64
              : 0.74
            : position === 'late'
              ? vs === 'early'
                ? 0.76
                : steal
                  ? 0.64
                  : 0.7
              : null;
      // The V12 hunter discount still applies below the cash bar.
      // V74: as in the tournament layer, the per-seat base owns the width.
      // Receipt (#8694): applied when the V60 bar moved the 3-bet width;
      // superseded when the V74 base or an earlier lower bar kept it.
      if (def72) {
        /* the V74 base owns the 3-bet width */
        ctx.noteLayer?.('v60_cash_pressure_facing_open_superseded');
      } else if (cashBar !== null) {
        const beforeV60 = threeBetThresh;
        threeBetThresh = Math.min(threeBetThresh, t(cashBar) - 0.05 * hunted);
        ctx.noteLayer?.(
          threeBetThresh !== beforeV60
            ? 'v60_cash_pressure_facing_open'
            : 'v60_cash_pressure_facing_open_superseded'
        );
      } else {
        threeBetThresh -= 0.03;
        ctx.noteLayer?.('v60_cash_pressure_facing_open');
      }
    }
    if (v87 && isTourney && noLimitHoldem && ctx.satellite?.locked !== true) {
      const bp3 = Math.max(0, Math.min(1, ctx.bubblePressure ?? 0));
      if (bp3 > 0) {
        threeBetThresh -= 0.065 * bp3;
      } else if (ctx.riskAdd >= 0.06 && stackBB >= 16 && stackBB <= 38) {
        callThresh += 0.035;
      }
      const bf3 = Math.max(0, Math.min(1, ctx.bountyFactor ?? 0));
      if (bf3 > 0 && ctx.coversRaiser === true) {
        threeBetThresh -= Math.min(0.05, bf3 * 0.12);
      }
    }
    if (unblocked86) {
      if (typeof ctx.coverBubblePressure === 'number' && ctx.coverBubblePressure !== 0) {
        const cov = Math.max(-1, Math.min(1, ctx.coverBubblePressure));
        threeBetThresh -= 0.04 * cov;
        callThresh -= 0.03 * cov;
      }
      if (
        !isTourney &&
        !ctx.isOmaha &&
        typeof ctx.sevenDeuceBonus === 'number' &&
        ctx.sevenDeuceBonus > 0
      ) {
        callThresh -= Math.min(0.28, ctx.sevenDeuceBonus * 0.65);
      }
    }
    threeBetThresh = phase6CapBar(threeBetThresh);
    callThresh = phase6CapBar(callThresh);
    const bbDiscount =
      position === 'bb' || (unblocked86 && ctx.heroPriorAction === 'post_straddle_or_kill')
        ? 0.06
        : 0;
    const priceOK =
      toCall <= Math.max(bb * 12, stack * 0.12) ||
      (unblocked86 && guardOdds <= (ctx.isOmaha ? 0.34 : 0.28) && toCall <= stack * 0.25);
    const heroLimpedEarlier =
      unblocked86 && (ctx.heroPriorAction === 'limp' || ctx.heroPriorAction === 'complete_sb');
    const tourney3betTrim = isTourney && stackBB <= 40 ? 0.5 : 0;
    const cashThreeBet = (): PreflopIntent | null => {
      if (
        ctx.mode !== 'cash' ||
        !ctx.cashThreeBetSizing ||
        ctx.isOmaha ||
        ctx.isPotLimit ||
        ctx.isFixedLimit ||
        ctx.isShortDeck
      )
        return null;
      return {
        a: 'raiseTo',
        receipt: 'cash_nlh_three_bet_size',
        to: cashNlhThreeBetRaiseTo({
          ...ctx.cashThreeBetSizing,
          openTo: currentBet,
          bigBlind: bb,
          callers,
          rand,
        }),
      };
    };

    // V16 PLO POLARITY: percentile strength double-counts pretty side cards;
    // real PLO 3-bet ranges are anchored on AAxx. With the layer on, AA
    // 3-bets from 0.04 under the generic bar, and a non-AA hand at the exact
    // margin (within 0.05 over the bar) FLATS instead — rundowns want
    // multiway flops in position, not bloated pots against the one range
    // that dominates them.
    let effThreeBetThresh = threeBetThresh;
    if (ctx.isOmaha && ctx.omahaAA === true) effThreeBetThresh = threeBetThresh - 0.04;
    const ipVsOpen = position === 'late' || (vs === 'sb' && position === 'bb');
    const elite = v86 && ctx.isOmaha ? ctx.omahaElite : undefined;
    const linearElite3Bet =
      elite !== undefined &&
      (elite.cls === 'aa_ds' ||
        elite.cls === 'kk_ds' ||
        elite.cls === 'plo8_scoop' ||
        elite.cls === 'broadway_conn_ds' ||
        elite.cls === 'rundown_ds' ||
        elite.cls === 'ax_nut_suited');
    const ultraPremiumElite =
      elite !== undefined &&
      (elite.cls === 'aa_ds' || elite.cls === 'kk_ds' || elite.cls === 'plo8_scoop');
    // Sticky wide openers with low fold-to-3-bet (`noBluff3 === true`) and presumed/wide
    // PLO openers (`maniacNoBluff` from pfr >= 35%) still get 3-bet and squeezed for
    // linear equity by high-playability double-suited / nut-suit hands; thinner
    // single-suited rundowns and pair+support stay gated behind `!noBluff3`.
    const allowEliteVsRaiser =
      ultraPremiumElite ||
      (linearElite3Bet &&
        ctx.observedExtremeManiac !== true &&
        (ctx.maniacNoBluff !== true ||
          (noBluff3 && ((ctx.omahaHoleCount ?? 4) <= 4 || callers >= 1)) ||
          strength >= 0.62)) ||
      (ctx.maniacNoBluff !== true && !noBluff3);
    const basePloMix = ctx.ploPersona3BetMix ?? 0.55;
    const rawPloMix = pressure
      ? Math.min(0.96, basePloMix + 0.35)
      : ipVsOpen
        ? Math.min(0.92, basePloMix + 0.18)
        : basePloMix;
    const effPloMix = noBluff3 && linearElite3Bet ? Math.min(0.96, rawPloMix + 0.15) : rawPloMix;
    const ploElite3BetActive =
      elite !== undefined &&
      elite.canThreeBet &&
      allowEliteVsRaiser &&
      (elite.cls === 'aa_ds' || elite.cls === 'plo8_scoop' || (ctx.plo3BetRoll ?? 0.4) < effPloMix);
    if (ploElite3BetActive && elite) {
      const bonus =
        elite.cls === 'aa_ds' || elite.cls === 'plo8_scoop'
          ? 0.16
          : elite.cls === 'broadway_conn_ds' || elite.cls === 'rundown_ds'
            ? ipVsOpen
              ? 0.14
              : 0.09
            : elite.cls === 'kk_ds' || elite.cls === 'ax_nut_suited'
              ? ipVsOpen
                ? 0.11
                : 0.07
              : ipVsOpen || pressure !== undefined
                ? 0.06
                : 0;
      effThreeBetThresh = Math.min(effThreeBetThresh, Math.max(0.46, threeBetThresh - bonus));
    }
    const premiumValue =
      priceOK &&
      (ctx.holdemPremiumPair === true ||
        (ctx.isOmaha &&
          (ctx.omahaSuitedPremium === 'aces' ||
            (ctx.omahaSuitedPremium === 'kings' && vsOpener?.wide !== false) ||
            (ploElite3BetActive && elite?.cls === 'plo8_scoop'))));
    const noteAuthority = (branch: PreflopAuthorityEvent['branch']) =>
      ctx.noteAuthority?.({
        branch,
        strength,
        threeBetThreshold: threeBetThresh,
        effectiveThreeBetThreshold: effThreeBetThresh,
        premiumValue,
        pressure: Boolean(pressure),
      });
    if (premiumValue || strength >= effThreeBetThresh) {
      // ═══ V46 (2026-09-05) ═══ a rundown, a broadway hand and a dangler
      // FLAT. This is the thing a bar cannot say: those hands want a cheap
      // multiway flop, and widening or narrowing their 3-bet threshold does
      // the opposite of what the hand wants either way. The price still has
      // to be a flatting price - past that the bars decide as before.
      // V86: double-suited rundowns, connected broadways, suited-Ax nut
      // bridges, and PLO8 scoop hands take pot control by 3-betting instead
      // of passively flatting every open.
      if (
        !premiumValue &&
        !pressure &&
        !ploElite3BetActive &&
        ctx.classNeverThreeBet === true &&
        toCall <= ctx.stack * 0.12
      ) {
        noteAuthority('v46_class_flat');
        return { a: 'call' };
      }
      const ip = position === 'late' || ctx.isButton === true || (vs === 'sb' && position === 'bb');
      const omahaContextual3Bet =
        unblocked86 &&
        ctx.observedExtremeManiac !== true &&
        ((ip && vs !== 'early') ||
          callers >= 1 ||
          (ctx.omahaNutSuits ?? 0) >= 1 ||
          ctx.omahaTripleSuited === true ||
          stackBB <= 55);
      if (
        ctx.isOmaha &&
        ctx.omahaAA === false &&
        !premiumValue &&
        ctx.observedExtremeManiac === true &&
        strength < effThreeBetThresh + 0.08 &&
        toCall <= ctx.stack * 0.15
      ) {
        noteAuthority('v16_non_aa_flat');
        return { a: 'call' };
      }
      if (
        ctx.isOmaha &&
        ctx.omahaAA === false &&
        !premiumValue &&
        !pressure &&
        !omahaContextual3Bet &&
        !ploElite3BetActive &&
        strength < threeBetThresh + (unblocked86 ? 0.03 : 0.05) &&
        toCall <= ctx.stack * 0.08
      ) {
        noteAuthority('v16_non_aa_flat');
        return { a: 'call' }; // OOP deep non-nut-suited margin: take the flop instead
      }
      if (
        strength > 0.95 &&
        rand() < ctx.slowplayFreq * 0.5 &&
        callers === 0 &&
        !(unblocked86 && ctx.isOmaha) &&
        (!unblocked86 || position === 'late' || ctx.isButton === true)
      ) {
        noteAuthority('value_trap');
        return { a: 'call' }; // trap (IP hold'em / non-Omaha only)
      }
      noteAuthority(premiumValue ? 'premium_value' : 'strength_value');
      // V35: a tournament 3-bet at 40bb or less is smaller (2.5x in position,
      // ~3.2x out) — the stack behind it is what makes the size, and a cash
      // 3.8x from a 30bb stack is a third of it. Solver MTT 3-bets sit at
      // 2.3-2.6x IP / 3-3.5x OOP at those depths.
      // Pot limit: a PLO 3-bet is a pot raise. The multiplier below is a
      // no-limit shape — out of position it asks for more than the pot and is
      // clamped down to it, in position it asks for 2.5-3.0x and LANDS under
      // it, which is where the 2.5x-open pots Dan flagged kept getting built
      // cheaply. Sizing to the ceiling makes both cases the same number, and
      // the number the game actually allows.
      if (ctx.isPotLimit) {
        return {
          a: 'raiseTo',
          to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand),
          ...(ploElite3BetActive && ctx.omahaAA !== true
            ? { receipt: 'v86_plo_elite_three_bet' as const }
            : {}),
        };
      }
      const cashSize = cashThreeBet();
      if (cashSize) return cashSize;
      const mult = (ip ? 3.0 : 3.8) - tourney3betTrim + callers * 1.0 + rand() * 0.4;
      return { a: 'raiseTo', to: currentBet * mult * ctx.sizingMultiplier };
    }

    // V86 PLO POT SQUEEZE: raiser + caller(s) create dead money that double-suited
    // rundowns, connected broadways, nut-suited Ax, and PLO8 scoop hands attack.
    if (
      v86 &&
      callers >= 1 &&
      ctx.isOmaha &&
      ctx.isPotLimit &&
      elite?.canSqueeze === true &&
      strength >= t53(0.54, 'threeBet') &&
      allowEliteVsRaiser &&
      (pressure !== undefined ||
        (noBluff3 && linearElite3Bet) ||
        (ctx.plo3BetRoll ?? 0.4) < Math.min(0.9, basePloMix + (ipVsOpen ? 0.2 : 0.1)))
    ) {
      noteAuthority('squeeze_bluff');
      return {
        a: 'raiseTo',
        to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand),
        receipt: 'v86_plo_squeeze',
      };
    }

    // V7 SQUEEZE BLUFF: raiser + caller(s) — attack the capped caller range.
    // In Omaha, semi-bluff squeezes require nut-suit / Ace-blocker equity.
    const omahaSqueezeAllowed =
      unblocked86 && (ctx.holdsAce === true || (ctx.omahaNutSuits ?? 0) >= 1);
    if (
      callers >= 1 &&
      !def85 &&
      !heroLimpedEarlier &&
      strength >= t(ctx.isOmaha ? 0.62 : 0.55) &&
      strength < threeBetThresh &&
      (!ctx.isOmaha || omahaSqueezeAllowed) &&
      !noBluff3 &&
      ctx.maniacNoBluff !== true &&
      rand() < bluffBudget * (ctx.isOmaha ? 0.22 : 0.3) * blockerMult &&
      // The same test as the 3-bet bluff below, after the draw.
      bluffRaiseHasFoldEquity(toCall, stack, ctx)
    ) {
      noteAuthority('squeeze_bluff');
      if (ctx.isPotLimit) {
        return { a: 'raiseTo', to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand) };
      }
      // V28 AUDIT FIX: the bluff squeeze was sized 4.0-5.5x with no IP/OOP
      // split while the VALUE squeeze was 3.0-4.2x — the bluff was strictly
      // BIGGER than the value raise at every caller count, a directly
      // observable sizing tell (fold to the big one, call the small one).
      // Bluffs now mirror the value sizing shape, a shade under it.
      const ipSq = position === 'late';
      const cashSize = cashThreeBet();
      if (cashSize) return cashSize;
      const mult = (ipSq ? 2.9 : 3.7) - tourney3betTrim + callers * 1.0 + rand() * 0.4;
      return { a: 'raiseTo', to: currentBet * mult * ctx.sizingMultiplier };
    }

    // V7 3-BET BLUFF: no callers, right position, mid-strength hands.
    // Wider vs late opens and from the blinds (re-steal).
    const bluffFloor =
      (blindVsSteal ? 0.48 : 0.55) -
      (v86 && !ctx.isOmaha && !def72 && ctx.holdsAce === true && position === 'late' ? 0.04 : 0);
    // V16: scale the bluff 3-bet by what THIS raiser actually does against
    // 3-bets. 0.6 + f3b maps a 70% folder to x1.3 and a 20% folder to x0.8,
    // clamped so a read can reshape but never zero out the mix.
    const f3bRead = ctx.raiserFoldTo3Bet;
    const f3bScale = typeof f3bRead === 'number' ? Math.max(0.7, Math.min(1.45, 0.6 + f3bRead)) : 1;
    const bluffFreqHere =
      (blindVsSteal ? 0.5 : vs === 'late' ? 0.45 : 0.3) *
      bluffBudget *
      f3bScale *
      blockerMult *
      // V37: a covered raiser near the bubble folds to the 3-bet far more.
      (1 + 0.5 * Math.max(0, Math.min(1, ctx.bubblePressure ?? 0))) *
      // TOURNAMENT AGGRESSION: more re-steals.
      (tAggro ? 1.3 : 1) *
      // CASH PRESSURE: the same re-steal volume in cash.
      (cAggro ? 1.3 : 1);
    // V74: the bluffs are the reference bluff chart's classes at its own
    // frequencies (scaled to the spot's bluff width), moved by everything that
    // moved the legacy mix: style (the bluff budget against a balanced
    // horse's), this raiser's fold-to-3-bet read, the bubble, V57/V60. The
    // blocker multiplier is not applied - the chart is built on blockers.
    const bluff72 = def72
      ? def72.bluffProb *
        Math.max(0.4, Math.min(1.8, bluffBudget / BALANCED_BLUFF_BUDGET)) *
        f3bScale *
        (1 + 0.5 * Math.max(0, Math.min(1, ctx.bubblePressure ?? 0))) *
        (tAggro ? 1.3 : 1) *
        (cAggro ? 1.3 : 1)
      : 0;
    if (
      // V85: the squeeze bluffs are the same chart classes, at the squeeze width.
      (callers === 0 || def85) &&
      !heroLimpedEarlier &&
      (def72
        ? bluff72 > 0 && strength < threeBetThresh
        : strength >= t53(bluffFloor, 'threeBet') && strength < threeBetThresh) &&
      !noBluff3 &&
      ctx.maniacNoBluff !== true &&
      rand() < (def72 ? bluff72 : bluffFreqHere) &&
      // Tested after the draw so the random stream is unchanged.
      bluffRaiseHasFoldEquity(toCall, stack, ctx)
    ) {
      noteAuthority('three_bet_bluff');
      if (ctx.isPotLimit) {
        return { a: 'raiseTo', to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand) };
      }
      const ip = position === 'late';
      const cashSize = cashThreeBet();
      if (cashSize) return cashSize;
      const mult = (ip ? 3.0 : 3.8) - tourney3betTrim + rand() * 0.4;
      return { a: 'raiseTo', to: currentBet * mult * ctx.sizingMultiplier };
    }

    // ═══ V24 OMAHA PRICE DEFENSE (Dan 2026-08-28) ═══════════════════════
    // PLO equities are COMPRESSED: the worst four cards hold roughly 30%
    // against the best, where the worst two hold about 12% in holdem. A bar
    // tuned in NLH percentile space therefore folds hands that are getting a
    // fine price.
    //
    // THE ARITHMETIC, STATED HONESTLY (the first cut of this comment got it
    // wrong and the test caught it). A pot-sized PLO open to 3.5bb builds a
    // 5bb pot, so:
    //   - a COLD CALLER puts in 3.5 to win 8.5  -> 0.41, needs 41% equity.
    //     Folding a lot there is CORRECT; pot-raise pots are not cheap.
    //   - the BIG BLIND already has 1bb in, so it puts in 2.5 to win 7.5
    //     -> 0.33, and folding 70% of hands to that price is a real leak.
    // The relief below therefore scales with how far the price sits below
    // even money: the blind gets a lot of it, a cold caller gets a little.
    // Nothing in NLH changes - there the equity spread is real, and a fixed
    // percentile means what it says.
    // V74: the continue bar is already the big blind's own width.
    let callBar = callThresh - (def72 ? 0 : bbDiscount);
    const bounds87 =
      ctx.v87DeepDiveDiscipline === true &&
      ctx.isOmaha === true &&
      !ctx.omahaHiLo &&
      ctx.evidencedWideRaiser !== true &&
      ((ctx.omahaHoleCount ?? 4) >= 6 || callers >= 1)
        ? v87OmahaCallBarBounds(ctx.omahaHoleCount, position, callers)
        : null;
    if (ctx.isOmaha && ctx.ploPriceDefense === true) {
      const odds = preflopCallOdds(ctx, pricePot, Math.min(toCall, stack));
      const rawRelief = Math.max(0, 0.5 - odds); // BB ~0.17, cold call ~0.09
      const priceRelief = bounds87 ? Math.min(bounds87.maxPriceRelief, rawRelief) : rawRelief;
      if (ctx.v87DeepDiveDiscipline === true)
        noteHorseDeepDiveRule(
          'price_relief',
          bounds87 !== null,
          bounds87 !== null && priceRelief < rawRelief
        );
      if (bounds87 && priceRelief < rawRelief) ctx.noteLayer?.('v87_deep_dive_discipline');
      callBar -= priceRelief;
    }

    // ═══ V24 BOUNTY PULL (PKO / mystery) ════════════════════════════════
    // A bounty is prize money attached to a PLAYER, and it is collected by
    // busting them. That makes pots against a covered opponent worth more
    // than their chips - the exact reason PKO play is looser than a
    // freezeout - and the brain had NO preflop bounty adjustment at all.
    const bf = Math.max(0, Math.min(1, ctx.bountyFactor ?? 0));
    let v24BountyDisc = 0;
    if (bf > 0 && ctx.coversRaiser === true) {
      // Covering means hero's own bounty is never at risk in this pot.
      v24BountyDisc += Math.min(0.06, bf * 0.14);
      if (v87 && !ctx.isOmaha) v24BountyDisc += Math.min(0.03, bf * 0.06);
      // If the raiser can actually be eliminated here, the bounty is live
      // this hand rather than theoretical.
      if (ctx.raiserBustable === true) v24BountyDisc += Math.min(0.05, bf * 0.12);
    }
    const v86BountyDisc =
      unblocked86 &&
      ctx.coversRaiser === true &&
      typeof ctx.bountyOverlayBB === 'number' &&
      ctx.bountyOverlayBB > 0
        ? Math.min(0.08, ctx.bountyOverlayBB * 0.015)
        : 0;
    callBar -= Math.max(v24BountyDisc, v86BountyDisc);

    // A floor, applied after every discount: hands that flop nothing are a
    // fold at any price, and a bounty is not a licence to play four napkins.
    if (ctx.isOmaha && ctx.ploPriceDefense === true) {
      const baseFloor = unblocked86 && pressure && !pressureIp ? 0.34 : 0.28;
      const floor87 = bounds87 ? Math.max(bounds87.callFloor, baseFloor) : baseFloor;
      if (bounds87 && callBar < bounds87.callFloor && callBar >= baseFloor) {
        ctx.noteLayer?.('v87_deep_dive_discipline');
      }
      if (ctx.v87DeepDiveDiscipline === true)
        noteHorseDeepDiveRule(
          'call_floor',
          bounds87 !== null,
          bounds87 !== null && Math.max(floor87, callBar) > Math.max(baseFloor, callBar)
        );
      callBar = Math.max(floor87, callBar);
    }
    callBar = phase6CapBar(callBar);

    if ((def72 ? def72.strength : strength) >= callBar && priceOK) return { a: 'call' };
    // HU BB DEFENDS TO ITS PRICE (flag huBbDefendsToPrice, default off): the
    // bars above fold ~57% of hands heads-up to a 2.5-3bb open laying 3.2:1.
    // A hand whose equity against the opener's measured range, after the
    // out-of-position realisation discount, covers the price continues.
    // Widen-only: 3-bets and every call above are unchanged.
    if (ctx.huBbPrice && position === 'bb' && callers === 0 && priceOK && toCall > 0) {
      const odds = preflopCallOdds(ctx, pricePot, Math.min(toCall, stack));
      if (ctx.huBbPrice.equity >= huBbRequiredEquity(odds)) {
        return { a: 'call', receipt: 'hu_bb_defends_to_price' };
      }
    }
    if (def72) {
      // V72: the big blind closes the action at the best price of the orbit,
      // so (as the V34 floor below did for the buckets) its defence is its
      // own continue width without the cold-caller depth tighten or the
      // 16-25bb flat-to-3-bet shift; style and the survival premium still
      // apply, and V57's tournament big blind widening stays a deviation.
      // V85: cash opens run to 4.5bb, so the catch reaches the open it faces.
      if (position === 'bb' && toCall <= bb * (def85 ? 3.5 : 2.5)) {
        const bbBar72 = phase6CapBar(
          tCall53(def72.continueBar) -
            (tAggro ? (stackBB <= 25 ? 0.06 : 0.04) : 0) +
            vs35.bbDefend +
            phase6Shift('call')
        );
        if (def72.strength >= bbBar72) return { a: 'call' };
      }
      return { a: 'fold' };
    }
    /**
     * ═══ V34 (2026-09-02): THE BIG BLIND DEFENDS ITS BLIND ═══════════════
     *
     * This price catch is what actually sets the big blind's defence (the
     * CALL_VS bars above it are stricter than 0.3 for every raiser seat), and
     * 0.3 is ~39% of hands on the scale, regardless of who opened. Measured
     * against a 2.5x button open: fold 62%. A solver big blind folds ~40%
     * to that raise and ~30% to a 2.2x ante-tournament open, because the
     * pot is laying 3.4:1 and the button's range is half junk. Folding 62%
     * is the single easiest leak at a table to exploit: min-raise every
     * button.
     *
     * The catch now widens with the RAISER'S position - a steal is defended
     * wider than an under-the-gun open - and with an ante in play. Against
     * early opens 0.3 (~39%) stays: the solver folds ~60% there too.
     *
     *     vs early/middle   0.30  (~39% continue incl. 3-bets)
     *     vs late steal     0.22  (~54%; measured 47% fold vs a 2.5x open)
     *     vs the SB         handled by the heads-up defence above
     *     ante in play      -0.03 on top
     */
    if (position === 'bb' && toCall <= bb * 2.5) {
      const steal = vs === 'late';
      let bbFloor = phase6CapBar(
        (steal ? 0.22 : 0.3) -
          (ctx.anteInPlay ? 0.03 : 0) -
          // TOURNAMENT AGGRESSION: the big blind is getting its best price
          // of the orbit (production: a <=25bb big blind folded 53%).
          (tAggro ? (stackBB <= 25 ? 0.06 : 0.04) : 0) +
          vs35.bbDefend +
          phase6Shift('call')
      );
      if (bounds87) {
        const omahaBbFloor = phase6CapBar(bounds87.callFloor + vs35.bbDefend + phase6Shift('call'));
        noteHorseDeepDiveRule('blind_floor', true, omahaBbFloor > bbFloor);
        if (omahaBbFloor > bbFloor) {
          bbFloor = omahaBbFloor;
          ctx.noteLayer?.('v87_deep_dive_discipline');
        }
      }
      if (strength >= bbFloor) return { a: 'call' };
    }
    return { a: 'fold' };
  }

  // ── Facing a 3-bet or bigger ──
  {
    const ip = position === 'late';
    // V12 ANTI-EXPLOIT: a hunter's 3-bets get 4-bet and called wider.
    const hunted3 = Math.max(0, Math.min(1, ctx.targeted ?? 0));
    // V18: a squeeze is bluff-heavier than a cold 3-bet - the squeezer is
    // attacking the CALLER'S capped range, not the opener's. The opener
    // defends wider on both branches.
    const sq = ctx.squeezed === true ? 1 : 0;
    // ═══ V21 DEEP-STACK DISCIPLINE (Dan 2026-08-27, Phase 2) ═══
    // The review table's preflop stack-offs average -82bb: 150bb+ cash pots
    // where 4-bet/5-bet thresholds tuned at 100bb put the whole stack in.
    // Depth scales the bar: at 250bb a 4-bet war demands closer to the top
    // of the deck, because the hand that stacks off is playing for 2.5x
    // more than the number the thresholds were calibrated against.
    //
    // TOURNAMENTS TOO (2026-09-11). This read `ctx.mode === 'cash'` with the
    // note "tournaments are untouched (shallow, and the M-zones own short
    // play)". The early levels of this fleet's events are not shallow: a
    // 30,000 starting stack at 25/50 is 600 big blinds, the Phase 6 atlas
    // clamps depth at 100bb, and so the 100bb-calibrated 4-bet and 5-bet
    // bars fired at six times the depth they were tuned for. Six of the
    // twenty biggest showdown losses of 2026-09-10 were exactly that:
    // AKo, AKo, QQ, KK, TT and AJs 4-bet or 5-bet jammed for 500-600bb in
    // tournaments (reviews 399558, 399571, 399778, 399735, 400053, 400754),
    // and the seven days to that date held 178 losing tournament preflop
    // stack-offs of 150bb or more, -63,663bb. The M-zones still own short
    // play - deepT is zero at 120bb and below, so nothing under that depth
    // changes, spins and SNGs included.
    const deepT =
      ctx.deepDiscipline === true && stackBB > 120 ? Math.min(0.05, (stackBB - 120) / 2600) : 0;
    let fourBetThresh = phase6CapBar(
      t53(0.93 - (ctx.aggression - 1) * 0.04, 'fourBet') -
        0.04 * hunted3 -
        0.03 * sq +
        deepT +
        vs35.fourBet +
        phase6Shift('fourBet')
    );
    // ═══ V73 THE OPENER FACING A 3-BET (2026-11-01) ═══════════════════
    // The bar below is a FIXED top-of-the-deck share whatever hero opened,
    // so the wider the open the more of it folded (production, 3 hours at
    // 25bb+: button 85-87% fold, cutoff 75%, under the gun 43-60%), and it
    // read the high-card ladder, which folds 99% of suited connectors. With
    // the V73 read the continue (call or 4-bet) bar is a share of the seat's
    // own open width on the seat's continue order (HorseGtoVs3BetRanges),
    // already priced by the 3-bet size, depth (the V21 deep scale included)
    // and the ante; the hunter, squeeze, exploit and Phase 6 reads move it as
    // before. Value 4-bets, the 4-bet bluff and the 5-bet branch are
    // unchanged.
    // Style tightness is NOT multiplied into this bar: the width is already a
    // share of the open, and a tighter horse opened a narrower, stronger
    // range, so the same continue hands are a LARGER share of it (measured:
    // with tightness applied a tag and a grinder under the gun folded 42% and
    // 47% to a 3-bet against 36% and 38% before, the reverse of the intent).
    // The ICM premium still applies in full.
    const v73 = ctx.gtoVs3Bet !== undefined && raises === 2 && !ctx.isOmaha ? ctx.gtoVs3Bet : null;
    let callThresh = phase6CapBar(
      v73
        ? capBar(v73.continueBar + (ploIcm ? ploIcm.call : ctx.riskAdd)) -
            0.03 * hunted3 -
            0.02 * sq +
            phase6Shift('call')
        : t53(ip ? 0.74 : 0.78, 'call') -
            0.03 * hunted3 -
            0.02 * sq +
            deepT * 0.5 +
            phase6Shift('call')
    );
    // The hand the call reads: the V73 continue order when the read is in.
    const callStrength = v73 ? v73.strength : strength;
    // 2026-10-16 OPPONENT EXPLOIT: a credible over-re-raiser's 3-bets and
    // 4-bets are 4-bet and called from the top of THEIR re-raising range.
    // TOURNAMENT AGGRESSION: production folded 62% to a 3-bet, which hands
    // every re-raiser a profit with any two cards. Up to 60bb effective,
    // defend a shade wider and 4-bet a shade wider; deeper, the V21 deep
    // discipline still rules. (A larger cut was measured and rejected: at
    // 0.62 the early opener called 3-bets with 90% of its range.)
    const aggro3 = tAggro && (ctx.effectiveStackBB ?? stackBB) <= 60;
    if (aggro3) {
      // V73: the per-seat continue width already owns the call.
      if (!v73) callThresh = phase6CapBar(callThresh - 0.02);
      fourBetThresh = phase6CapBar(fourBetThresh - 0.015);
    }
    // CASH PRESSURE: production folded 61.8% of opens to a 3-bet (humans
    // 32%). Up to 100bb effective the opener continues from the top 10% in
    // position (0.66) and the top 8% out of it (0.72) instead of the top 7%
    // and 5%, and 4-bets a shade wider. Deeper than 100bb the V21 deep
    // discipline still rules, and a credible re-raiser read still wins.
    const cash3 = cAggro && (ctx.effectiveStackBB ?? stackBB) <= 100;
    if (cash3) {
      ctx.noteLayer?.('v60_cash_pressure_opener_vs_three_bet');
      // V73: the per-seat continue width already owns the call.
      if (!v73) callThresh = phase6CapBar(Math.min(callThresh, t53(ip ? 0.66 : 0.72, 'call')));
      fourBetThresh = phase6CapBar(fourBetThresh - 0.015);
    }
    const vsReRaiser = ctx.exploitReRaiser;
    if (vsReRaiser) {
      fourBetThresh = phase6CapBar(Math.min(fourBetThresh, t53(vsReRaiser.fourBetBar, 'fourBet')));
      callThresh = phase6CapBar(Math.min(callThresh, t53(vsReRaiser.callBar, 'call')));
    }
    if (unblocked86 && ctx.facingColdCalledThreeBet === true) {
      fourBetThresh = phase6CapBar(fourBetThresh + 0.03);
      callThresh = phase6CapBar(callThresh + 0.05);
    }
    // ═══ PLO6-AUDIT-004 THE VPIP FLOOR DOES NOT SET THE STACK-OFF BAR ═══
    // (2026-11-12) vpipFloorMul scales `tightness`, and every bar here is a
    // product of it, so on a 50% floor table a seat in its first hands had its
    // jam bar cut from 0.93 to 0.40 of the deck. Production hand 58751512
    // (PLO6 1/2, 390bb): the button, strength 0.587, shoved 780 into a
    // four-bet it could have called for 161. The floor counts voluntary money
    // in, which a call supplies; it gives no reason to put 390bb in. So for a
    // deep Omaha seat (the V21 depth, over 120bb) the bar for a jam at a
    // stack-off node is read as if the table had no floor, exactly what the
    // same seat does on an unfloored table. The call bars keep the floor, so
    // the hand still plays. It applies only where that call exists at the
    // 30% of stack this node already allows a call for; a call that is itself
    // most of the stack is a price decision and is left alone. An observed
    // wide re-raiser (vsReRaiser) keeps the owner's call-off-lighter rule
    // untouched.
    const floorMul91 =
      ctx.isOmaha &&
      deepT > 0 &&
      !vsReRaiser &&
      toCall > 0 &&
      toCall <= stack * 0.3 &&
      ctx.vpipFloorMul !== undefined &&
      ctx.vpipFloorMul > 0 &&
      ctx.vpipFloorMul < 1
        ? ctx.vpipFloorMul
        : 1;
    const unflooredBar91 = (x: number): number =>
      capBar((x * ctx.tightness) / floorMul91 + (ploIcm ? ploIcm.fourBet : ctx.riskAdd));
    const fourBetBase91 = 0.93 - (ctx.aggression - 1) * 0.04;
    const floorDelta91 =
      floorMul91 < 1
        ? Math.max(0, unflooredBar91(fourBetBase91) - t53(fourBetBase91, 'fourBet'))
        : 0;
    const stackOffNode91 = raises >= 3 || currentBet * 2.3 >= stack * 0.4;
    const floorHolds91 =
      floorDelta91 > 0 && stackOffNode91 && strength < fourBetThresh + floorDelta91;

    // ═══ V25 NEVER RAISE-FOLD A COMMITTED PLO STACK ═══════════════════
    // Having raised a short PLO stack, the chips in the middle are already a
    // large share of it, and the pot is laying a price no reasonable hand
    // can refuse. Folding here is the worst of both worlds: it buys the
    // fold equity of a raise and then declines the equity it paid for. This
    // fires only when hero PUT the money in (raises >= 2 means hero's raise
    // got re-raised) and the price is genuinely committing.
    // 2026-08-31: the `ploT` gate is REMOVED. The argument this guard rests
    // on — PLO equities are compressed, so a committed stack facing a price
    // cannot fold — is about the VARIANT, not the format. Gating it on
    // tournaments left every PLO CASH table with no protection at all, which
    // is where Dan watched it happen.
    if (
      ctx.isOmaha &&
      investedShare >= 0.28 &&
      guardOdds <= 0.45 &&
      strength >= t53(0.42, 'commitCall')
    ) {
      return { a: 'call' };
    }

    // Dan 2026-11-06: suited aces 4-bet a single 3-bet (see the header of
    // OMAHA_SUITED_ACES_FOUR_BET_MAX_BB).
    if (
      ctx.omahaSuitedAcesFourBet === true &&
      ctx.isOmaha &&
      ctx.isPotLimit &&
      raises === 2 &&
      toCall > 0 &&
      toCall <= stack * 0.25 &&
      (ctx.effectiveStackBB ?? stackBB) <= OMAHA_SUITED_ACES_FOUR_BET_MAX_BB &&
      !(unblocked86 && ctx.omahaBareAcesDeep === true && (ctx.effectiveStackBB ?? stackBB) > 150) &&
      ctx.satellite?.locked !== true
    ) {
      return {
        a: 'raiseTo',
        to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand),
        receipt: 'plo_suited_aces_four_bet',
      };
    }

    // ═══ V87 26-35BB 4-BET ALL-IN RESHOVES (2026-11-10) ══════════════════
    // At 25 < effBB <= 35 in No-Limit Hold'em (<= 25bb belongs to vs3BetShortStack),
    // a sized 4-bet over a non-all-in 3-bet commits the stack anyway (and is capped
    // by Rule 4a); shoving all-in directly with 77+, ATs+, KQs, AKo, and wheel-Ace
    // blockers A5s-A2s realizes full fold equity while never overriding all-in or
    // closed-all-in call-offs.
    const unitBB4Bet = bb > 0 ? bb : 1;
    const heroInvested4Bet = Math.max(0, currentBet - toCall);
    const effectiveStack4Bet =
      ctx.effectiveStackBB !== undefined
        ? Math.min(
            stack + heroInvested4Bet,
            ctx.effectiveStackBB *
              (ctx.effectiveStackNormalized === true
                ? straddleUnitCoins
                : straddleActiveCash
                  ? straddleUnitCoins
                  : unitBB4Bet)
          )
        : stack + heroInvested4Bet;
    const effRemaining4Bet = Math.min(stack, Math.max(0, effectiveStack4Bet - heroInvested4Bet));
    const callIsAllIn4Bet =
      effCall >= stack * 0.99 ||
      (effRemaining4Bet > 0 && effCall >= effRemaining4Bet * 0.99) ||
      ctx.facingClosedAllIn === true;
    if (
      v87 &&
      noLimitHoldem &&
      !ctx.isPotLimit &&
      raises === 2 &&
      callers === 0 &&
      toCall > 0 &&
      ctx.vs3BetShortJam !== false &&
      straddleEffectiveBB > 25 &&
      straddleEffectiveBB <= 35 &&
      !callIsAllIn4Bet &&
      toCall < effectiveStack4Bet * 0.65 &&
      ctx.satellite?.locked !== true
    ) {
      if (v87HoleClass !== null) {
        if (
          V87_FOUR_BET_VALUE_SHOVE_CLASSES.has(v87HoleClass) ||
          (ctx.maniacNoBluff !== true && V87_FOUR_BET_BLUFF_SHOVE_CLASSES.has(v87HoleClass))
        ) {
          return { a: 'jam' };
        }
      } else if (
        strength >= t(0.76) ||
        (ctx.maniacNoBluff !== true && ctx.holdsAce === true && strength >= t(0.58))
      ) {
        return { a: 'jam' };
      }
    }

    // V86 PLO NON-AA SHALLOW/MEDIUM 4-BETTING: at <= 130bb effective (SPR <= ~4
    // in a 4-bet pot), double-suited connected broadways, double-suited rundowns,
    // double-suited KK, and PLO8 scoop hands pot-4-bet so 4-bet != AAxx only.
    if (
      v86 &&
      ctx.isOmaha &&
      ctx.isPotLimit &&
      raises === 2 &&
      toCall > 0 &&
      toCall <= stack * 0.3 &&
      (ctx.effectiveStackBB ?? stackBB) <= 130 &&
      ctx.satellite?.locked !== true &&
      ctx.maniacNoBluff !== true &&
      ctx.omahaElite?.canFourBetShallow === true &&
      strength >= Math.max(0.62, fourBetThresh - 0.14) &&
      (ctx.plo3BetRoll ?? 0.4) < Math.min(0.85, (ctx.ploPersona3BetMix ?? 0.55) + 0.15)
    ) {
      return {
        a: 'raiseTo',
        to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand),
        receipt: 'v86_plo_shallow_four_bet',
      };
    }

    if (strength >= fourBetThresh && !floorHolds91) {
      // V21: deep, a 4-bet is no longer automatically a stack-off — jam only
      // when the money is already committed on normal sizing, and demand a
      // premium above the 4-bet floor before jamming 150bb+.
      if (raises >= 3 || currentBet * 2.3 >= stack * 0.4) {
        // The call-instead-of-jam relief window is deepT wide, starting at
        // the (already deepT-raised) 4-bet bar. Reviewed in the V28 audit
        // and kept: the window position is intentional — the first deepT of
        // hands above the deep bar flat rather than jam.
        if (deepT > 0 && strength < fourBetThresh + deepT && toCall < stack * 0.5) {
          return { a: 'call' };
        }
        return { a: 'jam' };
      }
      // Pot limit: the 4-bet is a pot raise for the same reason the 3-bet is.
      if (ctx.isPotLimit) {
        return { a: 'raiseTo', to: ploRaiseTo(ctx.sizingMultiplier, potRaiseTo, rand) };
      }
      const mult = 2.2 + rand() * 0.4;
      return { a: 'raiseTo', to: currentBet * mult * ctx.sizingMultiplier };
    }

    // V76 receipt carrier: true when the retired band rolled (see below).
    let v76Retired = false;
    const v76Done = (i: PreflopIntent): PreflopIntent =>
      v76Retired ? { ...i, receipt: 'v76_retired_four_bet_bluff' } : i;

    // V7 4-BET BLUFF: NLHE only, facing exactly a 3-bet, no callers behind,
    // blocker-heavy band just below the value region. Small sizing, folds to
    // a 5-bet. Makes the value 4-bets unexploitable.
    // ═══ V76 (2026-11-01): RETIRED AT THE SOURCE ═══ Dan's rule 4 bans any
    // hold'em 4-bet made to fold; this band's whole purpose was to fold to a
    // 5-bet, so since 2026-11-01 the final layer (HorseHoldemPremiumAggression
    // rule 4a, receipt holdem_no_four_bet_bluff) converted every one of its
    // sized 4-bets to a call. Retiring it here lets the band's hands take the
    // call-or-fold read directly (the V73/V75 priced width where it applies)
    // instead of a forced conversion; the final layer stays as the fail-safe.
    // The retirement gate sits AFTER the rand() roll on purpose: the roll is
    // still drawn, so every variant's random stream is bit-identical to the
    // band era (HorseOpponentExploitNeutrality replays recorded draws), and
    // only the ACTION is retired.
    if (
      !ctx.isOmaha &&
      raises === 2 &&
      callers === 0 &&
      ctx.maniacNoBluff !== true &&
      strength >= t(0.72) &&
      strength < fourBetThresh &&
      currentBet * 2.3 < stack * 0.35 &&
      rand() < bluffBudget * 0.22 * blockerMult * (aggro3 ? 1.5 : cash3 ? 1.4 : 1)
    ) {
      if (ctx.retireFourBetBluffBand !== true) {
        const mult = 2.2 + rand() * 0.2;
        return { a: 'raiseTo', to: currentBet * mult * ctx.sizingMultiplier };
      }
      // V76: the band rolled and is retired. Record it for the caller and
      // fall through to the call / fold read below (the action is unchanged
      // from the retirement; only the receipt is new).
      v76Retired = true;
    }

    // 5-bet pots: jam-or-fold on true premiums only.
    // V21: deeper stacks push the premium bar higher still — a 5-bet pot at
    // 250bb is QQ+/AK at best, and QQ is already a coin flip against the
    // range that builds it.
    if (raises >= 3) {
      // Dan 2026-11-06: a suited aces raiser re-raised again keeps its chips
      // in at a price it can take; it never raises and then folds.
      if (
        ctx.omahaSuitedAcesFourBet === true &&
        ctx.isOmaha &&
        toCall > 0 &&
        investedShare >= 0.12 &&
        guardOdds <= OMAHA_SUITED_ACES_CONTINUE_ODDS &&
        !(
          unblocked86 &&
          ctx.omahaBareAcesDeep === true &&
          (ctx.effectiveStackBB ?? stackBB) > 150 &&
          guardOdds > 0.36
        )
      ) {
        return { a: 'call', receipt: 'plo_suited_aces_four_bettor_continues' };
      }
      // V86 PLO 3-BETTOR / 4-BETTOR CONTINUES AT PRICE: any Omaha hand that
      // 3-bet or 4-bet with an elite rundown, connected broadway, suited-Ax
      // nut bridge, KKds, or PLO8 scoop hand continues when re-raised at pot
      // odds <= 0.45 rather than raise-folding 40%+ raw equity.
      if (
        v86 &&
        ctx.isOmaha &&
        toCall > 0 &&
        investedShare >= 0.09 &&
        guardOdds <= OMAHA_SUITED_ACES_CONTINUE_ODDS &&
        (ctx.omahaElite?.canThreeBet === true ||
          strength >= (vsReRaiser ? Math.min(t53(0.56, 'call'), callThresh) : t53(0.56, 'call')))
      ) {
        return { a: 'call', receipt: 'v86_plo_three_bettor_continues' };
      }
      // ═══ DEEP 5-BET DISCIPLINE (Dan 2026-10-25) ═══════════════════════
      // Facing a 4-bet with 60bb+ effective in a tournament, only AA and KK
      // put the stack in. Measured over 30 hours before this: 70 tournament
      // 5-bet shoves at 100bb+ effective, QQ/JJ/TT/AK among them, averaging
      // -18bb each; the range that 4-bets that deep is AA/KK-heavy, and QQ
      // is a coin flip against it at best.
      if (
        isTourney &&
        !ctx.isOmaha &&
        (ctx.effectiveStackBB ?? 0) > 60 &&
        ctx.holdemPremiumPair !== true
      ) {
        if (strength >= t(0.9) && toCall <= stack * 0.25) return { a: 'call' };
        if (toCall === 0) return { a: 'check' };
        return { a: 'fold' };
      }
      // FACING A 4-BET, STYLE NEVER PRICES A PREMIUM OUT (2026-11-08). These
      // two bars multiplied the style tightness, so for any tightness above
      // ~1.03 both landed on BAR_CAP (0.965): the live cash Hybrid (Grinder,
      // tightness 1.0976) jammed 0.95 x 1.0976 and called 0.88 x 1.0976,
      // both capped at 0.965, which only AA reaches. Replayed (hands
      // d481b609 KK 121bb, cea123e5 QQ 80bb, 623bd022 QQ, 5bf00645 AKo,
      // 7df8a2c0 JJ): every one folded to the 4-bet. A tighter style already
      // 3-bet a narrower, stronger range (the V73 reasoning), so the share
      // of it that continues against a 4-bet must not shrink with style: the
      // tightness may loosen these bars but never raise them above the
      // balanced line. The ICM premium (riskAdd / the V53 family shift) and
      // the V21 deep scale still apply in full. Hold'em only: Omaha keeps its
      // own calibration on this node.
      const tight5 =
        noLimitHoldem || (unblocked86 && ctx.isOmaha) ? Math.min(1, ctx.tightness) : ctx.tightness;
      const t5 = (x: number, family: keyof OmahaPressureShifts): number =>
        capBar(x * tight5 + (ploIcm ? ploIcm[family] : ctx.riskAdd));
      const jamBar5 = Math.min(0.98, 0.95 + deepT);
      if (
        strength >=
        (floorMul91 < 1
          ? Math.max(t5(jamBar5, 'fourBet'), unflooredBar91(jamBar5))
          : t5(jamBar5, 'fourBet'))
      )
        return { a: 'jam' };
      // The 30% stack cap stops a call that more betting can follow; a call
      // that closes an all-in risks only what is priced (facingClosedAllIn).
      if (strength >= t5(0.88 + deepT, 'call') && (toCall <= stack * 0.3 || closedAllInCall)) {
        return { a: 'call' };
      }
      if (toCall === 0) return { a: 'check' };
      return { a: 'fold' };
    }

    // ═══ THE PRICE IS PART OF THE DECISION (Dan 2026-08-31) ═══════════
    // This branch demanded a FIXED top-20% hand whatever the pot laid, and
    // capped the call at 35% of stack — a cap that bites hardest exactly
    // when hero is most committed and the odds are best. Three hands Dan
    // watched live, all folded 40/40 by the probe that reproduced them:
    //
    //   PLO6, raised to 12 with 35 behind, faced 48 -> all-in for 35 to win
    //     95 (1.7:1). Strength 0.753, a TOP-25% hand. The bar was 0.803, and
    //     the cap refused the call before strength was even consulted.
    //   Heads-up, raised to 6, faced a MIN-CLICK to 12 -> 6 to call into 18,
    //     THREE TO ONE, in position. Bar 0.803. Fold.
    //   Min-raised to 4, faced 16 -> 12 into 20. Bar 0.803. Fold.
    //
    // In PLO6 essentially any six cards hold more than 25% against a
    // 3-betting range, so a 3:1 price is a call with the whole range. The
    // single-raise branch already knows this (V24 price defense); the 3-bet
    // branch never learned it.
    //
    // TWO CORRECTIONS, both anchored on the price rather than invented:
    //  1. The bar drops as the price improves, more steeply in Omaha where
    //     the equities compress. Floors stop it becoming a calling station.
    //  2. The stack cap protects DEEP stacks from light stack-offs. It must
    //     not veto a committed short stack taking a price it already paid
    //     for — the chips hero raised are not somebody else's money.
    // V73: the 3-bet's price is already inside the per-seat width (it
    // scales with the 3-bet size), so the general price relief is not added
    // on top; the committed-stack relief and the floor still apply.
    const relief3 = v73 ? 0 : Math.max(0, 0.5 - guardOdds) * (ctx.isOmaha ? 1.6 : 0.9);
    const commit3 = investedShare >= 0.12 ? Math.min(0.1, investedShare * 0.5) : 0;
    const elite3 =
      v86 && ctx.isOmaha && investedShare >= 0.07 && ctx.omahaElite?.canThreeBet === true
        ? 0.08
        : 0;
    const floor3 = ctx.isOmaha ? 0.3 : 0.42;
    const pricedCallThresh = Math.max(floor3, callThresh - relief3 - commit3 - elite3);
    // FACING A CLOSED ALL-IN 3-BET (2026-11-08): the cap protects a deep
    // stack from a light call that more betting can follow. When the 3-bet
    // is all in and nobody live can bet again, the call risks exactly the
    // price and nothing follows it, so the cap does not veto it. Before this,
    // an opener facing any all-in 3-bet worth more than 35% of its stack
    // folded every hand the bar called: live on 391f7bc0, tournament NLH
    // heads-up openers facing a 12-25bb jam folded 205 of 212, and replayed
    // through HorseLogic.decide QQ (22bb jam, 43% to call), JJ, TT, AKo, 99
    // and 88 all folded at this line (docs/changelog/
    // 2026-11-08-horse-opener-facing-an-all-in-3-bet.md).
    const capOK3 =
      toCall <= stack * 0.35 || (investedShare >= 0.1 && guardOdds <= 0.45) || closedAllInCall;
    if (callStrength >= pricedCallThresh && capOK3) return v76Done({ a: 'call' });
    // SHORT-STACK 3-BET DEFENCE (2026-11-07, default off): a hand the V73
    // read continues with, whose call the stack cap refuses because it IS
    // the stack (12-25bb effective), goes in instead of folding.
    if (ctx.vs3BetShortJam === true && v73 && callStrength >= pricedCallThresh && !capOK3) {
      return v76Done({ a: 'jam' });
    }
    if (toCall > 0 && toCall <= pricePot * 0.15 && strength >= 0.45) return v76Done({ a: 'call' });
    if (toCall === 0) return v76Done({ a: 'check' });
    return v76Done({ a: 'fold' });
  }
}
