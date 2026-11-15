/**
 * Shared spot builder for the payout-aware short-stack push/fold law
 * (AShortStackJamPricesThePayJump.law.test.ts), production hand 59441335.
 *
 * The hand: an 86-entrant bounty freezeout, 13 paid, nine left at the final
 * table, blinds 3,000/6,000 with a 6,000 big-blind ante. Seats 1-5 fold, the
 * cutoff (seat 6, 12,609 chips, 2.1bb) is first in with the button (seat 7),
 * small blind (seat 8) and big blind (seat 9) behind. Stacks are the hand's.
 *
 * What the hand record does not carry, assumed here and stated in the
 * changelog: the payout ladder is the repository's own rule for a new MTT
 * (fn_ca_payout_structure: ceil(86 x 15%) = 13 places, weight 1 / place^0.8,
 * normalised to 100, largest-remainder cents); the buy-in is 10.00 + 1.00
 * fee with a 2.50 bounty taken from the net entry, so the prize pool is
 * 86 x 7.50 = 645.00 and the nine live heads hold 22.50 of bounty.
 */
import FIXTURE from './ABountyOnlyEventKeepsTheReferenceAction.fixture.json';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';

export const uid = (s: number) => `00000000-0000-4000-8256-0000000000${String(s).padStart(2, '0')}`;

