/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FIXED-LIMIT PRICED PREFLOP AND THE STEAL AGAINST OVER-FOLDING BLINDS
 * (Fixed-Limit lane W5, 2026-11-15; both DEFAULT OFF)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MEASURED (lane evidence C-ARCHITECTURE c5, O-TIGHT-FL-DIAGNOSIS, live
 * hand_history): fixed-limit preflop is decided by the no-limit percentile
 * bars (HorsePreflop OPEN_THRESH / THREEBET_VS / CALL_VS plus the flh/flo8
 * shift row). Price enters only through the fold-rescue guard, whose clauses
 * (price <= 0.15, or <= 0.22 for at most one big blind) both miss the most
 * common fixed-limit defence: the big blind facing one raise with the small
 * blind folded pays 1 small bet into 3.5 (price 0.2222), heads-up 0.25. The
 * heads-up button folded 27% (flh) / 57% (flo8) first in whatever the
 * opponent, the six-handed flh button opened ~19% against 40-48% in standard
 * limit charts, and big blinds folded 30-42% to one raise at 3.5 to 1.
 *
 * fixedLimitPricedPreflop (HorseDecideOpts, read `=== true`) replaces, in
 * fixed limit only, exactly two families of preflop answer:
 *
 *  1. FIRST IN (no raise, no limper, no caller): raise the top share of hands
 *     FIXED_LIMIT_OPEN_REFERENCE gives for the seat (counted by the players
 *     still to act behind it, which is how the published limit charts are
 *     read across table sizes), the small blind folded to also completes a
 *     band below its raise, and fold the rest. Heads-up the button raises or
 *     folds (flh top 85%, flo8 top 70%). The share is moved by the persona's
 *     tightness by at most +/-10% of itself.
 *  2. A BLIND FACING EXACTLY ONE RAISE (no limper, no caller, the raiser not
 *     all in): a FOLD of the existing bars becomes a CALL when the hand's
 *     showdown equity against the opener's reference range, times the
 *     out-of-position realization, covers the RAW pot price call /
 *     (pot + call) (2026-11-15 fix: the realization is calibrated at that
 *     price; preflopCallOdds' projected deduction is not applied again), less a realization factor per player still to act
 *     behind (the small blind has the big blind behind it). Calls and 3-bets
 *     the old bars made are unchanged (3-bet and cap ranges unchanged).
 *
 * Everything else (3-bets, 4-bets, caps, cold calls, limped pots, the big
 * blind's option) is the old code. CASH TABLES ONLY (2026-11-15, Fixed-Limit
 * lane owner): HorseLogic builds neither context at a tournament table
 * (isTournamentMode), so a fixed-limit tournament decides exactly as with
 * both options off until a separately evaluated tournament option exists.
 * No-limit and pot-limit never reach this module.
 *
 * fixedLimitStealVsTightBlinds (read `=== true`): first in from the cutoff,
 * the button or the small blind (at most three players behind, or the
 * heads-up button), when EVERY player still to act is a read over-folder, the
 * open share widens by up to FIXED_LIMIT_STEAL_MAX_WIDEN. An over-folder is an
 * opponent whose own exploit read (HorseMind.opponentRead: decayed counters,
 * Beta posterior at EXPLOIT_CREDIBILITY against the variant's envelope) has
 * foldToBet engaged HIGH on at least FIXED_LIMIT_STEAL_MIN_OPPS decayed
 * opportunities, is not presumed (read.presumed) and has no preflop
 * statistic engaged wide. Unknown, sparse, presumed or wide reads, an
 * all-in player behind, or any one non-over-folder left to act: no change.
 * Folded players are not players left to act. With the priced option off the
 * same widen moves the old open bar by the strength the share widen spans at
 * the reference share.
 *
 * REFERENCES (stated, approximate; not a solver). Hold'em: the widely
 * published fixed-limit opening charts read by players behind - under the gun
 * full ring 12-14%, six-max UTG 17-20%, hijack 22-25%, cutoff ~30%, button
 * 40-48%, small blind folded to ~40% raise with a completing band, heads-up
 * button 80-90%. Omaha-8: starting-hand quality guidance (hands with an ace
 * and a low card, coordinated hi-lo hands): early ~12-15%, late 25-40%,
 * heads-up button 65-75%. Big blind defence widths in the published limit
 * material: hold'em vs early ~45-55%, vs the button ~75-85%, heads-up
 * ~85-90%; Omaha-8, where showdown equities run close and trash is
 * quartered or scooped, defends every late raise but the worst hands and
 * ~65-85% against an early raise. The equity table and the strength order
 * are generated (scripts/generate-fixed-limit-preflop-tables.ts, fixed seed).
 * The realization factors (flh 0.65, flo8 0.55) are CALIBRATION, not
 * measurement: at the reference opens and the 3.5-to-1 price (heads-up 3 to
 * 1) they give, on the table, flh 50% vs a six-max UTG open, 70% vs the
 * cutoff, 85% vs the button, 85% heads-up; flo8 85% vs UTG, 100% vs the
 * cutoff and button, 80% heads-up.
 *
 * Pure: no random draws, no state.
 */
import { EXPLOIT_STATS, type OpponentExploitRead } from './HorseOpponentExploit.js';
import {
  FIXED_LIMIT_EQUITY_BUCKETS,
  FIXED_LIMIT_EQUITY_VS_TOP_SHARE,
  FIXED_LIMIT_OPENER_WIDTHS,
  FIXED_LIMIT_STRENGTH_AT_TOP_SHARE,
} from './HorseFixedLimitPreflopTables.js';

export type FixedLimitPreflopVariant = 'flh' | 'flo8';

export interface FixedLimitOpenReference {
  /** heads-up button (the small blind of a two-handed table): raise share */
  headsUpButton: number;
  /** small blind folded to, three or more dealt: raise share */
  smallBlindRaise: number;
  /** small blind folded to: complete every hand inside this share (raise above) */
  smallBlindComplete: number;
  /** raise share by players still to act behind: index 2 = button, 3 = cutoff,
   *  4 = hijack, 5 = lojack, 6 = UTG+1, 7 and more = under the gun full ring */
  byPlayersBehind: Readonly<Record<2 | 3 | 4 | 5 | 6 | 7, number>>;
}

export const FIXED_LIMIT_OPEN_REFERENCE: Readonly<
  Record<FixedLimitPreflopVariant, FixedLimitOpenReference>
> = Object.freeze({
  flh: Object.freeze({
    headsUpButton: 0.85,
    smallBlindRaise: 0.4,
    smallBlindComplete: 0.65,
    byPlayersBehind: Object.freeze({ 2: 0.45, 3: 0.31, 4: 0.24, 5: 0.19, 6: 0.15, 7: 0.13 }),
  }),
  flo8: Object.freeze({
    headsUpButton: 0.7,
    smallBlindRaise: 0.3,
    smallBlindComplete: 0.6,
    byPlayersBehind: Object.freeze({ 2: 0.38, 3: 0.28, 4: 0.22, 5: 0.18, 6: 0.15, 7: 0.13 }),
  }),
});

/** Half-width of the band the laws hold the measured first-in shares to. */
export const FIXED_LIMIT_OPEN_BAND = 0.05;
/** The persona tightness moves a reference share by at most this fraction of itself. */
export const FIXED_LIMIT_PERSONA_SHARE_SWING = 0.05;
/** Out-of-position realization of showdown equity for a defending blind
 *  (calibration to the published defence widths, see the header). */
export const FIXED_LIMIT_DEFENCE_REALIZATION: Readonly<Record<FixedLimitPreflopVariant, number>> =
  Object.freeze({ flh: 0.65, flo8: 0.55 });
/** Further realization factor per player still to act behind the defender. */
export const FIXED_LIMIT_BEHIND_REALIZATION = 0.85;
/** A tournament stack at or under this depth keeps the old preflop answer. */
export const FIXED_LIMIT_TOURNAMENT_MIN_BB = 20;

/** STEAL: decayed foldToBet opportunities an over-folder read needs. */
export const FIXED_LIMIT_STEAL_MIN_OPPS = 15;
/** STEAL: the open share widens by at most this much. */
export const FIXED_LIMIT_STEAL_MAX_WIDEN = 0.15;
/** STEAL: read excess (0..1 past the envelope edge) that earns the full widen. */
export const FIXED_LIMIT_STEAL_FULL_EXCESS = 0.25;
/** STEAL: the widened share never exceeds this (heads-up) / that (ring). */
export const FIXED_LIMIT_STEAL_MAX_SHARE_HU = 0.95;
export const FIXED_LIMIT_STEAL_MAX_SHARE = 0.7;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Decision strength at the top `share` of hands (linear between whole percents). */
export function fixedLimitStrengthAtTopShare(
  variant: FixedLimitPreflopVariant,
  share: number
): number {
  const t = FIXED_LIMIT_STRENGTH_AT_TOP_SHARE[variant];
  const k = clamp(share, 0, 1) * 100;
  const i = Math.min(99, Math.floor(k));
  const f = k - i;
  return t[i] + (t[i + 1] - t[i]) * f;
}

/** The top share of hands a decision strength sits at (inverse of the above). */
export function fixedLimitTopShareOfStrength(
  variant: FixedLimitPreflopVariant,
  strength: number
): number {
  const t = FIXED_LIMIT_STRENGTH_AT_TOP_SHARE[variant];
  if (strength >= t[0]) return 0;
  for (let i = 1; i <= 100; i++) {
    if (strength >= t[i]) {
      const span = t[i - 1] - t[i];
      const f = span > 0 ? (t[i - 1] - strength) / span : 1;
      return (i - 1 + f) / 100;
    }
  }
  return 1;
}

/** Showdown equity of a hand at top share `heroShare` against the top `openerShare`. */
export function fixedLimitEquityVsTopShare(
  variant: FixedLimitPreflopVariant,
  heroShare: number,
  openerShare: number
): number {
  const rows = FIXED_LIMIT_EQUITY_VS_TOP_SHARE[variant];
  const b = Math.min(
    FIXED_LIMIT_EQUITY_BUCKETS - 1,
    Math.max(0, Math.floor(clamp(heroShare, 0, 1) * FIXED_LIMIT_EQUITY_BUCKETS))
  );
  const row = rows[b];
  const w = clamp(openerShare, 0, 1) * 100;
  const ws = FIXED_LIMIT_OPENER_WIDTHS;
  if (w <= ws[0]) return row[0] / 1000;
  for (let i = 1; i < ws.length; i++) {
    if (w <= ws[i]) {
      const f = (w - ws[i - 1]) / (ws[i] - ws[i - 1]);
      return (row[i - 1] + (row[i] - row[i - 1]) * f) / 1000;
    }
  }
  return row[row.length - 1] / 1000;
}

/**
 * The reference first-in share of a seat: `dealt` hands dealt in, `behind`
 * players still to act behind the seat (HorseLogic preflopPlayersBehind: the
 * big blind 0, the small blind 1, the button 2, ...; heads-up the button 1).
 * Null for the big blind or an unknown seat.
 */
export function fixedLimitOpenShare(
  variant: FixedLimitPreflopVariant,
  dealt: number,
  behind: number | null
): { raise: number; complete: number | null } | null {
  if (behind === null || !Number.isFinite(behind) || behind < 1) return null;
  const ref = FIXED_LIMIT_OPEN_REFERENCE[variant];
  if (dealt <= 2) return behind === 1 ? { raise: ref.headsUpButton, complete: null } : null;
  if (behind === 1) return { raise: ref.smallBlindRaise, complete: ref.smallBlindComplete };
  const key = Math.min(7, Math.floor(behind)) as 2 | 3 | 4 | 5 | 6 | 7;
  return { raise: ref.byPlayersBehind[key], complete: null };
}

/** The persona's bounded share multiplier (tightness 1 = the reference). */
export function fixedLimitPersonaShareMul(tightness: number): number {
  const t = Number.isFinite(tightness) && tightness > 0 ? tightness : 1;
  return clamp(1 / t, 1 - FIXED_LIMIT_PERSONA_SHARE_SWING, 1 + FIXED_LIMIT_PERSONA_SHARE_SWING);
}

// ─────────────────────────────────────────────────────────────────────────
// STEAL AGAINST OVER-FOLDING BLINDS
// ─────────────────────────────────────────────────────────────────────────

const WIDE_STATS = EXPLOIT_STATS.filter(
  (s) => s === 'vpip' || s === 'pfr' || s === 'rfi' || s === 'threeBet'
);

/** True when this read is an adequate, own-evidence over-folder read. */
export function fixedLimitOverFolder(read: OpponentExploitRead | null | undefined): boolean {
  if (!read || read.presumed === true) return false;
  const f = read.stats.foldToBet;
  if (!f || f.engaged !== 'high' || !(f.n >= FIXED_LIMIT_STEAL_MIN_OPPS)) return false;
  return !WIDE_STATS.some((s) => read.stats[s]?.engaged === 'high');
}

/**
 * The share widen for a first-in steal when every read (one per player still
 * to act, folded players excluded by the caller) is an over-folder; null
 * otherwise. Scaled by the weakest read's excess.
 */
export function fixedLimitStealWiden(
  reads: ReadonlyArray<OpponentExploitRead | null | undefined>
): { widenShare: number; minExcess: number } | null {
  if (reads.length === 0) return null;
  let minExcess = 1;
  for (const r of reads) {
    if (!fixedLimitOverFolder(r)) return null;
    minExcess = Math.min(minExcess, r!.stats.foldToBet.excess);
  }
  const widenShare =
    FIXED_LIMIT_STEAL_MAX_WIDEN * clamp(minExcess / FIXED_LIMIT_STEAL_FULL_EXCESS, 0, 1);
  return widenShare > 0 ? { widenShare, minExcess } : null;
}

/** The strength a share widen spans at the seat's reference share (legacy-bar steal). */
export function fixedLimitStealStrengthWiden(
  variant: FixedLimitPreflopVariant,
  referenceShare: number,
  widenShare: number,
  dealt: number
): number {
  const cap = dealt <= 2 ? FIXED_LIMIT_STEAL_MAX_SHARE_HU : FIXED_LIMIT_STEAL_MAX_SHARE;
  const to = Math.min(cap, referenceShare + widenShare);
  return Math.max(
    0,
    fixedLimitStrengthAtTopShare(variant, referenceShare) -
      fixedLimitStrengthAtTopShare(variant, to)
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THE PRICED DECISION
// ─────────────────────────────────────────────────────────────────────────

/** What HorseLogic hands HorsePreflop (PreflopCtx.fixedLimitPriced). */
export interface FixedLimitPricedCtx {
  variant: FixedLimitPreflopVariant;
  /** hands dealt in */
  dealt: number;
  /** players still to act behind hero (preflopPlayersBehind), null unknown */
  behind: number | null;
  /** players behind the single raiser when it raised, null unknown */
  openerBehind: number | null;
  /** the single raiser is all in */
  openerAllIn: boolean;
  /** STEAL widen of the first-in share (0 when none) */
  stealWidenShare: number;
}

export interface FixedLimitPricedSpot {
  priced: FixedLimitPricedCtx;
  strength: number;
  tightness: number;
  riskAdd: number;
  mode: 'cash' | 'tournament' | undefined;
  stackBB: number;
  raises: number;
  limpers: number;
  callers: number;
  toCall: number;
  bigBlind: number;
  currentBet: number;
  /** blind seat of hero, if any */
  blind: 'sb' | 'bb' | null;
  /** the RAW pot price of calling, call / (pot + call), for the defence: the
   *  realization factors are calibrated at this price (2026-11-15 fix; the
   *  projected rake-and-jackpot deduction is not applied a second time) */
  odds: number;
  /** a maniac behind: the open bar may not go below this (strength) */
  maniacOpenBar?: number;
}

export type FixedLimitPricedReceipt =
  | 'fixed_limit_priced_first_in'
  | 'fixed_limit_priced_blind_defence';

export interface FixedLimitPricedResult {
  intent: { a: 'fold' | 'check' | 'call' | 'raiseTo'; to?: number };
  receipt: FixedLimitPricedReceipt;
  share?: number;
  bar?: number;
  equity?: number;
  required?: number;
}

/** The first-in raise bar (strength) and completing bar for a seat, or null. */
export function fixedLimitFirstInBars(
  priced: FixedLimitPricedCtx,
  tightness: number,
  riskAdd: number
): { share: number; raiseBar: number; completeBar: number | null } | null {
  const ref = fixedLimitOpenShare(priced.variant, priced.dealt, priced.behind);
  if (!ref) return null;
  const mul = fixedLimitPersonaShareMul(tightness);
  const cap = priced.dealt <= 2 ? FIXED_LIMIT_STEAL_MAX_SHARE_HU : FIXED_LIMIT_STEAL_MAX_SHARE;
  const stealable = priced.dealt <= 2 || (priced.behind !== null && priced.behind <= 3);
  const widen = stealable ? Math.max(0, priced.stealWidenShare) : 0;
  const share = clamp(ref.raise * mul + widen, 0, Math.max(cap, ref.raise * mul));
  const raiseBar = fixedLimitStrengthAtTopShare(priced.variant, share) + Math.max(0, riskAdd);
  const completeBar =
    ref.complete === null
      ? null
      : fixedLimitStrengthAtTopShare(priced.variant, clamp(ref.complete * mul, share, 1)) +
        Math.max(0, riskAdd);
  return { share, raiseBar, completeBar };
}

/** The defence verdict of a blind facing one raise from a seat with `openerBehind`. */
export function fixedLimitBlindDefence(input: {
  variant: FixedLimitPreflopVariant;
  dealt: number;
  strength: number;
  openerBehind: number | null;
  /** players still to act behind the defender */
  behind: number;
  odds: number;
  riskAdd?: number;
}): { equity: number; realized: number; required: number; calls: boolean } | null {
  const opener = fixedLimitOpenShare(input.variant, input.dealt, input.openerBehind);
  if (!opener || !(input.odds > 0) || !(input.odds < 1)) return null;
  const heroShare = fixedLimitTopShareOfStrength(input.variant, input.strength);
  const equity = fixedLimitEquityVsTopShare(input.variant, heroShare, opener.raise);
  const realized =
    equity *
    FIXED_LIMIT_DEFENCE_REALIZATION[input.variant] *
    Math.pow(FIXED_LIMIT_BEHIND_REALIZATION, Math.max(0, input.behind));
  const required = input.odds + Math.max(0, input.riskAdd ?? 0);
  return { equity, realized, required, calls: realized >= required };
}

/**
 * The priced answer for this spot, or null when the spot is not one of the
 * two families (the old answer `inner` stands). A blind defence returns only
 * when it turns the old fold into a call.
 */
export function fixedLimitPricedPreflopIntent(
  spot: FixedLimitPricedSpot,
  inner: { a: string }
): FixedLimitPricedResult | null {
  const p = spot.priced;
  if (spot.mode === 'tournament' && !(spot.stackBB > FIXED_LIMIT_TOURNAMENT_MIN_BB)) return null;
  const bb = spot.bigBlind > 0 ? spot.bigBlind : 1;
  // 1. FIRST IN: nothing but the blinds in front (the big blind has no first in).
  if (
    spot.raises === 0 &&
    spot.limpers === 0 &&
    spot.callers === 0 &&
    spot.blind !== 'bb' &&
    spot.currentBet <= bb * 1.05
  ) {
    const bars = fixedLimitFirstInBars(p, spot.tightness, spot.riskAdd);
    if (!bars) return null;
    const raiseBar =
      spot.maniacOpenBar !== undefined
        ? Math.max(bars.raiseBar, spot.maniacOpenBar)
        : bars.raiseBar;
    const base = {
      receipt: 'fixed_limit_priced_first_in' as const,
      share: bars.share,
      bar: raiseBar,
    };
    if (spot.strength >= raiseBar)
      return { ...base, intent: { a: 'raiseTo', to: spot.currentBet + bb } };
    if (bars.completeBar !== null && spot.strength >= bars.completeBar)
      return { ...base, intent: spot.toCall > 0 ? { a: 'call' } : { a: 'check' } };
    return { ...base, intent: spot.toCall > 0 ? { a: 'fold' } : { a: 'check' } };
  }
  // 2. A BLIND FACING EXACTLY ONE RAISE, nothing else in: a fold becomes a
  // call when the realized equity covers the price.
  if (
    inner.a === 'fold' &&
    spot.raises === 1 &&
    spot.limpers === 0 &&
    spot.callers === 0 &&
    spot.blind !== null &&
    spot.toCall > 0 &&
    !p.openerAllIn
  ) {
    const d = fixedLimitBlindDefence({
      variant: p.variant,
      dealt: p.dealt,
      strength: spot.strength,
      openerBehind: p.openerBehind,
      behind: spot.blind === 'sb' ? Math.max(0, p.behind ?? 1) : 0,
      odds: spot.odds,
      riskAdd: spot.riskAdd,
    });
    if (!d || !d.calls) return null;
    return {
      intent: { a: 'call' },
      receipt: 'fixed_limit_priced_blind_defence',
      equity: d.equity,
      required: d.required,
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE TOURNAMENT VERSION (fixedLimitPricedPreflopTournament, Fixed-Limit lane
// Phase 4, 2026-11-16, DEFAULT OFF)
// ─────────────────────────────────────────────────────────────────────────
//
// MEASURED (lane evidence P4-TOURNAMENT-PRICED-PREFLOP.md, AB 3.6): the cash
// priced first in, applied at a six-seat fixed-limit hold'em tournament table
// against a maniac field, REPLACED the tournament persona's wider first-in
// range with the cash chart and so folded under-the-gun hands the persona
// opened (11 of 11 direct first-in differences; the rest of the loss was
// memory knock-on). The tournament version therefore never tightens the
// persona at chip value:
//
//  1. FIRST IN (no raise, no limper, no caller, not the big blind): a persona
//     FOLD (or check) becomes a raise when the hand sits inside the seat's
//     reference share divided by hero's bubble factor bf (IcmModel through
//     HorseLogic.heroBubbleFactor on the trusted tournament context; 1 = chip
//     EV). A persona open is kept, except under real payout pressure
//     (bf > FIXED_LIMIT_TOURNAMENT_TIGHTEN_BF), where an open outside the
//     share at bf folds: the only tightening this module does. Below
//     FIXED_LIMIT_TOURNAMENT_SHORT_BB big blinds the share is scaled by
//     (0.8 + 0.2 x min(1, (stackBB - 10) / 15)): a fixed-limit raise commits
//     more of a short stack.
//  2. A BLIND FACING EXACTLY ONE RAISE (no limper, no caller, raiser not all
//     in): a persona FOLD becomes a call when the realized equity against the
//     opener's reference range covers the raw pot price times bf (the cash
//     rule with the ICM risk premium as a multiplier; the realization factors
//     are the cash calibration, flh 0.65, flo8 0.55, until measured).
//
// STANDS ASIDE (the persona's answer, with a receipt naming why): a stack of
// FIXED_LIMIT_TOURNAMENT_STAND_ASIDE_BB big blinds or less (the push/fold and
// jam modules own that zone), an All-In-Or-Fold table, a satellite seat that is
// locked (V37 satelliteRead), and a tournament context that cannot give a
// bubble factor (incomplete context). The flat riskAdd survival premium is not
// added again: bf is the pressure term here.
//
// Pure: no random draws, no state. HorseLogic builds the context only at a
// fixed-limit TOURNAMENT table with the option on; cash tables never reach it.

/** At or below this stack (big blinds) the tournament version stands aside. */
export const FIXED_LIMIT_TOURNAMENT_STAND_ASIDE_BB = 10;
/** Below this stack (big blinds) the first-in share is scaled down. */
export const FIXED_LIMIT_TOURNAMENT_SHORT_BB = 25;
/** Only above this bubble factor may a persona open fold. */
export const FIXED_LIMIT_TOURNAMENT_TIGHTEN_BF = 1.15;

export type FixedLimitTournamentStandAside =
  | 'short_stack'
  | 'all_in_or_fold'
  | 'satellite_locked'
  | 'incomplete_context';

/** What HorseLogic hands HorsePreflop (PreflopCtx.fixedLimitTournamentPriced). */
export interface FixedLimitTournamentPricedCtx {
  variant: FixedLimitPreflopVariant;
  /** hands dealt in */
  dealt: number;
  /** players still to act behind hero (preflopPlayersBehind), null unknown */
  behind: number | null;
  /** players behind the single raiser when it raised, null unknown */
  openerBehind: number | null;
  /** the single raiser is all in */
  openerAllIn: boolean;
  /** hero's bubble factor (>= 1), null when the context cannot give it */
  bubbleFactor: number | null;
  /** set by HorseLogic for the table-level stand-asides (AIOF, locked seat) */
  standAside: FixedLimitTournamentStandAside | null;
}

export interface FixedLimitTournamentPricedSpot {
  priced: FixedLimitTournamentPricedCtx;
  strength: number;
  tightness: number;
  stackBB: number;
  raises: number;
  limpers: number;
  callers: number;
  toCall: number;
  bigBlind: number;
  currentBet: number;
  blind: 'sb' | 'bb' | null;
  /** the RAW pot price of calling, call / (pot + call) */
  odds: number;
  /** a maniac behind: the open bar may not go below this (strength) */
  maniacOpenBar?: number;
}

export type FixedLimitTournamentPricedReceipt =
  | 'fixed_limit_tournament_priced_first_in'
  | 'fixed_limit_tournament_priced_blind_defence'
  | `fixed_limit_tournament_priced_stand_aside_${FixedLimitTournamentStandAside}`;

export interface FixedLimitTournamentPricedResult {
  /** null: the persona's answer stands (a stand-aside, receipted) */
  intent: { a: 'fold' | 'check' | 'call' | 'raiseTo'; to?: number } | null;
  receipt: FixedLimitTournamentPricedReceipt;
  share?: number;
  bar?: number;
  bubbleFactor?: number;
  equity?: number;
  required?: number;
}

/** The short-stack scaling of a first-in share (1 at 25 big blinds and deeper). */
export function fixedLimitTournamentShortStackMul(stackBB: number): number {
  if (!(stackBB < FIXED_LIMIT_TOURNAMENT_SHORT_BB)) return 1;
  const span = FIXED_LIMIT_TOURNAMENT_SHORT_BB - FIXED_LIMIT_TOURNAMENT_STAND_ASIDE_BB;
  return 0.8 + 0.2 * clamp((stackBB - FIXED_LIMIT_TOURNAMENT_STAND_ASIDE_BB) / span, 0, 1);
}

/** The tournament first-in share and raise bar for a seat under bubble factor bf, or null. */
export function fixedLimitTournamentFirstInBar(
  priced: FixedLimitTournamentPricedCtx,
  tightness: number,
  stackBB: number,
  bf: number
): { share: number; raiseBar: number } | null {
  const ref = fixedLimitOpenShare(priced.variant, priced.dealt, priced.behind);
  if (!ref) return null;
  const pressure = Number.isFinite(bf) && bf > 1 ? bf : 1;
  const share = clamp(
    (ref.raise *
      fixedLimitPersonaShareMul(tightness) *
      fixedLimitTournamentShortStackMul(stackBB)) /
      pressure,
    0,
    1
  );
  return { share, raiseBar: fixedLimitStrengthAtTopShare(priced.variant, share) };
}

/**
 * The tournament answer for this spot. Null when the spot is not one of the
 * two families (the persona's answer `inner` stands, no receipt). A result
 * with intent null is a stand-aside (the persona's answer stands, receipted).
 */
export function fixedLimitTournamentPricedPreflopIntent(
  spot: FixedLimitTournamentPricedSpot,
  inner: { a: string }
): FixedLimitTournamentPricedResult | null {
  const p = spot.priced;
  const bb = spot.bigBlind > 0 ? spot.bigBlind : 1;
  const firstIn =
    spot.raises === 0 &&
    spot.limpers === 0 &&
    spot.callers === 0 &&
    spot.blind !== 'bb' &&
    spot.currentBet <= bb * 1.05;
  const defence =
    inner.a === 'fold' &&
    spot.raises === 1 &&
    spot.limpers === 0 &&
    spot.callers === 0 &&
    spot.blind !== null &&
    spot.toCall > 0 &&
    !p.openerAllIn;
  if (!firstIn && !defence) return null;
  const standAside: FixedLimitTournamentStandAside | null =
    p.standAside ??
    (!(spot.stackBB > FIXED_LIMIT_TOURNAMENT_STAND_ASIDE_BB)
      ? 'short_stack'
      : p.bubbleFactor === null || !Number.isFinite(p.bubbleFactor)
        ? 'incomplete_context'
        : null);
  if (standAside !== null) {
    return { intent: null, receipt: `fixed_limit_tournament_priced_stand_aside_${standAside}` };
  }
  const bf = Math.max(1, p.bubbleFactor as number);
  if (firstIn) {
    const bars = fixedLimitTournamentFirstInBar(p, spot.tightness, spot.stackBB, bf);
    if (!bars) return null;
    const raiseBar =
      spot.maniacOpenBar !== undefined
        ? Math.max(bars.raiseBar, spot.maniacOpenBar)
        : bars.raiseBar;
    const base = {
      receipt: 'fixed_limit_tournament_priced_first_in' as const,
      share: bars.share,
      bar: raiseBar,
      bubbleFactor: bf,
    };
    const personaWagers = inner.a === 'raiseTo' || inner.a === 'jam';
    if (personaWagers) {
      // Never tighter than the persona at chip value; under real payout
      // pressure an open outside the share at bf folds.
      if (bf > FIXED_LIMIT_TOURNAMENT_TIGHTEN_BF && spot.strength < raiseBar)
        return { ...base, intent: spot.toCall > 0 ? { a: 'fold' } : { a: 'check' } };
      return null;
    }
    if (inner.a === 'fold' || inner.a === 'check') {
      if (spot.strength >= raiseBar)
        return { ...base, intent: { a: 'raiseTo', to: spot.currentBet + bb } };
    }
    return null;
  }
  // A BLIND FACING EXACTLY ONE RAISE: the persona's fold becomes a call when
  // the realized equity covers the price times the bubble factor.
  const d = fixedLimitBlindDefence({
    variant: p.variant,
    dealt: p.dealt,
    strength: spot.strength,
    openerBehind: p.openerBehind,
    behind: spot.blind === 'sb' ? Math.max(0, p.behind ?? 1) : 0,
    odds: spot.odds,
    riskAdd: 0,
  });
  if (!d) return null;
  const required = spot.odds * bf;
  if (!(d.realized >= required)) return null;
  return {
    intent: { a: 'call' },
    receipt: 'fixed_limit_tournament_priced_blind_defence',
    equity: d.equity,
    required,
    bubbleFactor: bf,
  };
}
