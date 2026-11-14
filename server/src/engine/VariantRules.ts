/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VARIANT RULES — how many cards, which hand rules, which deck
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The companion to BettingStructure.ts. That module answers "how may you
 * wager?"; this one answers "what are you playing?" — hole-card count, whether
 * the exactly-two-from-hand Omaha rule applies, whether the pot splits hi-lo,
 * and which deck is in use.
 *
 * ── WHY IT EXISTS (2026-08-23) ────────────────────────────────────────────────
 * Adding `flo8` (Fixed Limit Omaha Hi-Lo) exposed that these four facts were
 * decided independently in FIVE places, every one of them by a substring test
 * on the variant string:
 *
 *   HandController.getCardsPerPlayer()      switch, default 2
 *   ServerTableEngineDealing                a local CARDS_PER_PLAYER const
 *   HandController showdown                 gameVariant.startsWith('plo')
 *   PokerEngine.determineWinners            gameVariant.startsWith('plo')
 *                                           && gameVariant === 'plo8'
 *   HorseEval.variantInfo                   v.startsWith('plo')
 *
 * `flo8` contains no "plo". So the same table would have been dealt TWO hole
 * cards, evaluated as Hold'em, split no low, and read by the horses as a
 * Hold'em board — while calling itself Omaha Hi-Lo. `determineWinners` is the
 * one that actually moves money, so this was not cosmetic: the wrong player
 * wins the pot.
 *
 * That is not a bug in `flo8`. It is what happens when a fact lives in five
 * places and every copy is a guess made from spelling. One table, asked once.
 *
 * A sixth copy exists on purpose in `src/lib/holeCardCount.ts` — the browser
 * bundle cannot import `server/` — and `tests/unit/holeCardCount.test.ts` pins
 * it against this file.
 */

import type { GameVariant, HorseVariantRules } from '../types.js';

/**
 * Hole cards dealt, per variant.
 *
 * Keyed loosely (string, not GameVariant) because callers hold a raw
 * `tables.game_variant` column, which is `text` with no constraint — legacy and
 * hand-typed values reach here. Anything unrecognised falls back to two rather
 * than throwing: an unknown variant should deal a plausible hand, not kill the
 * table. That fallback is exactly what silently made `flo8` a Hold'em game, so
 * `assertKnownVariant` below exists for callers that would rather find out.
 */
const HOLE_CARDS: Readonly<Record<string, number>> = {
  nlh: 2,
  short_deck: 2,
  flh: 2,
  pineapple: 3,
  plo4: 4,
  plo5: 5,
  plo6: 6,
  plo8: 4,
  flo8: 4,
  // Owner November 14, 2026: fixed-limit Omaha in every card count. Each is
  // the pot-limit game's deal and hand rules with fixed-limit betting. Dealt
  // here, but outside KNOWN_VARIANTS below: see that list for why.
  flo4: 4,
  flo5: 5,
  flo6: 6,
};

/** Variants where a hand is exactly two hole cards plus exactly three board. */
const OMAHA_VARIANTS = new Set(['plo4', 'plo5', 'plo6', 'plo8', 'flo4', 'flo5', 'flo6', 'flo8']);

/** Variants where the pot splits between the high hand and a qualifying low. */
const HI_LO_VARIANTS = new Set(['plo8', 'flo8']);

/** Variants dealt from a 36-card deck (deuces through fives stripped). */
const SHORT_DECK_VARIANTS = new Set(['short_deck']);

export const DEFAULT_HOLE_CARDS = 2;
export const FULL_DECK_SIZE = 52;
export const SHORT_DECK_SIZE = 36;

const norm = (variant?: string | null): string => (variant || 'nlh').toLowerCase();

/** How many hole cards `variant` deals. Two for Hold'em and the unknown. */
export function holeCardCount(variant?: string | null): number {
  return HOLE_CARDS[norm(variant)] ?? DEFAULT_HOLE_CARDS;
}

/**
 * True when the hand must use EXACTLY two hole cards and exactly three board
 * cards. Note this is about the hand-forming rule, not about the word "Omaha":
 * `flo8` is Omaha by this rule even though its name and its betting say limit.
 */
export function isOmahaVariant(variant?: string | null): boolean {
  return OMAHA_VARIANTS.has(norm(variant));
}

