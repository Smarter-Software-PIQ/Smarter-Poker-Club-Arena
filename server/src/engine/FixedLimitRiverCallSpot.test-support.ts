/**
 * Fixed-limit river spots for the adaptation laws (2026-11-14, Fixed-Limit
 * lane): a real HandController deals flh or flo8, seat 2 opens and bets one
 * fixed bet into every street, every other seat calls, and the spot is the
 * first non-bettor to face the river bet. Decided by the real
 * HorseLogic.decide with the live Hybrid persona (HuVariantSpot.test-support).
 */
import type { HorseDecideOpts } from './HorseLogic.js';
import { cards, deal, decide, lcg, type Fmt, type Table } from './HuVariantSpot.test-support.js';

export const RIVER_BETTOR_SEAT = 2;

export function fixedLimitRiverFacingOneBet(o: {
  variant: 'flh' | 'flo8';
  seats: number;
  stack: number;
  /** Fixed hole cards (seat 1 first, four or two per seat) then the board. */
  deck?: string;
  /** A seeded shuffle when no deck is given. */
  seed?: number;
  /** The seat that must face the river bet; default the first non-bettor. */
  hero?: number;
  /** The table's format; default cash. */
  fmt?: Fmt;
}): Table | null {
  const t = deal({
    variant: o.variant,
    fmt: o.fmt ?? 'cash',
    stacks: Array(o.seats).fill(o.stack),
    ...(o.deck ? { prefix: cards(o.deck) } : { rnd: lcg(o.seed ?? 1) }),
  });
  const c = t.controller;
  for (let guard = 0; guard < 200; guard++) {
    const st = c.getState();
    const actor = c.getCurrentPlayer();
    if (!actor) return null;
    const menu = c.getAuthoritativeActionState(actor.user_id)!;
    if (
      st.stage === 'river' &&
      menu.toCall > 0 &&
      actor.seat !== RIVER_BETTOR_SEAT &&
      (o.hero === undefined || actor.seat === o.hero)
    )
      return t;
    let a: string;
    if (st.stage === 'preflop')
      a =
        actor.seat === RIVER_BETTOR_SEAT && st.currentBet <= 2
          ? 'raise'
          : menu.toCall > 0
            ? 'call'
            : 'check';
    else a = menu.toCall > 0 ? 'call' : actor.seat === RIVER_BETTOR_SEAT ? 'bet' : 'check';
    if (!menu.legalActions.includes(a as never))
      a = menu.legalActions.includes('check' as never) ? 'check' : 'call';
    const wager = a === 'raise' || a === 'bet' ? (menu.minRaiseTo ?? undefined) : undefined;
    if (!c.performAction(actor.seat, a as never, wager, 'player')) return null;
  }
  return null;
}

export function decideSpot(t: Table, seed: number, opts: Partial<HorseDecideOpts> = {}) {
  return decide(t, seed, opts);
}
