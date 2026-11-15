/**
 * HOLD'EM PERSONA PREFLOP (option holdemPersonaPreflop, default OFF).
 *
 *  (a) The module: the archetype shifts, the plan's bands, the depth taper,
 *      the floor rule and the Nit Hunter's punish rule, as numbers.
 *  (b) Opening width through the real brain: a nine-handed UTG seat folded
 *      to, every sampled holding, option off and on from the same stream:
 *      a LAG Shark opens more, a Nit Hunter and a TAG Crusher fewer, a
 *      Tricky Trap decides every holding exactly as with the option off. At
 *      40bb, in a tournament and with the option false: every archetype
 *      decides exactly as off. On a VPIP-floor table a Nit Hunter decides
 *      exactly as off and the floor receipt fires; a LAG still widens.
 *  (c) Continue width: the big blind facing a 3bb open, every sampled holding:
 *      a LAG continues more, a Nit fewer, a Tricky's continue shift never
 *      fires.
 *  (d) The Nit Hunter's preflop punish rule. Facing a credibly wide opener
 *      (the maniac read) its punish receipt fires and it does not continue
 *      less than with the option off; facing a limper read credibly loose
 *      (maniac, calling station) it isolates MORE than with the option off,
 *      while with no read it isolates fewer. A LAG is never given the rule.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom, saveFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HorseLogic } from './HorseLogic.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import { holdemPersonaFor, type HorseHoldemArchetype } from './HorsePersona.js';
import {
  HOLDEM_PERSONA_RANGE_SHIFT,
  HOLDEM_PERSONA_VPIP_BAND,
  NIT_HUNTER_PUNISH_SHIFT,
  holdemPersonaContinueBar,
  holdemPersonaOpenSharePct,
  holdemPersonaRange,
} from './HorseHoldemPersonaPreflop.js';
import { scoreAtShare, shareAtScore } from './HorseGtoOpeningRanges.js';
import { setHoldemPersonaReRaiseTap, type HoldemPersonaReRaiseTapEvent } from './HorsePreflop.js';
import {
  VILLAIN,
  VILLAINS,
  cards as cardsOf,
  decide as decideStyleSpot,
  install as installVillain,
  preflopOpen,
} from './HorseOpponentStyle.contexts.test-support.js';
import { syntheticFleet, syntheticHorseId } from '../benchmark/HoldemPreflopProbe.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const FLEET = syntheticFleet();
const idOf = (a: HorseHoldemArchetype, k = 0) =>
  FLEET.filter((id) => holdemPersonaFor(id).archetype === a)[k];
const LAG = idOf('lag_shark');
const TRICKY = idOf('tricky_trap');
const TAG = idOf('tag_crusher');
const NIT = idOf('nit_hunter');
const TABLE_ID = syntheticHorseId(720000001);
const handOpts = (handNumber: number) => ({
  mindPlanContext: { version: 1, hand: { version: 1, tableId: TABLE_ID, handNumber } },
});

const R = '23456789TJQKA';
const SUIT: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const HOLDINGS: Card[][] = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b += 3)
    HOLDINGS.push([
      { rank: R[a % 13] as CardRank, suit: SUIT[Math.floor(a / 13)] },
      { rank: R[b % 13] as CardRank, suit: SUIT[Math.floor(b / 13)] },
    ]);
const HOLDING_TEXT = HOLDINGS.map((h) => h.map((c) => `${c.rank}${c.suit[0]}`).join(''));

const tapped: HoldemPersonaReRaiseTapEvent[] = [];
afterEach(() => setHoldemPersonaReRaiseTap(null));

describe('holdem persona preflop: the module', () => {
  it('carries the declared shifts and the plan line 152 bands', () => {
    expect(HOLDEM_PERSONA_RANGE_SHIFT).toEqual({
      lag_shark: { openPts: 4, continuePts: 1.5 },
      tricky_trap: { openPts: 0, continuePts: 0 },
      tag_crusher: { openPts: -1, continuePts: -2 },
      nit_hunter: { openPts: -3, continuePts: -3 },
    });
    expect(HOLDEM_PERSONA_VPIP_BAND).toEqual({
      lag_shark: [29, 31],
      tricky_trap: [27, 29],
      tag_crusher: [26, 28],
      nit_hunter: [25, 27],
    });
    expect(NIT_HUNTER_PUNISH_SHIFT).toEqual({ openPts: 2, continuePts: 0 });
  });
  it('withholds every narrowing on a VPIP-floor table, and punishes only as a Nit Hunter', () => {
    expect(holdemPersonaRange(NIT, false, false)).toEqual({
      archetype: 'nit_hunter',
      shift: { openPts: -3, continuePts: -3 },
      floorHeld: false,
      punishing: false,
    });
    expect(holdemPersonaRange(NIT, true, false).shift).toEqual({ openPts: 0, continuePts: 0 });
    expect(holdemPersonaRange(NIT, true, false).floorHeld).toBe(true);
    expect(holdemPersonaRange(TAG, true, false).shift).toEqual({ openPts: 0, continuePts: 0 });
    expect(holdemPersonaRange(LAG, true, false)).toMatchObject({
      shift: { openPts: 4, continuePts: 1.5 },
      floorHeld: false,
    });
    expect(holdemPersonaRange(NIT, false, true)).toMatchObject({
      shift: NIT_HUNTER_PUNISH_SHIFT,
      punishing: true,
    });
    expect(holdemPersonaRange(LAG, false, true).punishing).toBe(false);
    expect(holdemPersonaRange(TAG, false, true).punishing).toBe(false);
  });
  it('tapers with depth: the input exactly at 50bb or less, full from 85bb', () => {
    expect(holdemPersonaOpenSharePct(26.5, 4, 50)).toBe(26.5);
    expect(holdemPersonaOpenSharePct(26.5, 4, 30)).toBe(26.5);
    expect(holdemPersonaOpenSharePct(26.5, 4, 85)).toBe(30.5);
    expect(holdemPersonaOpenSharePct(26.5, -3, 200)).toBe(23.5);
    expect(holdemPersonaOpenSharePct(26.5, 4, 67.5)).toBeCloseTo(28.5, 9);
    expect(holdemPersonaOpenSharePct(26.5, 0, 100)).toBe(26.5);
    const cont = scoreAtShare(0.3);
    const value = scoreAtShare(0.08);
    expect(holdemPersonaContinueBar(cont, value, 1.5, 40)).toBe(cont);
    expect(holdemPersonaContinueBar(cont, value, 0, 100)).toBe(cont);
    expect(shareAtScore(holdemPersonaContinueBar(cont, value, 1.5, 100))).toBeCloseTo(0.315, 6);
    expect(shareAtScore(holdemPersonaContinueBar(cont, value, -3, 100))).toBeCloseTo(0.27, 6);
    // Never narrower than the value range.
    expect(shareAtScore(holdemPersonaContinueBar(scoreAtShare(0.1), value, -3, 100))).toBeCloseTo(
      0.08,
      6
    );
  });
});

/** Nine-handed, dealer seat 9, blinds seats 1 and 2, hero UTG (seat 3) folded to. */
function utgOpenSpot(
  heroId: string,
  cards: Card[],
  stackBB: number,
  extra: Record<string, unknown> = {}
): { hero: SeatPlayer; gs: Record<string, unknown> } {
  const players = Array.from({ length: 9 }, (_, i) => {
    const seat = i + 1;
    const blind = seat === 1 ? 1 : seat === 2 ? 2 : 0;
    return {
      seat,
      user_id: seat === 3 ? heroId : syntheticHorseId(730000000 + seat),
      username: `p${seat}`,
      stack: stackBB * 2 - blind,
      bet: blind,
      totalInvested: blind,
      cards: seat === 3 ? cards : [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
  });
  const gs = {
    players,
    communityCards: [],
    pot: 3,
    currentBet: 2,
    minRaise: 2,
    lastRaise: 2,
    stage: 'preflop',
    gameVariant: 'nlh',
    gameMode: 'cash',
    format: 'cash',
    bigBlind: 2,
    smallBlind: 1,
    ante: 0,
    dealerSeat: 9,
    actionHistory: [],
    ...extra,
  };
  return { hero: players[2], gs };
}

interface Swept {
  digests: string[];
  opens: number;
  fires: Record<string, number>;
}
function sweepOpen(
  heroId: string,
  opts: Record<string, unknown>,
  stackBB = 100,
  extra: Record<string, unknown> = {}
): Swept {
  enableBrainTelemetry();
  const profile = HORSE_HYBRID_PROFILES[extra.gameMode === 'tournament' ? 'tournament' : 'cash'];
  const out: Swept = { digests: [], opens: 0, fires: {} };
  HOLDINGS.forEach((cards, k) => {
    const { hero, gs } = utgOpenSpot(heroId, cards, stackBB, extra);
    seedFastRandom(0x9e5a + k);
    drainFires();
    const d = HorseLogic.decide(hero, gs as never, profile.style, { ...profile.mods }, {
      mind: false,
      telemetry: true,
      ...handOpts(4000000 + k),
      ...opts,
    } as never);
    for (const f of drainFires()) out.fires[f.feature] = (out.fires[f.feature] ?? 0) + f.fires;
    out.digests.push(`${d.action}:${d.amount ?? ''}|${saveFastRandom()}`);
    if (d.action === 'raise' || d.action === 'bet' || d.action === 'all_in') out.opens++;
  });
  return out;
}

const ON = { holdemPersonaPreflop: true };

describe('holdem persona preflop: opening width through the brain', () => {
  const off = new Map<string, Swept>();
  const offOf = (id: string) => {
    if (!off.has(id)) off.set(id, sweepOpen(id, {}));
    return off.get(id)!;
  };
  it('a LAG Shark opens more UTG, a TAG Crusher and a Nit Hunter fewer, a Tricky Trap the same', () => {
    const lag = sweepOpen(LAG, ON);
    const tag = sweepOpen(TAG, ON);
    const nit = sweepOpen(NIT, ON);
    const tricky = sweepOpen(TRICKY, ON);
    expect(lag.opens).toBeGreaterThan(offOf(LAG).opens);
    expect(nit.opens).toBeLessThan(offOf(NIT).opens);
    expect(tag.opens).toBeLessThanOrEqual(offOf(TAG).opens);
    expect(nit.opens).toBeLessThan(lag.opens);
    expect(tricky.digests).toEqual(offOf(TRICKY).digests);
    expect(lag.fires.holdem_persona_open_shift_seen).toBe(HOLDINGS.length);
    expect(tricky.fires.holdem_persona_open_shift_seen ?? 0).toBe(0);
    // Only hands near the bar move: nothing that every arm opens is folded.
    lag.digests.forEach((d, k) => {
      if (offOf(LAG).digests[k].startsWith('raise'))
        expect(d.startsWith('raise'), HOLDING_TEXT[k]).toBe(true);
    });
    nit.digests.forEach((d, k) => {
      if (offOf(NIT).digests[k].startsWith('fold'))
        expect(d.startsWith('fold'), HOLDING_TEXT[k]).toBe(true);
    });
  });
  it('option false, 40bb and a tournament: every archetype decides every holding exactly as off', () => {
    for (const id of [LAG, TRICKY, TAG, NIT]) {
      expect(sweepOpen(id, { holdemPersonaPreflop: false }).digests).toEqual(offOf(id).digests);
      expect(sweepOpen(id, ON, 40).digests).toEqual(sweepOpen(id, {}, 40).digests);
      const t = { gameMode: 'tournament', format: 'mtt' };
      expect(sweepOpen(id, ON, 100, t).digests).toEqual(sweepOpen(id, {}, 100, t).digests);
    }
  });
  it('on a VPIP-floor table a Nit Hunter is not narrowed (receipt fires); a LAG still widens', () => {
    const floor = { vpipFloor: 0.2 };
    const nitOff = sweepOpen(NIT, {}, 100, floor);
    const nitOn = sweepOpen(NIT, ON, 100, floor);
    expect(nitOn.digests).toEqual(nitOff.digests);
    expect(nitOn.fires.holdem_persona_floor_held_seen).toBe(HOLDINGS.length);
    const lagOn = sweepOpen(LAG, ON, 100, floor);
    expect(lagOn.opens).toBeGreaterThan(sweepOpen(LAG, {}, 100, floor).opens);
    expect(lagOn.fires.holdem_persona_floor_held_seen ?? 0).toBe(0);
  });
});

interface DefSwept {
  continues: number;
  fires: Record<string, number>;
  events: HoldemPersonaReRaiseTapEvent[];
}
function sweepDefend(
  heroId: string,
  villain: keyof typeof VILLAINS,
  opts: Record<string, unknown>
): DefSwept {
  const out: DefSwept = { continues: 0, fires: {}, events: [] };
  setHoldemPersonaReRaiseTap((e) => tapped.push(e));
  HOLDING_TEXT.forEach((holding, k) => {
    const spot = preflopOpen('cash', holding, 200);
    spot.hero.user_id = heroId;
    installVillain(VILLAINS[villain], 'cash');
    tapped.length = 0;
    const d = decideStyleSpot(spot, { ...handOpts(5000000 + k), ...opts });
    for (const [f, n] of Object.entries(d.fires)) out.fires[f] = (out.fires[f] ?? 0) + n;
    out.events.push(...tapped);
    if (d.decision.action !== 'fold' && d.decision.action !== 'check') out.continues++;
  });
  return out;
}

describe('holdem persona preflop: continue width facing one open', () => {
  it('a LAG continues more, a Nit fewer; a Tricky never moves its continue share', () => {
    const lagOff = sweepDefend(LAG, 'none', {});
    const lagOn = sweepDefend(LAG, 'none', ON);
    const nitOff = sweepDefend(NIT, 'none', {});
    const nitOn = sweepDefend(NIT, 'none', ON);
    const trickyOn = sweepDefend(TRICKY, 'none', ON);
    expect(lagOn.continues).toBeGreaterThan(lagOff.continues);
    expect(nitOn.continues).toBeLessThan(nitOff.continues);
    expect(lagOn.fires.holdem_persona_continue_shift_seen).toBeGreaterThan(0);
    expect(nitOn.fires.holdem_persona_continue_shift_seen).toBeGreaterThan(0);
    expect(trickyOn.fires.holdem_persona_continue_shift_seen ?? 0).toBe(0);
    // The option also carries the persona re-raise mix: the 3-bet bluff
    // comparison is reached with the persona present.
    expect(lagOn.fires.holdem_persona_3bet_bluff_eligible_seen).toBeGreaterThan(0);
    expect(lagOff.fires.holdem_persona_3bet_bluff_eligible_seen ?? 0).toBe(0);
  });
});

/** Six-handed, hero (seat 5, cutoff) behind one limper (the villain, seat 3). */
function limpSpot(heroId: string, holding: string) {
  const fill = [3, 4, 5, 6].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);
  const seat = (s: number, id: string, stack: number, bet: number, c?: string, folded = false) =>
    ({
      seat: s,
      user_id: id,
      username: `p${s}`,
      stack,
      bet,
      totalInvested: bet,
      cards: c ? cardsOf(c) : [],
      is_folded: folded,
      is_all_in: false,
      is_sitting_out: false,
    }) as unknown as SeatPlayer;
  const players = [
    seat(1, fill[0], 199, 1),
    seat(2, fill[1], 198, 2),
    seat(3, VILLAIN, 198, 2),
    seat(4, fill[2], 200, 0, undefined, true),
    seat(5, heroId, 200, 0, holding),
    seat(6, fill[3], 200, 0),
  ];
  const gs = {
    players,
    communityCards: [],
    pot: 5,
    currentBet: 2,
    minRaise: 2,
    stage: 'preflop',
    gameVariant: 'nlh',
    gameMode: 'cash',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 6,
    actionHistory: [
      { stage: 'preflop', seat: 3, userId: VILLAIN, action: 'call', amount: 2, timestamp: 4000 },
      { stage: 'preflop', seat: 4, userId: fill[2], action: 'fold', amount: 0, timestamp: 8000 },
    ],
  };
  return { name: `limp_${holding}`, hero: players[4], gs };
}
function sweepIso(heroId: string, villain: keyof typeof VILLAINS, opts: Record<string, unknown>) {
  let raises = 0;
  const fires: Record<string, number> = {};
  HOLDING_TEXT.forEach((holding, k) => {
    installVillain(VILLAINS[villain], 'cash');
    const d = decideStyleSpot(limpSpot(heroId, holding), { ...handOpts(6000000 + k), ...opts });
    for (const [f, n] of Object.entries(d.fires)) fires[f] = (fires[f] ?? 0) + n;
    if (d.decision.action === 'raise' || d.decision.action === 'all_in') raises++;
  });
  return { raises, fires };
}

describe('holdem persona preflop: the Nit Hunter punishes loose openers and limpers', () => {
  it('facing a credibly wide opener (maniac read) a Nit punishes and does not continue less than off', () => {
    const nitOff = sweepDefend(NIT, 'maniac', {});
    const nitOn = sweepDefend(NIT, 'maniac', ON);
    expect(nitOn.fires.holdem_persona_nit_punish_seen).toBe(HOLDINGS.length);
    expect(nitOn.continues).toBeGreaterThanOrEqual(nitOff.continues);
    const nitNone = sweepDefend(NIT, 'none', ON);
    expect(nitNone.fires.holdem_persona_nit_punish_seen ?? 0).toBe(0);
    const lagOn = sweepDefend(LAG, 'maniac', ON);
    expect(lagOn.fires.holdem_persona_nit_punish_seen ?? 0).toBe(0);
  });
  it('behind a limper read credibly loose a Nit isolates more than off; with no read fewer; a LAG gets no punish', () => {
    for (const v of ['maniac', 'station'] as const) {
      const off = sweepIso(NIT, v, {});
      const on = sweepIso(NIT, v, ON);
      expect(on.fires.holdem_persona_nit_punish_seen, v).toBe(HOLDINGS.length);
      expect(on.raises, v).toBeGreaterThan(off.raises);
      if (process.env.HOLDEM_PERSONA_PREFLOP_PRINT === '1')
        console.log(
          `nit isolation behind a ${v} limper: off ${off.raises}, on ${on.raises} of ${HOLDINGS.length}`
        );
    }
    const noneOff = sweepIso(NIT, 'none', {});
    const noneOn = sweepIso(NIT, 'none', ON);
    expect(noneOn.raises).toBeLessThan(noneOff.raises);
    expect(noneOn.fires.holdem_persona_nit_punish_seen ?? 0).toBe(0);
    expect(sweepIso(LAG, 'station', ON).fires.holdem_persona_nit_punish_seen ?? 0).toBe(0);
  });
});
