/**
 * OMAHA: THREE BETS THAT BECOME CHECKS (owner 2026-11-15, hand 59517323;
 * options omahaBareOverpairOopFlopCheck, omahaOverpairNoOopBarrelVsValueLeader
 * and omahaPairedRiverNoThinLeadVsValueLeader, each default OFF).
 *
 * The recorded hand, anonymised to seat numbers (the fixture beside the
 * complaint laws): a Horse out of position with aces bets the 5-8-9 two-tone
 * flop, the turn after the call, and the river that pairs the board, into the
 * one player who called both streets.
 *
 *  - each option: unset, false and a truthy non-boolean decide
 *    byte-identically; on, the recorded bet becomes a check at every seed for
 *    every profile; the rule draws nothing from the brain's random stream;
 *    the check is admitted by the worker receipt validator;
 *  - the turn and river options: an unknown or presumed opponent, and a
 *    measured one who is not a value leader, get today's decision, with the
 *    withheld receipt; the mind off, today's decision;
 *  - the boundaries: in position, a set, two pair, a full house, a flush draw
 *    or a wrap (flop), an unpaired river: today's decision;
 *  - facing a bet nothing changes, and after the check the hand continues
 *    against a bet at the prices pinned below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, omahaDrawQuality, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  omahaBareOverpairOopFlopSpot,
  omahaOverpairOopTurnBarrelSpot,
  omahaPairedRiverThinLeadSpot,
} from './HorseOmahaOopChecks.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  actionKind,
  recordedPathMatches,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ReplayProfile,
} from './HorseComplaintReplay.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import FIXTURE from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

const FLOP = 14;
const TURN = 16;
const RIVER = 18;
const HERO = 5;
const CALLER = 1;
const PROFILES = replayProfiles('cash');
const LIVE = PROFILES.find((p) => p.live)!;
const SEEDS = [...FX.seeds, 101, 102, 103, 104, 105, 106];

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

interface Edit {
  /** hero's hole cards instead of the recorded ones */
  hole?: string;
  /** the board at the node instead of the recorded one */
  board?: string;
  /** hero in position: the button moves so the caller acts first and checks to hero */
  inPosition?: boolean;
}
type Node = ReturnType<typeof stateAt>;
const clone = (): ComplaintFixture => JSON.parse(JSON.stringify(FX)) as ComplaintFixture;

/** The recorded decision node `ord`, optionally edited. */
function nodeAt(ord: number, edit: Edit = {}): Node {
  const f = clone();
  if (edit.hole) f.hole[String(HERO)] = cards(edit.hole);
  const node = f.actions.find((a) => a.ord === ord)!;
  if (edit.board) node.publicNode!.boards = [edit.board];
  if (edit.inPosition) {
    node.publicNode!.dealerSeat = 6;
    const out: ComplaintAction[] = [];
    let n = 0;
    const push = (a: Partial<ComplaintAction>) => out.push({ ...a, ord: ++n } as ComplaintAction);
    const check = (stage: string) =>
      push({ seat: CALLER, stage, action: 'check', amount: 0, origin: 'player' });
    let street = 'preflop';
    for (const a of f.actions.filter((x) => x.ord < ord)) {
      if (a.stage !== street) {
        street = a.stage;
        check(street);
      }
      push(a);
    }
    if (node.stage !== street) check(node.stage);
    node.ord = n + 1;
    f.actions = [...out, node];
  }
  return stateAt(f, node);
}