/** fn_ca_payout_structure(p_entrants, p_percent): the repository's MTT ladder. */
export function repositoryPayoutLadder(entrants: number, percent = 15): number[] {
  const places = Math.max(1, Math.min(entrants, Math.ceil((entrants * percent) / 100)));
  const weights = Array.from({ length: places }, (_, i) => 1 / Math.pow(i + 1, 0.8));
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (100 * w) / total);
  const floored = exact.map((x) => Math.floor(x * 100) / 100);
  const centsLeft = Math.round((100 - floored.reduce((a, b) => a + b, 0)) * 100);
  const order = exact
    .map((x, i) => ({ i, frac: x * 100 - Math.floor(x * 100) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floored.slice();
  for (let k = 0; k < centsLeft; k++)
    out[order[k].i] = Math.round((out[order[k].i] + 0.01) * 100) / 100;
  return out;
}

export const HAND_STACKS: Record<number, number> = {
  1: 74_332,
  2: 69_856,
  3: 310_173,
  4: 126_232,
  5: 124_308,
  6: 12_609,
  7: 191_640,
  8: 38_469,
  9: 342_381,
};

export const PAYOUT_86 = repositoryPayoutLadder(86);
/** 86 x 7.50 prize, 9 live heads x 2.50 bounty, in cents. */
export const BOUNTY_FREEZEOUT = {
  isBounty: true,
  isPko: false,
  isMysteryBounty: false,
  prizePoolCents: 64_500,
  bountyPoolCents: 2_250,
  bountyFactor: 2_250 / (64_500 + 2_250),
  meanBountyCents: 250,
};
export const NO_BOUNTY = {
  isBounty: false,
  isPko: false,
  isMysteryBounty: false,
  prizePoolCents: 64_500,
  bountyPoolCents: 0,
  bountyFactor: 0,
  meanBountyCents: 0,
};

const RANK: Record<string, string> = {};
/** '85o' -> 8h 5c, 'KQs' -> Kh Qh, '77' -> 7h 7c. */
export function cardsOf(hand: string): Array<{ rank: string; suit: string }> {
  const r1 = RANK[hand[0]] ?? hand[0];
  const r2 = RANK[hand[1]] ?? hand[1];
  const suited = hand[2] === 's';
  return [
    { rank: r1, suit: 'hearts' },
    { rank: r2, suit: suited ? 'hearts' : 'clubs' },
  ];
}

export interface SpotSpec {
  stacks?: Record<number, number>;
  dealer?: number;
  sb?: number;
  bb?: number;
  hero?: number;
  hand?: string;
  /** Seats that folded before hero, in order. */
  foldedBefore?: number[];
  /** A lone open-jam before hero (the call spot): the jamming seat. */
  jammer?: number;
  /** Seats that folded after the jam, before hero. */
  foldedAfterJam?: number[];
  tournament?: Record<string, unknown> | null;
  gs?: Record<string, unknown>;
  holeCards?: Array<{ rank: string; suit: string }>;
}

export function buildSpot(spec: SpotSpec = {}) {
  const stacks = spec.stacks ?? HAND_STACKS;
  const seats = Object.keys(stacks)
    .map(Number)
    .sort((a, b) => a - b);
  const dealer = spec.dealer ?? 7;
  const sbSeat = spec.sb ?? 8;
  const bbSeat = spec.bb ?? 9;
  const heroSeat = spec.hero ?? 6;
  const foldedBefore = spec.foldedBefore ?? [1, 2, 3, 4, 5];
  const foldedAfter = spec.foldedAfterJam ?? [];
  const gs = structuredClone(FIXTURE.gameState) as any;
  const base = structuredClone(FIXTURE.player) as any;
  gs.smallBlind = 3000;
  gs.bigBlind = 6000;
  gs.ante = 6000;
  gs.bigBlindAnte = true;
  gs.dealerSeat = dealer;
  gs.blindSeats = { smallBlind: sbSeat, bigBlind: bbSeat };
  gs.currentPlayerSeat = heroSeat;
  gs.heroSeat = heroSeat;
  gs.dealtSeatIds = seats;
  gs.humanUserIds = [uid(sbSeat)];
  gs.publicMemoryDomain = { ...gs.publicMemoryDomain, ante: 'big_blind' };
  const jam = spec.jammer;
  gs.players = seats.map((s) => {
    const total = stacks[s];
    const dead = s === bbSeat ? Math.min(6000, total) : 0;
    let bet = s === sbSeat ? 3000 : s === bbSeat ? 6000 : 0;
    if (s === jam) bet = total - dead;
    bet = Math.min(bet, total - dead);
    return {
      ...base,
      seat: s,
      user_id: uid(s),
      is_horse: s !== sbSeat,
      cards: s === heroSeat ? (spec.holeCards ?? cardsOf(spec.hand ?? '85o')) : [],
      knownDeadCards: [],
      is_folded: foldedBefore.includes(s) || foldedAfter.includes(s),
      is_all_in: s === jam,
      bet,
      totalInvested: bet + dead,
      deadInvested: dead,
      individualAnteInvested: 0,
      stack: total - bet - dead,
    };
  });
  const hero = gs.players.find((p: any) => p.seat === heroSeat);
  const currentBet = Math.max(...gs.players.map((p: any) => p.bet));
  const pot = gs.players.reduce((a: number, p: any) => a + p.bet + p.deadInvested, 0);
  gs.currentBet = currentBet;
  gs.toCall = Math.max(0, currentBet - hero.bet);
  gs.lastRaise = jam !== undefined ? currentBet - 6000 : 6000;
  gs.minRaise = gs.lastRaise;
  gs.minRaiseTo = jam !== undefined ? null : currentBet + gs.lastRaise;
  gs.maxRaiseTo = jam !== undefined ? null : hero.stack + hero.bet;
  gs.pot = pot;
  gs.contestablePot = pot;
  gs.legalActions =
    jam === undefined
      ? ['fold', 'call', 'raise', 'all_in']
      : hero.stack <= gs.toCall
        ? ['fold', 'all_in']
        : ['fold', 'call', 'all_in'];
  gs.pots = [
    {
      amount: pot,
      eligiblePlayers: gs.players.filter((p: any) => !p.is_folded).map((p: any) => p.user_id),
    },
  ];
  const t0 = 1794465271353;
  let k = 0;
  const history: any[] = [];
  for (const s of foldedBefore)
    history.push({
      action: 'fold',
      amount: 0,
      origin: 'horse_policy',
      seat: s,
      stage: 'preflop',
      timestamp: t0 + k++ * 1000,
      userId: uid(s),
    });
  if (jam !== undefined) {
    history.push({
      action: 'all_in',
      amount: currentBet,
      isFullRaise: true,
      origin: 'horse_policy',
      seat: jam,
      stage: 'preflop',
      timestamp: t0 + k++ * 1000,
      userId: uid(jam),
    });
    for (const s of foldedAfter)
      history.push({
        action: 'fold',
        amount: 0,
        origin: 'horse_policy',
        seat: s,
        stage: 'preflop',
        timestamp: t0 + k++ * 1000,
        userId: uid(s),
      });
  }
  gs.actionHistory = history;
  if (spec.tournament === null) {
    gs.tournament = undefined;
  } else {
    const t = gs.tournament;
    const byUser: Record<string, number> = {};
    for (const s of seats) byUser[uid(s)] = stacks[s];
    Object.assign(t, {
      currentBigBlind: 6000,
      currentSmallBlind: 3000,
      currentAnte: 6000,
      currentLevel: 16,
      anteType: 'big_blind',
      entrants: 86,
      playersLeft: seats.length,
      spotsPaid: 13,
      inMoney: true,
      finalTable: true,
      nearBubble: false,
      handForHand: false,
      handForHandExpected: false,
      lateRegistrationOpen: false,
      registrationOpen: false,
      rebuyOpen: false,
      reentryOpen: false,
      rebuyAllowed: false,
      reentryAllowed: false,
      satellite: false,
      ...BOUNTY_FREEZEOUT,
      stacks: Object.values(stacks).sort((a, b) => b - a),
      stackByUser: byUser,
      bountyByUser: Object.fromEntries(Object.keys(byUser).map((u) => [u, 250])),
      payoutPct: PAYOUT_86,
      playersAtTable: seats.length,
      avgStackChips: Object.values(stacks).reduce((a, b) => a + b, 0) / seats.length,
      medianStackChips: Object.values(stacks).sort((a, b) => a - b)[Math.floor(seats.length / 2)],
    });
    if (t.m) t.m = undefined;
    Object.assign(t, spec.tournament ?? {});
  }
  Object.assign(gs, spec.gs ?? {});
  return { gs: gs as HorseGameStateV2, hero };
}

/** One decision per seed through HorseLogic.decide; returns 'action:amount' per seed. */
export function decideSeeds(
  spec: SpotSpec,
  seeds: number,
  opts: Record<string, unknown> = {}
): string[] {
  const out: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const { gs, hero } = buildSpot(spec);
    seedFastRandom(seed);
    HorseMind.reset();
    try {
      const d = HorseLogic.decide(
        hero,
        gs,
        FIXTURE.style as never,
        FIXTURE.mods as never,
        opts as never
      ) as any;
      out.push(`${d.action}:${d.amount ?? ''}`);
    } catch (error) {
      out.push(`throw:${String((error as Error)?.message ?? error).slice(0, 60)}`);
    }
  }
  return out;
}

export function tally(actions: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of actions) {
    const k = a.split(':')[0];
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/** Folded-to: hero's jam share. Facing a jam: hero's call share. */
export const share = (actions: string[], kind: 'all_in' | 'call') =>
  actions.filter((a) => a.startsWith(kind + ':') || (kind === 'call' && a.startsWith('all_in:')))
    .length / actions.length;

/** The call spot: the cutoff (seat 6, 10bb) jams, button and small blind fold,
 *  hero is the big blind (seat 9, 10bb), nine left at the final table. */
export const CALL_STACKS: Record<number, number> = {
  ...HAND_STACKS,
  6: 60_000,
  9: 60_000,
};
export const callSpot = (hand: string, extra: Partial<SpotSpec> = {}): SpotSpec => ({
  stacks: CALL_STACKS,
  hero: 9,
  hand,
  jammer: 6,
  foldedAfterJam: [7, 8],
  ...extra,
});
