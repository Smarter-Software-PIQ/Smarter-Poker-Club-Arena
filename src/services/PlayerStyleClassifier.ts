/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PLAYER STYLE CLASSIFIER — Premium-Style Auto-Labeling
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Automatically classifies players into archetypes based on live VPIP/PFR/AF:
 *   S   Shark  — Selective + Aggressive (TAG with edge)
 *   F   Fish   - Loose + Passive (high VPIP, LOW PFR relative to VPIP)
 *   R   Rock   — Ultra-tight + Passive (low VPIP, low PFR)
 *   M   Maniac — Hyper-aggressive + Loose
 *   T   TAG    — Tight-Aggressive (standard solid)
 *   L   LAG    — Loose-Aggressive
 *   N   Nit    — Extremely tight (even tighter than Rock)
 *   CS  Calling Station — Calls everything, never raises
 *
 * Badge icons are single letters (CS is the one two-letter case). The set was
 * migrated off emoji in 2026-08 because CLAUDE.md forbids emoji in code and
 * because emoji render at wildly different sizes across platforms, which made
 * the badge jitter on mobile. Shark and Fish were missed by that migration and
 * are brought into line here.
 *
 * Classification is based on real poker statistics:
 * - VPIP: Voluntarily Put $ In Pot (measures looseness)
 * - PFR: Pre-Flop Raise % (measures preflop aggression)
 * - AF: Aggression Factor = (bets+raises) / calls
 */

export type PlayerStyle =
  | 'shark'
  | 'fish'
  | 'rock'
  | 'maniac'
  | 'tag'
  | 'lag'
  | 'nit'
  | 'calling_station'
  | 'unknown';

export interface PlayerStyleResult {
  style: PlayerStyle;
  label: string;
  icon: string;
  color: string;
  /** Hex background for the badge */
  bgColor: string;
  /** Confidence 0-1 based on sample size */
  confidence: number;
  /** Short tactical note */
  tooltip: string;
  /**
   * Whether the title is printed on a SHAREABLE image (2026-11-04). The
   * share card is made to be posted; a title that reads as a put-down on a
   * card the player made to show off is a complaint every time, however
   * accurate. Shark, TAG and LAG go on the image. The rest stay on the
   * player's private stats page, where the full honest read lives.
   */
  shareable: boolean;
  /**
   * Why this title, in the player's own numbers (2026-11-04): "Plays 34% Of
   * Hands And Raises Half Of Them". Printed under the badge so the player can
   * see the arithmetic instead of writing in to ask whether it is wrong.
   */
  reason: string;
}

/**
 * How loose a normal range is in each game, relative to No-Limit Hold'em
 * (2026-11-04). The decision tree's VPIP bands are Hold'em bands; in Omaha a
 * 34% VPIP is an ordinary range, not a loose one, and in Short Deck it is
 * tight. A player's VPIP is divided by the hand-weighted factor of the games
 * he plays before the bands are applied, so a PLO regular is judged against
 * PLO ranges. PFR / VPIP (how much of the range is raised) is game-neutral
 * and is not scaled. Unknown variants scale as Hold'em.
 */
export const VARIANT_LOOSENESS: Record<string, number> = {
  nlh: 1,
  flh: 1.1,
  pineapple: 1.15,
  crazy_pineapple: 1.15,
  short_deck: 1.35,
  shortdeck: 1.35,
  plo: 1.3,
  plo4: 1.3,
  omaha_hilo: 1.3,
  plo_hilo: 1.3,
  plo5: 1.4,
  plo6: 1.5,
};

export interface ClassifyInput {
  handsPlayed: number;
  vpipCount: number;
  pfrCount: number;
  /** Total aggressive actions (bets + raises) */
  aggressiveActions?: number;
  /** Total passive actions (calls + checks) */
  passiveActions?: number;
  /** Total 3-bets */
  threeBetCount?: number;
  /** Went to showdown count */
  wtsdCount?: number;
  /**
   * Hands per game variant in the sample, for the game-aware VPIP scale
   * (VARIANT_LOOSENESS). Omit, and the player is judged against Hold'em.
   */
  variantHands?: ReadonlyArray<{ variant: string; hands: number }>;
}

/**
 * The hand-weighted looseness factor of a game mix: 1 for pure Hold'em,
 * 1.3 for pure PLO, somewhere between for a mixed-game grinder.
 */
export function gameLoosenessFactor(
  variantHands: ReadonlyArray<{ variant: string; hands: number }> | undefined
): number {
  if (!variantHands || variantHands.length === 0) return 1;
  let hands = 0;
  let weighted = 0;
  for (const row of variantHands) {
    const n = Number.isFinite(row.hands) && row.hands > 0 ? row.hands : 0;
    if (n === 0) continue;
    const key = String(row.variant || '').toLowerCase();
    hands += n;
    weighted += n * (VARIANT_LOOSENESS[key] ?? 1);
  }
  return hands > 0 ? weighted / hands : 1;
}