/** Hero checked the recorded node `ord` and the caller bet `x` (all in when `allIn`). */
function facingAfterCheck(ord: number, x: number, allIn = false): Node {
  const f = clone();
  const node = f.actions.find((a) => a.ord === ord)!;
  const pn = JSON.parse(JSON.stringify(node.publicNode!)) as NonNullable<
    ComplaintAction['publicNode']
  >;
  f.actions = f.actions.filter((a) => a.ord < ord);
  f.actions.push({
    ord,
    seat: HERO,
    stage: node.stage,
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
  });
  f.actions.push({
    ord: ord + 1,
    seat: CALLER,
    stage: node.stage,
    action: allIn ? 'all_in' : 'bet',
    amount: x,
    origin: 'player',
    isFullRaise: true,
  });
  const row = pn.seats.find((s) => s[0] === CALLER)!;
  row[1] = Math.round((row[1] - x) * 100) / 100;
  row[2] = x;
  row[3] += x;
  if (allIn) row[6] = 2;
  const pot = pn.pot;
  pn.pot = pot + x;
  pn.toCall = x;
  pn.currentBet = x;
  pn.minRaiseTo = allIn ? null : 2 * x;
  pn.maxRaiseTo = allIn ? null : pot + 3 * x;
  pn.legalActions = allIn ? ['fold', 'call'] : ['fold', 'call', 'raise', 'all_in'];
  const next: ComplaintAction = {
    ord: ord + 2,
    seat: HERO,
    stage: node.stage,
    action: 'call',
    amount: x,
    origin: 'horse_policy',
    publicNode: pn,
  };
  f.actions.push(next);
  return stateAt(f, next);
}

