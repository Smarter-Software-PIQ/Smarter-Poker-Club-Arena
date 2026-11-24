/**
 * Decision requests for the Hold'em tournament raise-defence options (test and measurement support; not loaded by
 * the engine). The base request is the anonymised production tournament request the all-in call fixtures use
 * (AHoldemTournamentAllInCallIsPriced.fixtures.ts); this builder re-deals it for any seat count, either ante
 * structure (a big-blind ante, as in MTTs, or none, as in Sit & Gos and Spins) and any preflop action, and
 * recomputes the tournament M block from the dealt chips with the engine's own buildTournamentMState, so the M zone
 * the decision reads is the one these stacks give (the base request's block belongs to another table).
 */
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { SeatPlayer } from '../types.js';
import {
  BASE_DECISION_TIME_MS,
  BASE_MODS,
  BASE_STYLE,
  buildSpot,
  cards,
  payoutLadder,
  type Act,
  type SpotSpec,
} from './AHoldemTournamentAllInCallIsPriced.fixtures.js';
import { buildTournamentMState } from './HorseTournamentPreflop.js';
import { readFileSync } from 'node:fs';

export { BASE_DECISION_TIME_MS, BASE_MODS, BASE_STYLE, cards, payoutLadder };
export type { Act };

export interface RaiseDefenceSpotSpec {
  bb: number;
  /** Seats dealt, in table order; the dealer; for two dealt the dealer is the small blind. */
  seats: number[];
  dealer: number;
  hero: number;
  heroCards: string;
  /** Each seat's chips when the hand started. */
  stacks: Record<number, number>;
  /** Preflop public action after the blinds (and the ante). */
  preflop: readonly Act[];
  /** 'bba': a big-blind ante of one big blind (MTT); 'none': no ante (Sit & Go, Spin, heads-up match). */
  ante: 'bba' | 'none';
  playersLeft: number;
  spotsPaid: number;
  format?: 'mtt' | 'sng' | 'spin';
}

const ID = (seat: number) => `00000000-0000-4000-8066-0000000000${String(seat).padStart(2, '0')}`;