/** The games a factor describes, for the reason line. */
function gameWord(factor: number): string {
  if (factor >= 1.45) return 'PLO6';
  if (factor >= 1.37) return 'PLO5';
  if (factor >= 1.33) return 'Short Deck';
  if (factor >= 1.2) return 'PLO';
  if (factor > 1.02) return 'Your Game Mix';
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const STYLE_MAP: Record<PlayerStyle, Omit<PlayerStyleResult, 'style' | 'confidence' | 'reason'>> = {
  shark: {
    label: 'Shark',
    icon: 'S',
    color: '#60A5FA',
    bgColor: 'rgba(96, 165, 250, 0.2)',
    tooltip: 'Selective & Aggressive - Plays Few Hands But Attacks',
    shareable: true,
  },
  fish: {
    label: 'Fish',
    icon: 'F',
    color: '#34D399',
    bgColor: 'rgba(52, 211, 153, 0.2)',
    tooltip: 'Plays Too Many Hands Passively - Vulnerable To Aggression',
    shareable: false,
  },
  rock: {
    label: 'Rock',
    icon: 'R',
    color: '#9CA3AF',
    bgColor: 'rgba(156, 163, 175, 0.2)',
    tooltip: 'Ultra-Tight - Only Plays Premium Hands',
    shareable: false,
  },
  maniac: {
    label: 'Maniac',
    icon: 'M',
    color: '#F87171',
    bgColor: 'rgba(248, 113, 113, 0.2)',
    tooltip: 'Hyper-Aggressive - Raises And Re-Raises Constantly',
    shareable: false,
  },
  tag: {
    label: 'TAG',
    icon: 'T',
    color: '#A78BFA',
    bgColor: 'rgba(167, 139, 250, 0.2)',
    tooltip: 'Tight-Aggressive - Solid, Balanced Style',
    shareable: true,
  },
  lag: {
    label: 'LAG',
    icon: 'L',
    color: '#FBBF24',
    bgColor: 'rgba(251, 191, 36, 0.2)',
    tooltip: 'Loose-Aggressive - Wide Range With Heavy Pressure',
    shareable: true,
  },
  nit: {
    label: 'Nit',
    icon: 'N',
    color: '#6EE7B7',
    bgColor: 'rgba(110, 231, 183, 0.15)',
    tooltip: 'Extremely Tight - Folds Almost Everything',
    shareable: false,
  },
  calling_station: {
    label: 'Station',
    icon: 'CS',
    color: '#FB923C',
    bgColor: 'rgba(251, 146, 60, 0.2)',
    tooltip: 'Calling Station - Calls Down With Weak Hands',
    shareable: false,
  },
  unknown: {
    label: '?',
    icon: '?',
    color: '#6B7280',
    bgColor: 'rgba(107, 114, 128, 0.15)',
    tooltip: 'Not Enough Data To Classify',
    shareable: false,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFIER
// ═══════════════════════════════════════════════════════════════════════════════

class PlayerStyleClassifierClass {
  /** Minimum hands before we classify (below this → "unknown") */
  private readonly MIN_SAMPLE = 15;

  /**
   * Classify a player based on their stats.
   * Uses a decision-tree approach matching player archetypes.
   */
  classify(input: ClassifyInput): PlayerStyleResult {
    const {
      handsPlayed,
      vpipCount,
      pfrCount,
      aggressiveActions = 0,
      passiveActions = 0,
      variantHands,
    } = input;

    // Not enough data
    if (handsPlayed < this.MIN_SAMPLE) {
      return {
        style: 'unknown',
        ...STYLE_MAP.unknown,
        confidence: 0,
        reason: `Fewer Than ${this.MIN_SAMPLE} Hands Recorded`,
      };
    }

    const vpip = (vpipCount / handsPlayed) * 100;
    const pfr = (pfrCount / handsPlayed) * 100;
    const af =
      passiveActions > 0 ? aggressiveActions / passiveActions : aggressiveActions > 0 ? 5 : 1;

    // Confidence scales with sample size (15 hands = 0.3, 100+ hands = 1.0)
    const confidence = Math.min(1, handsPlayed / 100);

    // Game-aware: a PLO range is judged against PLO, not Hold'em.
    const factor = gameLoosenessFactor(variantHands);
    const vpipForBands = vpip / factor;

    const style = this.classifyFromStats(vpipForBands, pfr, af);
    return {
      style,
      ...STYLE_MAP[style],
      confidence,
      reason: this.describe(vpip, pfr, af, factor),
    };
  }

  /**
   * The title's arithmetic, in words the player can check against his own
   * card. Title Case, no em dashes (CLAUDE.md 5.7 applies wherever a player
   * reads it).
   */
  private describe(vpip: number, pfr: number, af: number, factor: number): string {
    const ratio = vpip > 0 ? pfr / vpip : 0;
    const game = gameWord(factor);
    const plays = `Plays ${Math.round(vpip)}% Of Hands${game ? ` (Judged Against ${game} Ranges)` : ''}`;
    let raises: string;
    if (pfr < 1) raises = 'Almost Never Raises Before The Flop';
    else if (ratio >= 0.75) raises = 'Raises Almost All Of Them';
    else if (ratio >= 0.6) raises = 'Raises Most Of Them';
    else if (ratio >= 0.45) raises = 'Raises About Half Of Them';
    else if (ratio >= 0.3) raises = 'Raises About A Third Of Them';
    else raises = 'Mostly Calls Rather Than Raises';
    const after =
      af >= 2.5
        ? 'Bets And Raises Hard After The Flop'
        : af < 1
          ? 'Mostly Calls After The Flop'
          : '';
    return `${plays}, ${raises}${after ? `, ${after}` : ''}`;
  }

  /**
   * Core classification logic.
   *
   * REWRITTEN 2026-11-04. A KINGS CLUB regular running 34.3% VPIP / 17.1% PFR
   * at +13.6 bb/100 over 1,623 hands was being titled "Fish". Nothing was
   * random about it: he missed the Fish rule proper (VPIP > 35), missed LAG
   * (PFR > 18) and TAG (VPIP <= 28), and dropped into a catch-all that titled
   * ANY player over 30% VPIP a Fish whenever their aggression factor was under
   * 2.0. That catch-all was the bug. A Fish is loose AND passive, and the
   * passive half is measured preflop by how rarely a player raises the hands
   * he plays, not by a postflop ratio alone. The platform's aggression factor
   * also counted preflop calls in its denominator until migration
   * 20261104195454 made it postflop-only at the source; an older payload still
   * carries the deflated number, so AF can only ever be a secondary signal
   * here.
   *
   * The primary read is therefore VPIP (how many hands) and PFR / VPIP (how
   * many of them were raised). AF breaks ties. Every branch is reachable and
   * every player lands in exactly one archetype; there is no longer a branch
   * that labels a raiser passive.
   *
   * Reference ranges (full-ring / 6-max cash, industry HUD conventions):
   *   VPIP < 12%  = Very tight       PFR/VPIP >= 0.60 = raises most of what he plays
   *   VPIP 12-18% = Tight            PFR/VPIP 0.45-0.60 = mixed raise/call
   *   VPIP 18-28% = Standard         PFR/VPIP < 0.35 = mostly calls (passive)
   *   VPIP 28-40% = Loose            AF >= 2.5 = aggressive (postflop convention)
   *   VPIP > 40%  = Very loose       AF < 1.5 = passive
   */
  private classifyFromStats(vpip: number, pfr: number, af: number): PlayerStyle {
    const ratio = vpip > 0 ? Math.min(1, pfr / vpip) : 0;

    // ── Nit: Ultra-tight, barely plays anything ──
    if (vpip < 12 && pfr < 8) {
      return 'nit';
    }

    // ── Rock: Tight and passive (few hands, and calls more than it raises) ──
    if (vpip < 18 && (pfr < 10 || ratio < 0.5) && af < 2.5) {
      return 'rock';
    }

    // ── Maniac: Very loose + very aggressive, preflop or postflop ──
    if (vpip > 40 && pfr > 25 && (af > 2.5 || ratio >= 0.6)) {
      return 'maniac';
    }

    // ── Calling Station: Very loose + almost never raises + passive postflop ──
    if (vpip > 40 && pfr < 12 && af < 1.5) {
      return 'calling_station';
    }

    // ── Fish: Loose + passive. Passive means a LOW raise rate, not a middling AF ──
    if (vpip > 30 && (pfr < 12 || ratio < 0.35)) {
      return 'fish';
    }

    // ── Shark: Selective + highly aggressive ──
    if (vpip >= 18 && vpip <= 28 && pfr >= 15 && pfr <= 25 && af >= 2.5) {
      return 'shark';
    }

    // ── LAG: Loose + aggressive (raises close to half of what it plays, or more) ──
    if (vpip > 28 && pfr >= 15 && (ratio >= 0.45 || af >= 2.0)) {
      return 'lag';
    }

    // ── TAG: Standard range, raises most of what it plays ──
    if (vpip >= 15 && vpip <= 28 && pfr >= 10 && ratio >= 0.5) {
      return 'tag';
    }

    // ── Loose players not caught above: split on how much of the range is raised ──
    if (vpip > 28) {
      return ratio < 0.45 && af < 2.0 ? 'fish' : 'lag';
    }

    // ── Standard-or-tighter players not caught above: same split ──
    return ratio < 0.5 ? 'rock' : 'tag';
  }

  /**
   * Get just the style label for a set of stats (convenience method).
   */
  getStyleLabel(input: ClassifyInput): string {
    const result = this.classify(input);
    return `${result.icon} ${result.label}`;
  }

  /**
   * Get all available style definitions.
   */
  getStyleDefinitions(): Record<
    PlayerStyle,
    Omit<PlayerStyleResult, 'style' | 'confidence' | 'reason'>
  > {
    return { ...STYLE_MAP };
  }
}

export const playerStyleClassifier = new PlayerStyleClassifierClass();
export default playerStyleClassifier;