const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
}
type Reads = (userId: string) => OmahaReadConditional | null;
function play(
  build: () => Node,
  opts: HorseDecideOpts,
  reads?: Reads,
  profile: ReplayProfile = LIVE
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    // mind on: the value-leader read is consulted only with the opponent memory present
    const d = HorseLogic.decide(st.hero, st.gs, profile.style, profile.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const leader = { measured: true, tightReRaiser: false, valueLeader: true } as OmahaReadConditional;
const notLeader = {
  measured: true,
  tightReRaiser: false,
  valueLeader: false,
} as OmahaReadConditional;
/** A presumed read: a row exists, nothing measured (HorseOmahaReadConditional). */
const presumed = {
  measured: false,
  tightReRaiser: false,
  valueLeader: false,
} as OmahaReadConditional;
const WAGERS = ['bet', 'raise', 'all_in'];
const wagers = (o: Outcome) => o.actions.filter((a) => WAGERS.includes(a)).length;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;

const RIVER_ON: HorseDecideOpts = { omahaPairedRiverNoThinLeadVsValueLeader: true };
const TURN_ON: HorseDecideOpts = { omahaOverpairNoOopBarrelVsValueLeader: true };
const FLOP_ON: HorseDecideOpts = { omahaBareOverpairOopFlopCheck: true };
const ALL_ON: HorseDecideOpts = { ...RIVER_ON, ...TURN_ON, ...FLOP_ON };

const OPTIONS = [
  {
    name: 'omahaPairedRiverNoThinLeadVsValueLeader',
    on: RIVER_ON,
    ord: RIVER,
    receipt: 'omaha_paired_river_thin_lead',
    readGated: true,
  },
  {
    name: 'omahaOverpairNoOopBarrelVsValueLeader',
    on: TURN_ON,
    ord: TURN,
    receipt: 'omaha_overpair_oop_turn_barrel',
    readGated: true,
  },
  {
    name: 'omahaBareOverpairOopFlopCheck',
    on: FLOP_ON,
    ord: FLOP,
    receipt: 'omaha_bare_overpair_oop_flop',
    readGated: false,
  },
] as const;

describe('hand 59517323, the recorded hand', () => {
  it('the fixture is the recorded hand and it bet the turn and the river', () => {
    expect(FX.handId).toBe('b84739da-6e6f-4627-97ee-564f18cc81d5');
    expect(recordedPathMatches(FX)).toBe(true);
    for (const ord of [FLOP, TURN, RIVER]) {
      const a = FX.actions.find((x) => x.ord === ord)!;
      expect(actionKind(a.action, a.amount, a.publicNode!)).toBe('raise');
    }
    expect(FX.players.every((p) => Object.keys(p).sort().join() === 'isHorse,seat')).toBe(true);
    expect(JSON.stringify(FX)).not.toMatch(/userId|username/);
  });

  it('the three public spots hold at the recorded flop, turn and river', () => {
    const flop = nodeAt(FLOP);
    const turn = nodeAt(TURN);
    const river = nodeAt(RIVER);
    expect(omahaBareOverpairOopFlopSpot(flop.hero, flop.gs)).toBe(true);
    expect(omahaOverpairOopTurnBarrelSpot(turn.hero, turn.gs)).toBe(true);
    expect(omahaPairedRiverThinLeadSpot(river.hero, river.gs)).toBe(true);
    // each spot is its own street's
    expect(omahaBareOverpairOopFlopSpot(turn.hero, turn.gs)).toBe(false);
    expect(omahaOverpairOopTurnBarrelSpot(river.hero, river.gs)).toBe(false);
    expect(omahaPairedRiverThinLeadSpot(turn.hero, turn.gs)).toBe(false);
    // the turn hand holds the nut flush draw: it does not exempt the turn check
    expect(
      omahaDrawQuality(turn.hero.cards, turn.gs.communityCards ?? [], false).nutFlushDraw
    ).toBe(true);
  });

  it("today's brain bets each street at some seed (the spots are live)", () => {
    for (const ord of [FLOP, TURN, RIVER])
      expect(
        wagers(
          play(
            () => nodeAt(ord),
            {},
            () => null
          )
        )
      ).toBeGreaterThan(0);
  });
});

describe.each(OPTIONS)('$name', (o) => {
  const build = () => nodeAt(o.ord);

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = play(build, {}, () => leader);
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
      const off = play(build, { [o.name]: v }, () => leader);
      expect(off.bytes).toEqual(unset.bytes);
      expect(off.next).toEqual(unset.next);
    }
    expect(hasFire(unset, `${o.receipt}_checked`)).toBe(0);
  });

  it('on, against a measured value leader: the recorded bet is a check at every seed, for every profile', () => {
    for (const p of PROFILES) {
      const off = play(build, {}, () => leader, p);
      const on = play(build, o.on, () => leader, p);
      expect(wagers(on)).toBe(0);
      expect(hasFire(on, `${o.receipt}_checked`)).toBe(wagers(off));
      on.actions.forEach((a, i) => {
        if (WAGERS.includes(off.actions[i])) expect(a).toBe('check');
        else expect(on.bytes[i]).toEqual(off.bytes[i]);
      });
      // the rule draws nothing from the brain's random stream
      expect(on.next).toEqual(off.next);
    }
  });

  it.skipIf(!o.readGated)(
    'on, against an unknown, presumed or measured non-leader opponent: today’s decision, withheld',
    () => {
      const off = play(build, {});
      for (const reads of [() => null, () => presumed, () => notLeader]) {
        const on = play(build, o.on, reads as Reads);
        expect(on.bytes).toEqual(off.bytes);
        expect(on.next).toEqual(off.next);
        expect(hasFire(on, `${o.receipt}_withheld`)).toBe(wagers(off));
        expect(hasFire(on, `${o.receipt}_checked`)).toBe(0);
      }
      // the mind off: no read is consulted, today's decision
      expect(play(build, { ...o.on, mind: false }, () => leader).bytes).toEqual(
        play(build, { mind: false }).bytes
      );
    }
  );

  it.skipIf(o.readGated)('on: no opponent read is needed (unknown, presumed, the mind off)', () => {
    for (const [reads, extra] of [
      [() => null, {}],
      [() => presumed, {}],
      [() => leader, { mind: false }],
    ] as const) {
      const off = play(build, extra, reads as Reads);
      const on = play(build, { ...o.on, ...extra }, reads as Reads);
      expect(wagers(off)).toBeGreaterThan(0);
      expect(wagers(on)).toBe(0);
      expect(hasFire(on, `${o.receipt}_checked`)).toBe(wagers(off));
    }
  });

  it('the check is admitted by the worker receipt validator', () => {
    let checked = 0;
    for (const s of SEEDS) {
      HorseMind.reset();
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => leader) as never);
      seedFastRandom(s);
      const st = build();
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, o.on));
      vi.restoreAllMocks();
      expect(d.action).toBe('check');
      const changed = d.policyGraph?.transitions.some((t) => t.node === 'wager_rules' && t.changed);
      if (changed) checked++;
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('boundaries: today’s decision', () => {
  const same = (build: () => Node, on: HorseDecideOpts, wantsBet = true) => {
    const off = play(build, {}, () => leader);
    const got = play(build, on, () => leader);
    expect(got.bytes).toEqual(off.bytes);
    if (wantsBet) expect(wagers(off)).toBeGreaterThan(0);
  };

  it('river: a full house still bets; an unpaired river is unchanged', () => {
    // nines full of fives
    const boat = () => nodeAt(RIVER, { hole: 'As9s9c7c4h' });
    expect(omahaPairedRiverThinLeadSpot(boat().hero, boat().gs)).toBe(false);
    same(boat, ALL_ON);
    const brick = () => nodeAt(RIVER, { board: '5d8d9h2hKc' });
    expect(omahaPairedRiverThinLeadSpot(brick().hero, brick().gs)).toBe(false);
    same(brick, ALL_ON, false);
  });

  it('river: a board paired on the turn counts, and trips or a straight below a full house check too', () => {
    const pairedTurn = nodeAt(RIVER, { board: '5d8d9h5hKc' });
    expect(omahaPairedRiverThinLeadSpot(pairedTurn.hero, pairedTurn.gs)).toBe(true);
    const trips = nodeAt(RIVER, { hole: 'AsKh5sQc4h' });
    expect(omahaPairedRiverThinLeadSpot(trips.hero, trips.gs)).toBe(true);
    const straight = nodeAt(RIVER, { hole: 'AsAh7s6c4h' });
    expect(omahaPairedRiverThinLeadSpot(straight.hero, straight.gs)).toBe(true);
  });

  it('river: a caller who has folded, or a hand whose bets were never called, is not the spot', () => {
    const st = nodeAt(RIVER);
    const noCall = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).map((a) =>
        a.seat === CALLER && a.stage !== 'preflop' ? { ...a, action: 'check', amount: 0 } : a
      ),
    };
    expect(omahaPairedRiverThinLeadSpot(st.hero, noCall as never)).toBe(false);
    // the caller raised hero's turn bet and hero called: hero was not the last aggressor
    const raised = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).map((a) =>
        a.seat === CALLER && a.stage !== 'preflop' ? { ...a, action: 'raise' } : a
      ),
    };
    expect(omahaPairedRiverThinLeadSpot(st.hero, raised as never)).toBe(false);
  });

  it('turn: in position, a set and two pair still bet as today', () => {
    const ip = () => nodeAt(TURN, { inPosition: true });
    expect(omahaOverpairOopTurnBarrelSpot(ip().hero, ip().gs)).toBe(false);
    same(ip, ALL_ON);
    for (const hole of ['As9s9c7c4h', 'As9s8c7c4h']) {
      const made = () => nodeAt(TURN, { hole });
      expect(omahaOverpairOopTurnBarrelSpot(made().hero, made().gs)).toBe(false);
      same(made, ALL_ON);
    }
  });

  it('turn: a board with no straight possible, or a flop bet that was not called, is not the spot', () => {
    const dry = nodeAt(TURN, { board: '2d7dKh2h' });
    expect(omahaOverpairOopTurnBarrelSpot(dry.hero, dry.gs)).toBe(false);
    const st = nodeAt(TURN);
    const checkedFlop = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).filter((a) => a.stage !== 'flop'),
    };
    expect(omahaOverpairOopTurnBarrelSpot(st.hero, checkedFlop as never)).toBe(false);
    // three-handed: the turn rule is heads-up only
    const three = {
      ...st.gs,
      players: st.gs.players.map((p) => (p.seat === 6 ? { ...p, is_folded: false } : p)),
    };
    expect(omahaOverpairOopTurnBarrelSpot(st.hero, three as never)).toBe(false);
  });

  it('flop: in position, a set, two pair, a flush draw and a wrap still bet as today', () => {
    const ip = () => nodeAt(FLOP, { inPosition: true });
    expect(omahaBareOverpairOopFlopSpot(ip().hero, ip().gs)).toBe(false);
    same(ip, ALL_ON);
    for (const hole of [
      'As9s9c7c4h', // a set
      'As9s8c7c4h', // top two pair
      'AsAdQs7c4d', // aces with the nut flush draw
      'AsAhJcTc7s', // aces with a wrap (Q, 7 and 6 make a straight)
    ]) {
      const made = () => nodeAt(FLOP, { hole });
      expect(omahaBareOverpairOopFlopSpot(made().hero, made().gs)).toBe(false);
      same(made, ALL_ON, false);
    }
  });

  it('flop: a dry rainbow flop is not the spot; a multiway pot is', () => {
    const dry = nodeAt(FLOP, { board: '2dKh7s' });
    expect(omahaBareOverpairOopFlopSpot(dry.hero, dry.gs)).toBe(false);
    const st = nodeAt(FLOP);
    const three = {
      ...st.gs,
      players: st.gs.players.map((p) => (p.seat === 6 ? { ...p, is_folded: false } : p)),
    };
    expect(omahaBareOverpairOopFlopSpot(st.hero, three as never)).toBe(true);
  });

  it('outside PLO4/PLO5 cash, in Hi-Lo, on two boards or facing a bet no spot holds', () => {
    for (const ord of [FLOP, TURN, RIVER]) {
      const st = nodeAt(ord);
      const spot =
        ord === FLOP
          ? omahaBareOverpairOopFlopSpot
          : ord === TURN
            ? omahaOverpairOopTurnBarrelSpot
            : omahaPairedRiverThinLeadSpot;
      expect(spot(st.hero, st.gs)).toBe(true);
      for (const over of [
        { gameVariant: 'plo6' },
        { gameVariant: 'plo8' },
        { gameMode: 'tournament' },
        { variantRules: { splitLow8OrBetter: true } },
        { communityCards2: st.gs.communityCards },
        { toCall: 40, currentBet: 40 },
        { legalActions: ['fold', 'bet', 'all_in'] },
        { allInOrFold: true },
      ])
        expect(spot(st.hero, { ...st.gs, ...over } as never)).toBe(false);
    }
  });
});

