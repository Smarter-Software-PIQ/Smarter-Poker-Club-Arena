/**
 * Applied add-ons become a brief stack-to-crown text flight (owner 2026-11-10).
 * Keep the authoritative applied amount, seat ownership and receipt deduplication.
 */

import { useEffect, useRef, useState } from 'react';
import { formatTableChips } from '../../utils/format';
import { getAnimationSpeed } from '../../utils/animationSpeed';
import type { SeatChatBubble } from './ChatBubble';

/** Normal-speed flight, including its brief fade above the crown. */
export const ADD_ON_BUBBLE_LIFETIME_MS = 800;

/** The wire shape the engine emits from `processPendingAddOns`. */
export interface AddOnAppliedEvent {
  type: 'add_on_applied';
  table_id?: string;
  seat?: number | null;
  user_id: string;
  amount: number;
  stack?: number | null;
  kind?: 'addon' | 'rebuy' | string;
  timestamp?: number;
}

/** Is this engine event an add-on landing? Exported for the tests. */
export function isAddOnAppliedEvent(evt: unknown): evt is AddOnAppliedEvent {
  if (!evt || typeof evt !== 'object') return false;
  const e = evt as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type.toLowerCase() : '';
  return (
    type === 'add_on_applied' &&
    typeof e.user_id === 'string' &&
    Number.isFinite(Number(e.amount)) &&
    Number(e.amount) > 0
  );
}

/** The exact words. One phrase for add-on and rebuy alike — Dan asked for
    one, and to the table both are a stack getting bigger between hands. */
export function addOnBubbleText(amount: number): string {
  return `+${formatTableChips(amount)} Added On`;
}

/**
 * Resolve the seat to hang the bubble over. The event carries the seat the
 * engine knew; if it is missing (a player found by id but not by seat), fall
 * back to the seat-ordered owner list the table renders from — the same map
 * the chat bubble uses.
 */
export function seatForAddOn(
  evt: AddOnAppliedEvent,
  seatOwnerIds: ReadonlyArray<string | null | undefined>
): number {
  const fromEvent = Number(evt.seat);
  if (Number.isFinite(fromEvent) && fromEvent > 0) return fromEvent;
  const idx = seatOwnerIds.findIndex((id) => !!id && id === evt.user_id);
  return idx >= 0 ? idx + 1 : 0;
}

/**
 * Turn the engine's latest event into at most one add-on bubble per seat.
 *
 * `engineLastEvent` is a "latest event" cell, not a stream: the same object
 * is handed back on every render until the next event replaces it, so each
 * object is processed once (by identity) and never again.
 */
export function useSeatAddOnBubbles(
  engineLastEvent: unknown,
  seatOwnerIds: ReadonlyArray<string | null | undefined>,
  options: { lifetimeMs?: number; nameForSeat?: (seatNumber: number) => string } = {}
): SeatChatBubble[] {
  const { lifetimeMs = ADD_ON_BUBBLE_LIFETIME_MS, nameForSeat } = options;
  const [bubbles, setBubbles] = useState<SeatChatBubble[]>([]);
  const lastSeenRef = useRef<unknown>(null);
  // A reconnect can redeliver the same frame as a NEW object. Keep a bounded
  // receipt history so it cannot restart a notice that already ran its course.
  const seenReceiptsRef = useRef(new Set<string>());
  const seatOwnerIdsRef = useRef(seatOwnerIds);
  seatOwnerIdsRef.current = seatOwnerIds;
  // Read through a ref: callers hand in a fresh closure every render, and a
  // name lookup must not re-arm the effect.
  const nameForSeatRef = useRef(nameForSeat);
  nameForSeatRef.current = nameForSeat;
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!engineLastEvent || lastSeenRef.current === engineLastEvent) return;
    lastSeenRef.current = engineLastEvent;
    if (!isAddOnAppliedEvent(engineLastEvent)) return;

    const receipt =
      engineLastEvent.timestamp == null
        ? null
        : `${engineLastEvent.table_id ?? ''}:${engineLastEvent.user_id}:${engineLastEvent.timestamp}:${Number(engineLastEvent.amount)}`;
    if (receipt && seenReceiptsRef.current.has(receipt)) return;
    const seatNumber = seatForAddOn(engineLastEvent, seatOwnerIdsRef.current);
    if (seatNumber <= 0) return; // Nobody to hang it over.
    if (receipt) {
      seenReceiptsRef.current.add(receipt);
      if (seenReceiptsRef.current.size > 64) {
        seenReceiptsRef.current.delete(seenReceiptsRef.current.values().next().value!);
      }
    }

    const id = `addon-${engineLastEvent.user_id}-${engineLastEvent.timestamp ?? Date.now()}`;
    const fresh: SeatChatBubble = {
      id,
      seatNumber,
      playerId: engineLastEvent.user_id,
      playerName: nameForSeatRef.current?.(seatNumber) ?? '',
      content: addOnBubbleText(Number(engineLastEvent.amount)),
      shownAt: Date.now(),
      variant: 'notice',
    };

    // One per seat, latest wins — two add-ons in a row replace, not stack.
    setBubbles((prev) => [...prev.filter((b) => b.seatNumber !== seatNumber), fresh]);

    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setBubbles((prev) => prev.filter((b) => b.id !== id));
    }, lifetimeMs * getAnimationSpeed());
    timersRef.current.add(timer);
  }, [engineLastEvent, lifetimeMs]);

  useEffect(() => {
    setBubbles((previous) => {
      const retained = previous.filter((b) => seatOwnerIds[b.seatNumber - 1] === b.playerId);
      return retained.length === previous.length ? previous : retained;
    });
  }, [seatOwnerIds]);

  // A notice belongs to its player, never to the next occupant of that chair.
  return bubbles.filter((b) => seatOwnerIds[b.seatNumber - 1] === b.playerId);
}
