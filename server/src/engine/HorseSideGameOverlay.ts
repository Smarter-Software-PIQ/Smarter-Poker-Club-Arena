/**
 * Side-game overlays for cash tables:
 *   1. Seven-Deuce (7-2) bounty pot overlay and opponent postflop bluff-rate adjustment
 *   2. Fixed-limit / cash Kill and Half-Kill pot effective-stake and killer-option normalization
 *
 * Pure, deterministic, zero-I/O computation. Does not import stateful services so
 * reference decision source closure stays minimal and self-contained.
 */

import type { Card, HandStage, SeatPlayer } from '../types.js';
import type { KillHandState } from './KillPot.js';

export interface SideGameStateInput {
  gameVariant?: string;
  isTournament?: boolean;
  stage?: HandStage | string;
  bigBlind: number;
  pot: number;
  currentBet: number;
  heroSeat: number;
  heroStack: number;
  heroCards?: ReadonlyArray<Pick<Card, 'rank'>>;
  players?: ReadonlyArray<
    Pick<
      SeatPlayer,
      'seat' | 'user_id' | 'stack' | 'bet' | 'is_folded' | 'is_sitting_out' | 'is_all_in'
    >
  >;
  dealtSeatIds?: readonly number[];
  /** Canonical KillHandState from KillPot.ts when active on this deal. */
  killPot?: KillHandState | null;
  /** Effective fixed-limit small bet from HandController when on a kill hand. */
  fixedLimitSmallBet?: number | null;
  /** Optional flat kill-pot overrides for callers/tests without a full KillHandState. */
  isKillPot?: boolean;
  killMultiplier?: number;
  killPosterSeat?: number | null;
  killBlind?: number | null;
  /** Seven-deuce table configuration (supports table-level or snapshot-level fields). */
  sevenDeuceEnabled?: boolean;
  sevenDeuceBounty?:
    | number
    | { enabled?: boolean; bountyBB?: number; perPlayerAmount?: number }
    | null;
  sevenDeuceBountyBB?: number | null;
  sevenDeuceBountyPerPlayer?: number | null;
}

export interface SevenDeuceOverlayResult {
  enabled: boolean;
  heroHoldsSevenDeuce: boolean;
  bountyPerPlayerChips: number;
  collectibleBountyChips: number;
  /**
   * Effective chips added to the pot reward if hero wins this hand after seeing a flop.
   * Postflop: full collectible bounty (flop condition already satisfied).
   * Preflop: discounted by flop-seen x postflop conversion (since preflop fold-outs do not pay 7-2).
   */
  effectivePotOverlayChips: number;
  /** Preflop strength credit for opening/isolating/defending 7-2 in cash NLH. */
  preflopStrengthBonus: number;
  /**
   * Small postflop bluff-catching credit when 7-2 is active at the table and hero does NOT
   * hold 7-2, accounting for opponents bluffing missed flops/turns/rivers to claim the bounty.
   */
  opponentBountyBluffRateBonus: number;
}

export interface KillPotNormalizationResult {
  active: boolean;
  multiplier: number;
  baseBigBlind: number;
  effectiveBigBlind: number;
  killBlind: number;
  killerSeat: number | null;
  killerBlindSlot: 'none' | 'sb' | 'bb';
  /** True when the killer posted a live blind outside SB/BB and acts last preflop if unraised. */
  killerHasLiveOption: boolean;
  /** True when hero is the killer exercising the unraised preflop option. */
  isHeroKillerOption: boolean;
}

export interface SideGameOverlaySummary {
  sevenDeuce: SevenDeuceOverlayResult;
  kill: KillPotNormalizationResult;
  /** Combined pot overlay in chips for postflop EV pricing (HorseEvEngine / HorseLogic). */
  postflopPotOverlayChips: number;
}

const DEFAULT_SEVEN_DEUCE_BOUNTY_BB = 2;

/** Pure check: true when a 2-card Hold'em hand contains one '7' and one '2'. */
export function holdsSevenDeuceHand(
  cards: ReadonlyArray<Pick<Card, 'rank'>> | undefined | null
): boolean {
  if (!cards || cards.length !== 2) return false;
  return (
    (cards[0]?.rank === '7' && cards[1]?.rank === '2') ||
    (cards[0]?.rank === '2' && cards[1]?.rank === '7')
  );
}

