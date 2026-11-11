/**
 * BANK THE WIN ON LIGHTNING (owner 2026-11-10, completed 2026-11-11).
 *
 * The owner's rule (HorseBankTheWin) is: at 4-6x its starting stack a horse
 * books the win and leaves; never the hand after a big pot - it plays one
 * more orbit and gets up before its next big blind.
 *
 * At a Classic table the engine's settlement applies it. A Lightning hand is
 * dealt from the pool and settled by LightningHandHost, so that settlement
 * never saw a pool hand: on 2026-11-11 horses at 600.77 against a 581.4 line
 * kept posting blinds for half an hour after their last big pot. This is the
 * same rule fed by the pool's own committed hands:
 *
 *  - STARTING STACK: the first stack this pool session is seen with, never
 *    more than the table's maximum buy-in (startingStackFor).
 *  - BIG POT: a hand that netted half a starting stack or more; the horse
 *    then plays an orbit (one hand per player dealt in) before it may go.
 *  - BEFORE ITS BIG BLIND: the pool hands the blinds round by who posted one
 *    longest ago, so a horse that has played an orbit since its last big
 *    blind is the one due next. It stands up at that boundary.
 *
 * The departure itself is the anchor seat's ordinary Leave door, the one a
 * person uses, wired in index.ts. Each pool session books at most once.
 * No IO here, no clock: the tracker is directly testable.
 */

import { isBigPot, shouldBankTheWin, startingStackFor } from '../services/HorseBankTheWin.js';

export interface LightningBankParticipant {
  playerId: string;
  poolSessionId: string;
  isHorse: boolean;
  blindRole: string;
  stackBefore: number;
}

interface PoolSessionState {
  start: number;
  handsSinceBigPot: number | undefined;
  handsSinceBigBlind: number;
  booked: boolean;
}

const MAX_TRACKED = 20_000;
const sessions = new Map<string, PoolSessionState>();

/**
 * The Leave door. `release` re-arms the session when the door refused (a
 * hit-and-run count still owed, a seat it could not find): the next pool hand
 * asks again rather than the horse being forgotten.
 */
export type LightningBankHandler = (req: {
  clusterId: string;
  playerId: string;
  release: () => void;
}) => void;
let handler: LightningBankHandler | null = null;

/** index.ts registers the anchor seat's Leave door here. */
export function onLightningBankTheWin(fn: LightningBankHandler | null): void {
  handler = fn;
}

function isBigBlind(role: string): boolean {
  return role === 'bb' || role === 'entry_bb';
}

/**
 * Feed one committed pool hand. Returns the horses that book their win at
 * this boundary (and hands each to the registered Leave door).
 */
export function noteLightningHandForBankTheWin(hand: {
  clusterId: string;
  maxBuyIn: number;
  participants: ReadonlyArray<LightningBankParticipant>;
  stacksAfter: ReadonlyMap<string, number>;
}): string[] {
  const dealt = hand.participants.length;
  const out: string[] = [];
  for (const p of hand.participants) {
    if (!p.isHorse || !p.poolSessionId) continue;
    const after = hand.stacksAfter.get(p.playerId);
    if (after === undefined || !Number.isFinite(after)) continue;
    let s = sessions.get(p.poolSessionId);
    if (!s) {
      if (sessions.size >= MAX_TRACKED) sessions.delete(sessions.keys().next().value as string);
      s = {
        start: startingStackFor(p.stackBefore, hand.maxBuyIn),
        handsSinceBigPot: undefined,
        handsSinceBigBlind: isBigBlind(p.blindRole) ? -1 : 0,
        booked: false,
      };
      sessions.set(p.poolSessionId, s);
    }
    s.handsSinceBigBlind = isBigBlind(p.blindRole) ? 0 : s.handsSinceBigBlind + 1;
    if (isBigPot(p.stackBefore, after, s.start)) s.handsSinceBigPot = 0;
    else if (s.handsSinceBigPot !== undefined) s.handsSinceBigPot += 1;
    if (s.booked) continue;
    if (
      shouldBankTheWin({
        horseId: p.playerId,
        stack: after,
        startingStack: s.start,
        handsSinceBigPot: s.handsSinceBigPot,
        playersAtTable: dealt,
        nextHandIsBigBlind: s.handsSinceBigBlind >= Math.max(1, dealt - 1),
      })
    ) {
      s.booked = true;
      out.push(p.playerId);
      try {
        const state = s;
        handler?.({
          clusterId: hand.clusterId,
          playerId: p.playerId,
          release: () => {
            state.booked = false;
          },
        });
      } catch {
        /* The door reports its own failures; the tracker never throws. */
      }
    }
  }
  return out;
}

/** Tests only. */
export function resetLightningBankTheWin(): void {
  sessions.clear();
  handler = null;
}
