import { useLayoutEffect, useState } from 'react';

export interface SeatArrival {
  key: string;
  playerId: string;
  delayMs: number;
}
type Occupant = { id: string; isHero?: boolean } | null;
interface Ledger {
  scope: string;
  signature: string;
  known: string[];
  /**
   * LIGHTNING TRANSITION, PHASE 3: the chair each known player (the last
   * roster's occupants, like `known`) sat in.
   * A player met before who is dealt in at a DIFFERENT chair arrives there
   * too; without this they appeared at the new chair with no fade at all.
   * Optional so a ledger from before this field still reads.
   */
  seats?: Record<string, number>;
  /**
   * 2026-11-09: the table the last non-empty roster belonged to (a Lightning
   * room passes its hand number). A new table arrives as ONE table: every
   * opponent fades in together, including a player met before who happens to
   * be dealt the same chair. Without it that one portrait cut in at full
   * strength while the others around it were still fading.
   */
  epoch?: string | number | null;
  serial: number;
  arrivals: Record<number, SeatArrival>;
}
/** The ripple between two arriving chairs, and its ceiling. */
export const SEAT_ARRIVAL_STEP_MS = 40;
export const SEAT_ARRIVAL_MAX_DELAY_MS = 160;

export function nextSeatArrivals(
  previous: Ledger,
  scope: string,
  players: readonly Occupant[],
  epoch: string | number | null = null,
  /**
   * 2026-11-10: a Lightning engine that waits for the new table's arrivals
   * before its deal sends that window; the arrivals are spaced inside it
   * (lightningArrivalSpacing). Null keeps the short ripple.
   */
  spacing: { stepMs: number; maxDelayMs: number } | null = null
): Ledger {
  const base =
    previous.scope === scope
      ? previous
      : { scope, signature: '', known: [], seats: {}, serial: 0, arrivals: {} };
  const signature = JSON.stringify(players.map((p) => p?.id ?? null));
  if (base.signature === signature) return base;
  const present = players.filter((p): p is NonNullable<Occupant> => !!p);
  // An idle/reconnect frame is not evidence that these occupants left the pool.
  if (!present.length) return { ...base, signature, arrivals: {} };
  // Judged only when the roster itself changes: an epoch that moves ahead of
  // its roster must never replay the arrival on the table that is leaving.
  const newTable = epoch !== null && base.epoch !== undefined && base.epoch !== epoch;
  let rank = 0;
  const arrivals: Record<number, SeatArrival> = {};
  const seats: Record<string, number> = {};
  players.forEach((p, index) => {
    if (!p) return;
    seats[p.id] = index + 1;
    const lastSeat = base.seats?.[p.id];
    const moved = lastSeat !== undefined && lastSeat !== index + 1;
    if ((newTable || !base.known.includes(p.id) || moved) && !p.isHero) {
      arrivals[index + 1] = {
        key: `${scope}:${base.serial + 1}:${p.id}`,
        playerId: p.id,
        // A short ripple, not a roll call: the last chair starts 160 ms after
        // the first (it was 400 ms, which read as seats popping in one by one).
        delayMs: spacing
          ? Math.min(spacing.maxDelayMs, rank++ * spacing.stepMs)
          : Math.min(SEAT_ARRIVAL_MAX_DELAY_MS, rank++ * SEAT_ARRIVAL_STEP_MS),
      };
    } else if (base.arrivals[index + 1]?.playerId === p.id)
      arrivals[index + 1] = base.arrivals[index + 1];
  });
  return {
    scope,
    signature,
    known: present.map((p) => p.id),
    seats,
    epoch: epoch ?? base.epoch ?? null,
    serial: base.serial + 1,
    arrivals,
  };
}
export function useSeatArrivals(
  scope: string,
  players: readonly Occupant[],
  epoch: string | number | null = null,
  spacing: { stepMs: number; maxDelayMs: number } | null = null
): Record<number, SeatArrival> {
  const [ledger, setLedger] = useState<Ledger>({
    scope,
    signature: '',
    known: [],
    serial: 0,
    arrivals: {},
  });
  const next = nextSeatArrivals(ledger, scope, players, epoch, spacing);
  useLayoutEffect(() => {
    if (next !== ledger) setLedger(next);
  }, [next, ledger]);
  return next.arrivals;
}