function resolveSevenDeuceConfig(input: SideGameStateInput): {
  enabled: boolean;
  bountyPerPlayerChips: number;
} {
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 0;
  if (bb <= 0 || input.isTournament === true) {
    return { enabled: false, bountyPerPlayerChips: 0 };
  }
  const variant = String(input.gameVariant ?? 'nlh').toLowerCase();
  if (variant !== 'nlh') {
    return { enabled: false, bountyPerPlayerChips: 0 };
  }

  const raw = input.sevenDeuceBounty;
  const rawObj = typeof raw === 'object' && raw !== null ? raw : null;
  const explicitPerPlayer =
    typeof input.sevenDeuceBountyPerPlayer === 'number' && input.sevenDeuceBountyPerPlayer > 0
      ? input.sevenDeuceBountyPerPlayer
      : typeof raw === 'number' && raw > 0
        ? raw
        : typeof rawObj?.perPlayerAmount === 'number' && rawObj.perPlayerAmount > 0
          ? rawObj.perPlayerAmount
          : null;

  const explicitBB =
    typeof input.sevenDeuceBountyBB === 'number' && input.sevenDeuceBountyBB > 0
      ? input.sevenDeuceBountyBB
      : typeof rawObj?.bountyBB === 'number' && rawObj.bountyBB > 0
        ? rawObj.bountyBB
        : null;

  const enabled =
    input.sevenDeuceEnabled === true ||
    rawObj?.enabled === true ||
    explicitPerPlayer !== null ||
    explicitBB !== null;

  if (!enabled) {
    return { enabled: false, bountyPerPlayerChips: 0 };
  }

  const perPlayer = explicitPerPlayer ?? (explicitBB ?? DEFAULT_SEVEN_DEUCE_BOUNTY_BB) * bb;
  return {
    enabled: perPlayer > 0,
    bountyPerPlayerChips: Math.round(perPlayer * 100) / 100,
  };
}

/**
 * Compute 7-2 side-bounty pot overlay and preflop/postflop adjustments.
 * Respects the exact house rule in SevenDeuceBounty.ts:
 * - Hand MUST reach the flop to award the 7-2 bounty (preflop walks/steals award 0 bounty).
 * - Each dealt-in opponent pays up to min(bountyPerPlayerChips, remainingStack).
 */
export function computeSevenDeuceOverlay(input: SideGameStateInput): SevenDeuceOverlayResult {
  const cfg = resolveSevenDeuceConfig(input);
  if (!cfg.enabled) {
    return {
      enabled: false,
      heroHoldsSevenDeuce: false,
      bountyPerPlayerChips: 0,
      collectibleBountyChips: 0,
      effectivePotOverlayChips: 0,
      preflopStrengthBonus: 0,
      opponentBountyBluffRateBonus: 0,
    };
  }

  const dealtSet =
    input.dealtSeatIds && input.dealtSeatIds.length > 0 ? new Set(input.dealtSeatIds) : null;
  const players = input.players ?? [];
  let collectible = 0;
  let payerCount = 0;

  if (players.length > 0) {
    for (const p of players) {
      if (p.seat === input.heroSeat) continue;
      if (
        dealtSet ? !dealtSet.has(p.seat) : p.is_sitting_out && !p.is_all_in && (p.bet ?? 0) <= 0
      ) {
        continue;
      }
      const avail = Math.max(0, p.stack);
      const contribution = Math.min(cfg.bountyPerPlayerChips, avail);
      if (contribution > 0) {
        collectible += contribution;
        payerCount++;
      }
    }
  } else if (dealtSet && dealtSet.size > 1) {
    payerCount = dealtSet.size - 1;
    collectible = payerCount * cfg.bountyPerPlayerChips;
  }

  collectible = Math.round(collectible * 100) / 100;
  const heroHolds = holdsSevenDeuceHand(input.heroCards);
  const stage = String(input.stage ?? 'preflop').toLowerCase();
  const sawFlop = stage === 'flop' || stage === 'turn' || stage === 'river' || stage === 'showdown';

  if (heroHolds) {
    // Postflop: flop has already been seen, so winning the pot (via fold or showdown)
    // directly collects `collectible` chips from the table!
    // Preflop: preflop fold-outs do NOT pay 7-2; seeing a flop and converting postflop
    // realizes roughly 16-22% of the full table bounty when stacks are deep enough to maneuver.
    const depthBB = input.heroStack / Math.max(0.01, input.bigBlind);
    const maneuverScale = Math.max(0, Math.min(1, (depthBB - 20) / 60));
    const effectivePotOverlayChips = sawFlop
      ? collectible
      : Math.round(collectible * (0.14 + 0.08 * maneuverScale) * 100) / 100;

    const bountyInBB = collectible / Math.max(0.01, input.bigBlind);
    // Bounded preflop bonus so 72s/72o can profitably defend BB, over-limp, or steal late
    // when the table bounty is rich (>= 6-16 BB across a full table), without reaching 3-bet/4-bet tiers.
    const preflopStrengthBonus = Math.min(0.15, bountyInBB * 0.015 * (0.4 + 0.6 * maneuverScale));

    return {
      enabled: true,
      heroHoldsSevenDeuce: true,
      bountyPerPlayerChips: cfg.bountyPerPlayerChips,
      collectibleBountyChips: collectible,
      effectivePotOverlayChips,
      preflopStrengthBonus,
      opponentBountyBluffRateBonus: 0,
    };
  }

  // Hero does NOT hold 7-2 on an active 7-2 table: ~2.4% of dealt combos are 7-2,
  // which incentivizes extra multi-barrel bluffs from opponents postflop when the pot is small/medium.
  const potPlusBounty = Math.max(input.bigBlind, input.pot + collectible);
  const bountyShare = collectible / potPlusBounty;
  const opponentBountyBluffRateBonus = sawFlop ? Math.min(0.035, 0.04 * bountyShare) : 0;

  return {
    enabled: true,
    heroHoldsSevenDeuce: false,
    bountyPerPlayerChips: cfg.bountyPerPlayerChips,
    collectibleBountyChips: collectible,
    effectivePotOverlayChips: 0,
    preflopStrengthBonus: 0,
    opponentBountyBluffRateBonus,
  };
}