/** True when the pot splits hi-lo with an 8-or-better qualifier. */
export function isHiLoVariant(variant?: string | null): boolean {
  return HI_LO_VARIANTS.has(norm(variant));
}

/** True when the variant is dealt from the 36-card short deck. */
export function isShortDeckVariant(variant?: string | null): boolean {
  return SHORT_DECK_VARIANTS.has(norm(variant));
}

/** Cards in the deck this variant is dealt from. */
export function deckSizeFor(variant?: string | null): number {
  return isShortDeckVariant(variant) ? SHORT_DECK_SIZE : FULL_DECK_SIZE;
}

/**
 * Public rules compiled into every live horse snapshot. Keeping this beside
 * the settlement/deal helpers lets the producer and worker validate the exact
 * same variant contract instead of maintaining another spelling-based copy.
 */
export function horseVariantRulesFor(variant?: string | null): HorseVariantRules {
  const normalized = norm(variant);
  const omaha = isOmahaVariant(normalized);
  return {
    holeCardsDealt: holeCardCount(normalized),
    holeCardsUse: normalized === 'pineapple' ? 'discard_to_two' : omaha ? 'exactly_two' : 'any',
    boardCardsUse: omaha ? 'exactly_three' : 'any',
    deckSize: deckSizeFor(normalized),
    splitLow8OrBetter: isHiLoVariant(normalized),
  };
}

/**
 * The most seats this variant can physically deal: the deck, less the five
 * board cards, divided by the hole cards each player takes.
 *
 * The deal path already refuses a table it cannot serve; this is that rule
 * written once so the guard and the seat-limit UI cannot disagree.
 */
export function maxSeatsFor(variant?: string | null): number {
  return Math.floor((deckSizeFor(variant) - 5) / holeCardCount(variant));
}

/**
 * Is this a variant this module has actually been taught?
 *
 * `holeCardCount` deliberately falls back to two, which is the right runtime
 * behaviour and the wrong development behaviour — it is how a four-card game
 * gets dealt two cards in silence. Call this where a wrong answer would move
 * money, and log rather than guess.
 */
export function isKnownVariant(variant?: string | null): variant is GameVariant {
  // Deliberately does NOT go through `norm`, which substitutes 'nlh' for a
  // missing value. That substitution is right for the runtime getters — a seat
  // mid-join should draw a plausible hand — and exactly wrong here: a caller
  // asking "do we know this?" about `undefined` must be told no, or the guard
  // certifies the very silence it exists to catch.
  if (!variant) return false;
  return (KNOWN_VARIANTS as readonly string[]).includes(variant.toLowerCase());
}

/**
 * The variants the horse decision programme has been taught: every per-variant
 * pack, the Phase 13 joint owner (its contract numbers each variant by its
 * place in this list, so the ORDER is fixed), the learning captures and the
 * corrective review are built over exactly these nine, and each refuses a
 * variant outside them by name rather than guessing.
 *
 * The fixed-limit Omahas (owner November 14, 2026) are dealt by HOLE_CARDS
 * above and are deliberately NOT here. A horse at those tables plays the
 * reference brain (HorsePolicyRegistry owner 'reference'), which reads the
 * deal, the Omaha hand rules and the fixed-limit betting from this module and
 * BettingStructure; no pack, joint sample or learning capture is applied to a
 * game nobody has measured. Teaching the programme a variant is adding it here
 * together with its packs, contract rows and evidence.
 */
export const KNOWN_VARIANTS: readonly GameVariant[] = Object.freeze([
  'nlh',
  'short_deck',
  'flh',
  'pineapple',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flo8',
] as const);

/** Fixed-limit Omaha, high only, in 4, 5 and 6 card (owner November 14, 2026). */
export const FIXED_LIMIT_OMAHA_HIGH_VARIANTS = Object.freeze(['flo4', 'flo5', 'flo6'] as const);
export type FixedLimitOmahaHighVariant = (typeof FIXED_LIMIT_OMAHA_HIGH_VARIANTS)[number];

/** Every variant the engine deals: the known nine plus the fixed-limit Omahas. */
export const DEALT_VARIANTS: readonly string[] = Object.freeze(Object.keys(HOLE_CARDS));

/** True when the engine deals this variant (its hole cards are not a guess). */
export function isDealtVariant(variant?: string | null): boolean {
  if (!variant) return false;
  return Object.prototype.hasOwnProperty.call(HOLE_CARDS, variant.toLowerCase());
}
