/**
 * ONE RULE FOR A POLL THAT BACKS UP A REALTIME CHANNEL (2026-11-27).
 *
 * Several client surfaces open a Supabase Realtime channel AND re-read the same
 * rows on a timer, because a websocket frame can be lost (mobile sleep, radio
 * handoff, backpressure). The timer is the safety net, not the delivery path.
 * Before this module each surface hand-rolled that net, and the nets disagreed:
 * some polled every two seconds only WHILE the channel was live (the exact
 * moment the poll is least needed), and some kept a two-second poll running for
 * the whole life of a healthy channel.
 *
 * The rule, in one place:
 *   - channel not SUBSCRIBED (connecting, errored, timed out, closed):
 *     poll at the surface's fast cadence, because the poll is the only path;
 *   - channel SUBSCRIBED: drop to a slow safety cadence (default 30 s), or stop
 *     entirely when the caller passes `slowMs: null`;
 *   - channel drops again: the fast cadence resumes at once.
 *
 * Changing cadence never fires the poll by itself. A surface that wants a
 * lossless SELECT -> SUBSCRIBE handoff re-reads in its own SUBSCRIBED handler,
 * as most already do.
 *
 * Only a poll that duplicates a working realtime carrier belongs here. A table
 * that is not in the `supabase_realtime` publication answers SUBSCRIBED and
 * then delivers nothing, so a poll beside such a channel is the only path and
 * must keep its own cadence. `tests/realtime-backed-polls-use-the-shared-rule.law.test.ts`
 * keeps the inventory of both kinds.
 */

/** The cadence a realtime-backed poll falls to while its channel is live. */
export const REALTIME_SAFETY_POLL_MS = 30_000;

/** True only for the one Supabase channel status that means events flow. */
export function isRealtimeLive(status: string | null | undefined): boolean {
  return status === 'SUBSCRIBED';
}

export interface RealtimeAwarePollOptions {
  /** Cadence while the channel is not live. */
  fastMs: number;
  /** Cadence while live; `null` stops the poll while live. */
  slowMs?: number | null;
  /** Whether the channel is live when the poll starts. */
  live?: boolean;
}

export interface RealtimeAwarePoll {
  /** Report the channel's state; the cadence changes only on a real change. */
  setLive(live: boolean): void;
  isLive(): boolean;
  /** The cadence now in force, or null when the poll is parked. */
  currentMs(): number | null;
  stop(): void;
}

export function startRealtimeAwarePoll(
  poll: () => void,
  { fastMs, slowMs = REALTIME_SAFETY_POLL_MS, live = false }: RealtimeAwarePollOptions
): RealtimeAwarePoll {
  let isLive = live;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let cadence: number | null = null;

  const arm = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    cadence = stopped ? null : isLive ? slowMs : fastMs;
    if (cadence === null) return;
    timer = setInterval(() => {
      if (!stopped) poll();
    }, cadence);
  };
  arm();

  return {
    setLive(next) {
      if (stopped || next === isLive) return;
      isLive = next;
      arm();
    },
    isLive: () => isLive,
    currentMs: () => cadence,
    stop() {
      stopped = true;
      arm();
    },
  };
}
