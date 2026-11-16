/**
 * THE HORSE'S OWN PLAYING STYLE: three styles, one per Horse, for life.
 *
 * Owner 2026-11-15 16:40 and 16:42 America/Chicago: three winning styles for
 * PLO and Hold'em, one tight, one exactly as the Horses play now, one other;
 * each Horse is assigned one at random after it has been created; a tight
 * Horse does not sit in a 50% VPIP game and play tight there.
 *
 *   tight     tight-aggressive, value-heavy
 *   current   exactly today's play: zero deltas
 *   pressure  loose-aggressive IN POSITION only; out of position it is current
 *
 * This module is SHARED by every game lane. It owns only the assignment and
 * the table rule; what a style changes in a game lives in that game's own
 * mapping (Omaha: HorseOmahaPlayStyle.ts). A game with no mapping plays
 * 'current'.
 *
 * NAMING TRAP: HorseStyleSwitch, HorseStyleShadow and the `style*` options
 * are the OPPONENT style read. HorseStyle ('hybrid', ...) is the stored fleet
 * profile. Neither is this.
 *
 * Assignment needs no storage and no production write: it is a hash of the
 * Horse's id with a salt of its own, so it is independent of the id-hash
 * archetypes (ploPersonaFor, holdemPersonaFor), the same on every server and
 * after every deploy, and uniform in thirds across a fleet. An authored
 * `profiles.horse_profile.persona.playStyle` holding one of the three names
 * wins over the hash (read only; nothing writes it yet).
 *
 * Pure. NEVER refer to the horses as "bots" - they are HORSES only.
 */
import { personaHash } from './HorsePersona.js';

export type HorsePlayStyle = 'tight' | 'current' | 'pressure';

export const HORSE_PLAY_STYLES: readonly HorsePlayStyle[] = ['tight', 'current', 'pressure'];

/** The salt of the assignment hash. Changing it re-deals every Horse's style. */
export const HORSE_PLAY_STYLE_SALT = 'horse_play_style_v1';

/**
 * At this many big blinds effective or fewer every style plays 'current':
 * short stacks are push/fold and commitment arithmetic, not a style.
 */
export const HORSE_PLAY_STYLE_MIN_EFFECTIVE_BB = 50;

export function isHorsePlayStyle(value: unknown): value is HorsePlayStyle {
  return value === 'tight' || value === 'current' || value === 'pressure';
}

/**
 * The style of this Horse. `authored` is the raw value of the authored
 * persona's `playStyle`: one of the three names wins, anything else is
 * ignored and the id decides.
 */
export function horsePlayStyleFor(horseId: string, authored?: unknown): HorsePlayStyle {
  if (isHorsePlayStyle(authored)) return authored;
  const id = horseId || 'default-horse';
  // A third of the 32-bit range each (the remainder of 2^32 / 3 is one value).
  const third = Math.floor((personaHash(`${id}|${HORSE_PLAY_STYLE_SALT}`) / 0x100000000) * 3);
  return HORSE_PLAY_STYLES[Math.min(2, third)];
}

/** What the game lane tells the shared rule about this table and this seat. */
export interface HorsePlayStyleTable {
  /** The table's VPIP floor in percent (30, 50); 0 or absent when it has none. */
  vpipFloorPct?: number;
  tournament: boolean;
  lightning: boolean;
  /** Effective stack at the start of the hand, in big blinds. */
  effectiveStackBB: number;
  /**
   * The VPIP (percent) the game's mapping expects of its tight style at a
   * table with no floor, or null when the game lane has not mapped this game.
   */
  tightExpectedVpipPct: number | null;
}

export type HorsePlayStyleFallback =
  | 'unmapped_game'
  | 'tournament'
  | 'lightning'
  | 'short_stack'
  | 'vpip_floor';

/**
 * Why a non-current style plays 'current' at this table, or null when it
 * plays as itself. Tournaments (payout pricing accepts no style), Lightning
 * (its lane keeps its own options), 50 bb effective or less, and unmapped
 * games send EVERY style to 'current'. A VPIP floor above the tight style's
 * expected VPIP sends only 'tight' there: its widths could not meet the floor,
 * so it plays the current style, which the floor layer already steers.
 */
export function horsePlayStyleFallback(
  style: HorsePlayStyle,
  table: HorsePlayStyleTable
): HorsePlayStyleFallback | null {
  if (style === 'current') return null;
  if (table.tightExpectedVpipPct === null) return 'unmapped_game';
  if (table.tournament) return 'tournament';
  if (table.lightning) return 'lightning';
  if (
    !Number.isFinite(table.effectiveStackBB) ||
    table.effectiveStackBB <= HORSE_PLAY_STYLE_MIN_EFFECTIVE_BB
  )
    return 'short_stack';
  const floor = Number(table.vpipFloorPct ?? 0);
  if (style === 'tight' && floor > 0 && floor > table.tightExpectedVpipPct) return 'vpip_floor';
  return null;
}

/** The style this Horse plays at this table (see horsePlayStyleFallback). */
export function horsePlayStyleAtTable(
  style: HorsePlayStyle,
  table: HorsePlayStyleTable
): HorsePlayStyle {
  return horsePlayStyleFallback(style, table) === null ? style : 'current';
}