describe('facing a bet nothing changes, and the checked hand continues', () => {
  const PRICES = [0.33, 0.5, 0.75, 1];

  it('no option changes a decision facing a bet', () => {
    for (const [ord, pot] of [
      [FLOP, 357],
      [TURN, 555],
    ] as const)
      for (const frac of PRICES) {
        const build = () => facingAfterCheck(ord, Math.round(pot * frac));
        expect(play(build, ALL_ON, () => leader).bytes).toEqual(
          play(build, {}, () => leader).bytes
        );
      }
    const shove = () => facingAfterCheck(RIVER, 417.9, true);
    expect(play(shove, ALL_ON, () => leader).bytes).toEqual(play(shove, {}, () => leader).bytes);
  });

  it('turn: after the check, the overpair with the nut flush draw never folds to a bet of a third of the pot up to the pot', () => {
    for (const frac of PRICES)
      for (const reads of [() => null, () => leader]) {
        const o = play(
          () => facingAfterCheck(TURN, Math.round(555 * frac)),
          ALL_ON,
          reads as Reads
        );
        expect(o.actions.filter((a) => a === 'fold')).toEqual([]);
      }
  });

  it('flop: after the check, the bare overpair never folds to a bet of a third of the pot', () => {
    for (const reads of [() => null, () => leader]) {
      const o = play(() => facingAfterCheck(FLOP, Math.round(357 * 0.33)), ALL_ON, reads as Reads);
      expect(o.actions.filter((a) => a === 'fold')).toEqual([]);
    }
  });

  it('river: after the check, aces up fold to the all-in of 417.9 into 1,021 (they no longer pay it off)', () => {
    const o = play(
      () => facingAfterCheck(RIVER, 417.9, true),
      ALL_ON,
      () => leader
    );
    expect(new Set(o.actions)).toEqual(new Set(['fold']));
  });
});

describe('in the league (anonymised seats, memory learning on)', () => {
  it('off by default: unset and false play the same poker', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `oop_checks_off_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: {},
          b: {
            omahaPairedRiverNoThinLeadVsValueLeader: false,
            omahaOverpairNoOopBarrelVsValueLeader: false,
            omahaBareOverpairOopFlopCheck: false,
          },
        },
        60,
        4530001
      );
      expect(r.divergentPairs).toBe(0);
      expect(r.illegalActions).toBe(0);
    }
  }, 300_000);

  it('on, with the memory learning: no illegal action and no fallback', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `oop_checks_on_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: { ...ALL_ON },
          b: {},
        },
        60,
        4540001
      );
      expect(r.illegalActions).toBe(0);
      expect(r.brainExceptionFallbacks ?? 0).toBe(0);
    }
  }, 300_000);
});
