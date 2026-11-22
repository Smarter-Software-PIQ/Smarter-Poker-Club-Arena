/**
 * The depth that admits a Horse to the PLO4 (Phase 10) and PLO5/6/8 (Phase 11)
 * Omaha strategy packs. EMERG lane PACK, 2026-11-19 (owner 7:31 PM Chicago:
 * the Horses bleed in PLO4/PLO5; 7:38 PM: math first).
 *
 * Measured bug (48-hour dataset, cash): the gate took the depth against the
 * DEEPEST live opponent, including a player who had already called and could
 * not be the one the Horse plays the bet against, and refused the whole pack
 * above the pack's deepest band (maxStackBB, 250 bb): 5,809 PLO5 decisions in
 * 48 hours fell back to the reference brain with reason
 * depth_or_ante_outside_pack (hand 5e9a7188: the Horse faced a 104 bb
 * person's flop bet heads-up, the depth recorded was 253 bb against a Horse
 * who had only called).
 *
 * Two default-off options, both read `=== true`:
 * - effective: facing a bet, the depth is the effective stack between the
 *   Horse and the opponents still in the hand against that bet: the
 *   aggressor and every live opponent who still owes action (not all in,
 *   street bet below the current bet). Not facing a bet, every live opponent
 *   (unchanged). Heads-up that is the one opponent.
 * - clamp: an effective depth above the pack's deepest band is played in that
 *   band (the pack's measured numbers saturate at 100 bb: its depth weight is
 *   clamp((depth - 8) / 92)), instead of refusing the pack.
 * With both off the result is the legacy number and basis exactly.
 */
import type { SeatPlayer } from '../../types.js';

export type OmahaPackDepthOptions = Readonly<{
  /** omahaPackEffectiveDepth */
  effective?: boolean;
  /** omahaPackClampDeepDepth */
  clamp?: boolean;
}>;

export const OMAHA_PACK_DEPTH_BASES = Object.freeze([
  'stack_plus_street_bet_vs_deepest_contesting_opponent',
  'stack_plus_street_bet_vs_deepest_contesting_opponent_clamped_to_deepest_band',
  'stack_plus_street_bet_vs_opponents_contesting_this_bet',
  'stack_plus_street_bet_vs_opponents_contesting_this_bet_clamped_to_deepest_band',
] as const);
export type OmahaPackDepthBasis = (typeof OMAHA_PACK_DEPTH_BASES)[number];

export type OmahaPackDepth = Readonly<{
  /** The depth the gate reads, in big blinds (clamped when the basis says so). */
  depth: number;
  /** The opponent cover the depth was taken against, in chips. */
  opponentCover: number;
  basis: OmahaPackDepthBasis;
}>;

type ActionRow = Readonly<{
  userId?: string;
  seat: number;
  stage?: string;
  action: string;
  isFullRaise?: boolean;
}>;

/**
 * `active`: the live opponents the policy already selected (not the hero, not
 * folded, away only when all in). `aggressorSeat`: the last bet or raise of
 * another player on this street (the same row the policy records).
 */
export function omahaPackDepth(
  hero: Pick<SeatPlayer, 'stack' | 'bet'>,
  active: readonly Pick<SeatPlayer, 'seat' | 'stack' | 'bet' | 'is_all_in'>[],
  currentBet: number,
  bigBlind: number,
  aggressorSeat: number | null,
  maxStackBB: number,
  options: OmahaPackDepthOptions = {}
): OmahaPackDepth {
  const cover = (p: Pick<SeatPlayer, 'stack' | 'bet'>) => p.stack + p.bet;
  let set = active;
  if (options.effective === true && currentBet > hero.bet) {
    const owes = (p: (typeof active)[number]) => !p.is_all_in && p.bet < currentBet;
    let contesting = active.filter((p) => p.seat === aggressorSeat || owes(p));
    // No recorded aggressor (a blind or a limp is the bet): the players who
    // put the current bet in are the bettors.
    if (aggressorSeat === null || !active.some((p) => p.seat === aggressorSeat))
      contesting = active.filter((p) => owes(p) || p.bet >= currentBet);
    if (contesting.length) set = contesting;
  }
  const opponentCover = Math.max(...set.map(cover));
  const raw = Math.min(cover(hero), opponentCover) / bigBlind;
  const vs =
    set === active
      ? 'stack_plus_street_bet_vs_deepest_contesting_opponent'
      : 'stack_plus_street_bet_vs_opponents_contesting_this_bet';
  if (options.clamp === true && Number.isFinite(raw) && raw > maxStackBB)
    return Object.freeze({
      depth: maxStackBB,
      opponentCover,
      basis: `${vs}_clamped_to_deepest_band` as OmahaPackDepthBasis,
    });
  return Object.freeze({ depth: raw, opponentCover, basis: vs });
}

/** Receipt check: the recorded effective depth is the one the basis gives. */
export function omahaPackDepthBindingIsConsistent(
  effectiveBB: number,
  heroCoverBB: number,
  opponentCoverBB: number,
  basis: unknown,
  maxStackBB: number
): boolean {
  if (!(OMAHA_PACK_DEPTH_BASES as readonly unknown[]).includes(basis)) return false;
  const raw = Math.min(heroCoverBB, opponentCoverBB);
  if (String(basis).endsWith('_clamped_to_deepest_band'))
    return raw > maxStackBB && Math.abs(effectiveBB - maxStackBB) <= 1e-6;
  return Math.abs(effectiveBB - raw) <= 1e-6;
}

export function omahaAggressorSeat(
  heroUserId: string,
  stage: string,
  history: readonly ActionRow[] | undefined
): number | null {
  const row = (history ?? [])
    .filter(
      (a) =>
        a.userId !== heroUserId &&
        a.stage === stage &&
        (a.action === 'bet' ||
          a.action === 'raise' ||
          (a.action === 'all_in' && a.isFullRaise !== undefined))
    )
    .at(-1);
  return row ? row.seat : null;
}
