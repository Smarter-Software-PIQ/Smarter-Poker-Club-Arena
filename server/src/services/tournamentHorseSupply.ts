/**
 * HOW MANY HORSES CAN A GUARANTEE ACTUALLY DRAW ON? (2026-11-13)
 *
 * The Nightly 20K went from a 10,000 to a 20,000 guarantee in the same week
 * that horses began keeping rest days and the cash floor reopened. Each change
 * passed its own tests. Nothing asked the question they shared: with the fleet
 * rules as they stand, can the horses reach the entries the board has promised?
 * This module is that question, pure, so it can be asked at schedule time, in a
 * test that fails when a fleet rule changes the answer, and of a recorded night.
 */
import { CONCURRENT_GAME_LIMIT, HORSE_MAX_CASH_TABLES } from './HorseGameLoad.js';

export interface SupplyHorse {
  /** Games the horse is committed to, the database's count. */
  load: number;
  /** Of those, cash seats. */
  cashSeats: number;
  inEvent: boolean;
  onShift: boolean;
  restDay: boolean;
  canPay: boolean;
}

export interface SupplyAnswer {
  /** Horses the registration pool may offer right now. */
  free: number;
  /** Horses at the game limit that could free a cash seat when called. */
  callable: number;
}

/**
 * Who a short guaranteed event can draw on. `overlayCover` is the 2026-11-13
 * rule: the shift and the rest day are waived. Without it this is the pool the
 * ordinary arrival plan has always used.
 */
export function coverSupply(fleet: readonly SupplyHorse[], overlayCover: boolean): SupplyAnswer {
  let free = 0;
  let callable = 0;
  for (const h of fleet) {
    if (h.inEvent || !h.canPay) continue;
    if (!overlayCover && (!h.onShift || h.restDay)) continue;
    if (h.load < CONCURRENT_GAME_LIMIT) free++;
    else if (overlayCover && h.cashSeats > 0) callable++;
  }
  return { free, callable };
}

export interface SupplyEvent {
  id: string;
  name: string;
  startMs: number;
  /** When entry closes. */
  closeMs: number;
  /** Entries the guarantee needs; for a free event, the field it is filled to. */
  neededEntries: number;
  guaranteed: boolean;
}

export interface SupplyFinding {
  id: string;
  message: string;
  detail: Record<string, number>;
}

/** Share of the fleet one event may count on: a horse enters an event once. */
export const SINGLE_EVENT_FLEET_SHARE = 0.8;

/** Games each horse keeps for tournaments whatever the cash floor is doing. */
export const TOURNAMENT_GAMES_PER_HORSE = CONCURRENT_GAME_LIMIT - HORSE_MAX_CASH_TABLES;

/**
 * Guaranteed events the fleet cannot be relied on to cover:
 *  - one event needing more than SINGLE_EVENT_FLEET_SHARE of the fleet, or
 *  - an event whose entry window overlaps others so that, together, they need
 *    more tournament games than the fleet keeps free of cash.
 * Free events count toward the overlap (they hold horses) and are never
 * themselves a finding. An event with an unreadable clock is skipped, not guessed.
 */
export function guaranteeSupplyFindings(
  events: readonly SupplyEvent[],
  fleet: number
): SupplyFinding[] {
  const size = Math.max(0, Math.floor(Number(fleet) || 0));
  const readable = events.filter(
    (e) => Number.isFinite(e.startMs) && Number.isFinite(e.closeMs) && e.neededEntries > 0
  );
  const findings: SupplyFinding[] = [];
  for (const e of readable) {
    if (!e.guaranteed) continue;
    const single = Math.floor(size * SINGLE_EVENT_FLEET_SHARE);
    if (e.neededEntries > single) {
      findings.push({
        id: e.id,
        message: `${e.name} needs ${e.neededEntries} entries to cover its guarantee and the fleet can supply about ${single}`,
        detail: { needed_entries: e.neededEntries, single_event_supply: single },
      });
      continue;
    }
    const overlapping = readable
      .filter((o) => o.startMs < e.closeMs && o.closeMs > e.startMs)
      .reduce((sum, o) => sum + o.neededEntries, 0);
    const games = size * TOURNAMENT_GAMES_PER_HORSE;
    if (overlapping > games) {
      findings.push({
        id: e.id,
        message: `${e.name} shares its entry window with events needing ${overlapping} entries in total; the fleet keeps ${games} tournament games free of cash`,
        detail: { overlapping_entries: overlapping, tournament_games: games },
      });
    }
  }
  return findings;
}