/**
 * Normalize stakes, effective big blind, and killer option seat for Kill / Half-Kill hands.
 */
export function normalizeKillPotState(
  input: SideGameStateInput,
  fullRaises = 0
): KillPotNormalizationResult {
  const baseBB = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;
  const kp = input.killPot;
  if (kp && kp.killBlind > baseBB) {
    const mult =
      kp.multiplier.den > 0 ? kp.multiplier.num / kp.multiplier.den : kp.killBlind / baseBB;
    const liveOption = kp.killerBlindSlot === 'none';
    const isHeroOption =
      kp.killerSeat === input.heroSeat &&
      fullRaises === 0 &&
      Math.abs(input.currentBet - kp.killBlind) <= 0.01;
    return {
      active: true,
      multiplier: mult,
      baseBigBlind: kp.baseBigBlind > 0 ? kp.baseBigBlind : baseBB,
      effectiveBigBlind: kp.killBlind,
      killBlind: kp.killBlind,
      killerSeat: kp.killerSeat,
      killerBlindSlot: kp.killerBlindSlot,
      killerHasLiveOption: liveOption,
      isHeroKillerOption: isHeroOption,
    };
  }

  if (input.isKillPot === true) {
    const mult =
      typeof input.killMultiplier === 'number' && input.killMultiplier > 1
        ? input.killMultiplier
        : 2;
    const killBlind =
      typeof input.killBlind === 'number' && input.killBlind > baseBB
        ? input.killBlind
        : Math.round(baseBB * mult * 100) / 100;
    const killerSeat = typeof input.killPosterSeat === 'number' ? input.killPosterSeat : null;
    const isHeroOption =
      killerSeat !== null &&
      killerSeat === input.heroSeat &&
      fullRaises === 0 &&
      Math.abs(input.currentBet - killBlind) <= 0.01;
    return {
      active: true,
      multiplier: mult,
      baseBigBlind: baseBB,
      effectiveBigBlind: killBlind,
      killBlind,
      killerSeat,
      killerBlindSlot: 'none',
      killerHasLiveOption: killerSeat !== null,
      isHeroKillerOption: isHeroOption,
    };
  }

  if (
    typeof input.fixedLimitSmallBet === 'number' &&
    Number.isFinite(input.fixedLimitSmallBet) &&
    input.fixedLimitSmallBet > baseBB * 1.05
  ) {
    const smallBet = input.fixedLimitSmallBet;
    return {
      active: true,
      multiplier: Math.round((smallBet / baseBB) * 100) / 100,
      baseBigBlind: baseBB,
      effectiveBigBlind: smallBet,
      killBlind: smallBet,
      killerSeat: null,
      killerBlindSlot: 'none',
      killerHasLiveOption: false,
      isHeroKillerOption: false,
    };
  }

  return {
    active: false,
    multiplier: 1,
    baseBigBlind: baseBB,
    effectiveBigBlind: baseBB,
    killBlind: baseBB,
    killerSeat: null,
    killerBlindSlot: 'none',
    killerHasLiveOption: false,
    isHeroKillerOption: false,
  };
}

/**
 * Combined postflop + preflop side-game overlay helper for HorseLogic and HorseEvEngine.
 */
export function computeSideGamePotOverlay(
  input: SideGameStateInput,
  fullRaises = 0
): SideGameOverlaySummary {
  const sevenDeuce = computeSevenDeuceOverlay(input);
  const kill = normalizeKillPotState(input, fullRaises);
  return {
    sevenDeuce,
    kill,
    postflopPotOverlayChips: sevenDeuce.effectivePotOverlayChips,
  };
}