/** The decision request at the hero's turn after the stated preflop action. */
export function buildRaiseDefenceSpot(spec: RaiseDefenceSpotSpec): {
  gs: HorseGameStateV2;
  player: SeatPlayer;
} {
  const base: SpotSpec = {
    bb: spec.bb,
    seats: spec.seats,
    dealer: spec.dealer,
    hero: spec.hero,
    heroCards: spec.heroCards,
    stacks: spec.stacks,
    streets: { preflop: spec.preflop },
    playersLeft: spec.playersLeft,
    spotsPaid: spec.spotsPaid,
  };
  const { gs } = buildSpot(base);
  if (spec.ante === 'none') {
    // Take the big blind's dead ante back out: its chips, its invested total and the pot.
    const order = spec.seats;
    const at = (k: number) => order[(order.indexOf(spec.dealer) + k) % order.length];
    const bbSeat = order.length === 2 ? at(1) : at(2);
    const ante = spec.bb;
    for (const p of gs.players) {
      if (p.seat !== bbSeat) continue;
      const dead = Math.min(ante, p.deadInvested ?? 0);
      p.deadInvested = (p.deadInvested ?? 0) - dead;
      p.totalInvested -= dead;
      p.stack += dead;
      if (p.stack > 0) p.is_all_in = false;
    }
    gs.pot -= ante;
    if (Number.isFinite(gs.contestablePot))
      gs.contestablePot = (gs.contestablePot as number) - ante;
    gs.pots = [{ ...(gs.pots as Array<{ amount: number }>)[0], amount: gs.pot }] as never;
    gs.ante = 0;
    gs.bigBlindAnte = false;
    const heroLive = gs.players.find((p) => p.seat === spec.hero)!;
    const toCall = Math.max(0, gs.currentBet - heroLive.bet);
    const lastRaise = gs.lastRaise ?? spec.bb;
    const canRaise = heroLive.stack + heroLive.bet > gs.currentBet + lastRaise;
    gs.toCall = toCall as never;
    gs.legalActions = (
      toCall === 0
        ? ['check', 'bet', 'all_in']
        : heroLive.stack > toCall
          ? canRaise
            ? ['fold', 'call', 'raise', 'all_in']
            : ['fold', 'call', 'all_in']
          : ['fold', 'call']
    ) as never;
    gs.minRaiseTo = (canRaise ? gs.currentBet + lastRaise : null) as never;
    gs.maxRaiseTo = (canRaise ? heroLive.stack + heroLive.bet : null) as never;
  }
  const t = gs.tournament as unknown as Record<string, unknown>;
  const anteChips = spec.ante === 'none' ? 0 : spec.bb;
  t.anteType = spec.ante === 'none' ? 'none' : 'big_blind';
  t.currentAnte = anteChips;
  t.currentBigBlind = spec.bb;
  t.currentSmallBlind = spec.bb / 2;
  t.nextBigBlind = spec.bb * 1.5;
  t.nextSmallBlind = (spec.bb * 1.5) / 2;
  t.nextAnte = spec.ante === 'none' ? 0 : spec.bb * 1.5;
  t.nextBlindInMin = 3;
  t.format = spec.format ?? 'mtt';
  if (spec.format === 'sng' || spec.format === 'spin') {
    t.lateRegistrationOpen = false;
    t.rebuyOpen = false;
    t.reentryOpen = false;
    t.registrationOpen = false;
  }
  gs.format = (spec.format ?? 'mtt') as never;
  t.playersAtTable = spec.seats.length;
  t.finalTable = spec.playersLeft <= Math.max(2, spec.seats.length);
  const hero = gs.players.find((p) => p.seat === spec.hero)!;
  t.m = buildTournamentMState({
    stackChips: hero.stack,
    smallBlind: spec.bb / 2,
    bigBlind: spec.bb,
    ante: anteChips,
    anteType: spec.ante === 'none' ? 'none' : 'big_blind',
    playersAtTable: spec.seats.length,
    nextSmallBlind: (spec.bb * 1.5) / 2,
    nextBigBlind: spec.bb * 1.5,
    nextAnte: spec.ante === 'none' ? 0 : spec.bb * 1.5,
    minutesToNextLevel: 3,
    opponentStacks: gs.players
      .filter((p) => p.seat !== spec.hero)
      .map((p) => ({ userId: p.user_id, stackChips: p.stack })),
    previousZone: null,
  });
  const prov = t.contextProvenance as { projection?: Record<string, unknown> } | undefined;
  if (prov?.projection) {
    prov.projection.actorId = ID(spec.hero);
    prov.projection.actorSeat = spec.hero;
    prov.projection.ante = anteChips;
    prov.projection.bigBlind = spec.bb;
    prov.projection.smallBlind = spec.bb / 2;
    prov.projection.dealerSeat = spec.dealer;
    prov.projection.dealtSeatIds = [...spec.seats];
  }
  const out = structuredClone(gs.players.find((p) => p.seat === spec.hero)!) as SeatPlayer;
  return { gs, player: out };
}

/**
 * The decide options production runs with: the switch snapshot kept in the repo (docs/horse-option-switch-state.json)
 * mapped by this build's own switch code, the way the worker and the cross-build replay do it.
 */
export async function productionDecideOpts(): Promise<Record<string, unknown>> {
  const OS = await import('./HorseOptionSwitch.js');
  const SS = await import('./HorseStyleSwitch.js');
  const snap = JSON.parse(
    readFileSync(new URL('../../../docs/horse-option-switch-state.json', import.meta.url), 'utf8')
  ) as { rows: Record<string, { state: string }> };
  const rows: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.rows)) rows[k] = v.state;
  const styleNames = [...SS.STYLE_SWITCH_OPTIONS] as string[];
  const styleStates: Record<string, string> = {};
  for (const o of styleNames) styleStates[o] = rows[o] ?? 'off';
  const plain: Record<string, string> = {};
  for (const [k, v] of Object.entries(rows)) if (!styleNames.includes(k)) plain[k] = v;
  const parsed = OS.parseOptionSwitchConfig({
    version: 2,
    style: { version: 1, options: styleStates },
    options: plain,
  } as never);
  if (!parsed.ok) throw new Error('the production switch snapshot does not parse on this build');
  const ss = SS.styleSwitchStatesFrom(styleStates as never);
  if (!ss) throw new Error('the production style rows do not parse on this build');
  return {
    ...SS.styleSwitchBrainOpts(SS.styleSwitchDecisionOpts(ss, 'harness-horse', true)),
    ...OS.optionSwitchDecisionOpts(parsed.states),
  };
}
